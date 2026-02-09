/**
 * Apps Proxy Route
 *
 * Reverse-proxies requests from /apps/<serviceName>/* to the internal
 * K8s ClusterIP DNS of the generated service in the development namespace.
 * This allows generated apps to be accessed through the main ChronosOps
 * domain with SSL, instead of raw NodePort IPs.
 *
 * Example:
 *   GET /apps/user-management-service/docs
 *   → proxies to http://user-management-service.development.svc.cluster.local:80/docs
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createChildLogger } from '@chronosops/shared';
import { serviceRegistryRepository } from '@chronosops/database';

const logger = createChildLogger({ component: 'AppsProxy' });

const DEV_NAMESPACE = process.env.DEV_NAMESPACE || 'development';
const SERVICE_PORT = 80;

// Cache resolved services to avoid DB lookups on every request (TTL: 30s)
const serviceCache = new Map<string, { exists: boolean; timestamp: number }>();
const CACHE_TTL_MS = 30_000;

function isServiceCached(name: string): boolean | null {
  const cached = serviceCache.get(name);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    serviceCache.delete(name);
    return null;
  }
  return cached.exists;
}

export async function appsProxyRoutes(app: FastifyInstance): Promise<void> {
  // Handle all HTTP methods for /apps/:serviceName and /apps/:serviceName/*
  app.all('/apps/:serviceName', proxyHandler);
  app.all('/apps/:serviceName/*', proxyHandler);
}

async function proxyHandler(
  request: FastifyRequest<{ Params: { serviceName: string; '*'?: string } }>,
  reply: FastifyReply
): Promise<void> {
  const { serviceName } = request.params;
  const remainder = (request.params as Record<string, string>)['*'] || '';

  // Validate the service exists (with caching)
  let exists = isServiceCached(serviceName);
  if (exists === null) {
    try {
      const service = await serviceRegistryRepository.getByName(serviceName);
      exists = service !== null;
      serviceCache.set(serviceName, { exists, timestamp: Date.now() });
    } catch (err) {
      logger.error({ err, serviceName }, 'Failed to look up service in registry');
      return reply.status(502).send({ error: 'Service lookup failed' });
    }
  }

  if (!exists) {
    return reply.status(404).send({
      error: 'Service not found',
      service: serviceName,
      message: `No deployed service named "${serviceName}" found in the development namespace`,
    });
  }

  // Build the internal K8s DNS target URL
  const targetBase = `http://${serviceName}.${DEV_NAMESPACE}.svc.cluster.local:${SERVICE_PORT}`;
  const targetPath = remainder ? `/${remainder}` : '/';
  const queryString = request.url.includes('?') ? '?' + request.url.split('?')[1] : '';
  const targetUrl = `${targetBase}${targetPath}${queryString}`;

  try {
    // Use undici/node fetch to proxy the request
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers)) {
      if (key === 'host' || key === 'connection' || key === 'transfer-encoding') continue;
      if (typeof value === 'string') headers[key] = value;
      if (Array.isArray(value)) headers[key] = value.join(', ');
    }
    // Set the correct host for the target service
    headers['host'] = `${serviceName}.${DEV_NAMESPACE}.svc.cluster.local`;
    // Forward the original host for apps that need it
    headers['x-forwarded-host'] = request.headers.host || '';
    headers['x-forwarded-proto'] = request.headers['x-forwarded-proto'] as string || 'http';
    headers['x-forwarded-prefix'] = `/apps/${serviceName}`;

    // Build the outgoing body for non-GET/HEAD requests.
    // Fastify automatically parses JSON bodies into objects, so we must
    // re-serialize and update content-length to avoid a mismatch where
    // the downstream Express app's raw-body parser reads the original
    // content-length but receives a differently-sized re-serialized body.
    let outBody: string | undefined;
    if (request.method !== 'GET' && request.method !== 'HEAD' && request.body !== undefined) {
      outBody = typeof request.body === 'string'
        ? request.body
        : JSON.stringify(request.body);
      // Fix content-length to match the actual re-serialized body
      headers['content-length'] = Buffer.byteLength(outBody, 'utf-8').toString();
    }

    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: outBody,
      signal: AbortSignal.timeout(30_000),
    });

    // Forward status code
    reply.status(response.status);

    // Forward response headers (skip hop-by-hop headers)
    const skipHeaders = new Set(['transfer-encoding', 'connection', 'keep-alive']);
    for (const [key, value] of response.headers.entries()) {
      if (skipHeaders.has(key.toLowerCase())) continue;
      reply.header(key, value);
    }

    // Override Content-Security-Policy for /docs pages.
    // Some generated apps include helmet middleware which sets a restrictive
    // CSP (script-src 'self') that blocks Swagger UI's CDN scripts and inline
    // <script> blocks. Since Gemini non-deterministically adds helmet, this
    // causes intermittent blank Swagger docs pages.
    // We replace the CSP with a permissive policy that allows:
    //  - CDN scripts/styles from unpkg.com and jsdelivr.net (where Swagger UI is hosted)
    //  - Inline scripts (needed for SwaggerUIBundle initialization)
    //  - Data URIs for images (Swagger UI uses data: for SVG icons)
    //  - Connections to self (for API calls through the proxy)
    if (remainder === 'docs' || remainder === 'docs/' || remainder.endsWith('/docs')) {
      const swaggerCsp = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net",
        "style-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net",
        "img-src 'self' data: https:",
        "font-src 'self' https: data:",
        "connect-src 'self' https:",
      ].join('; ');
      reply.header('content-security-policy', swaggerCsp);
    }

    // Stream the response body
    if (response.body) {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      let buffer = Buffer.concat(chunks);

      // Rewrite absolute paths in HTML responses (e.g. Swagger UI /docs page)
      // Generated apps return HTML with url:'/openapi.json' which the browser
      // resolves to the root domain instead of through the proxy prefix.
      const contentType = response.headers.get('content-type') || '';
      const proxyPrefix = `/apps/${serviceName}`;

      if (contentType.includes('text/html')) {
        let html = buffer.toString('utf-8');

        // Rewrite SwaggerUI spec URL: url:'/openapi.json' → url:'/apps/<svc>/openapi.json'
        html = html.replace(
          /url:\s*['"]\/openapi\.json['"]/g,
          `url:'${proxyPrefix}/openapi.json'`
        );

        // Rewrite any absolute src/href references within the HTML so assets
        // load through the proxy prefix (e.g. /static/... → /apps/<svc>/static/...)
        html = html.replace(
          /(src|href)=(["'])\/(?!apps\/)/g,
          `$1=$2${proxyPrefix}/`
        );

        // Handle INLINE OpenAPI specs: some generated apps use `spec: {...}`
        // instead of `url: '/openapi.json'` in SwaggerUIBundle config.
        // When the spec is embedded inline, the URL-based rewrite above won't
        // match, and the openapi.json interception below never runs.
        // We need to inject the `servers` field directly into the inline spec.
        // Only look for `spec:` within the SwaggerUIBundle({ ... }) call to
        // avoid false positives on other uses of the word "spec" in HTML.
        const swaggerBundleIndex = html.indexOf('SwaggerUIBundle');
        const specKeyIndex = swaggerBundleIndex !== -1
          ? html.indexOf('spec:', swaggerBundleIndex)
          : -1;
        if (specKeyIndex !== -1) {
          // Find the opening brace of the spec object
          const braceStart = html.indexOf('{', specKeyIndex + 5);
          if (braceStart !== -1) {
            // Walk forward counting braces to find the matching close brace
            let depth = 0;
            let braceEnd = -1;
            for (let i = braceStart; i < html.length; i++) {
              if (html[i] === '{') depth++;
              else if (html[i] === '}') {
                depth--;
                if (depth === 0) {
                  braceEnd = i;
                  break;
                }
              }
            }
            if (braceEnd !== -1) {
              const specString = html.substring(braceStart, braceEnd + 1);
              try {
                const inlineSpec = JSON.parse(specString);
                const proto = request.headers['x-forwarded-proto'] || 'https';
                const host = request.headers['x-forwarded-host'] || request.headers.host || '';
                const origin = `${proto}://${host}`;
                inlineSpec.servers = [{ url: `${origin}${proxyPrefix}`, description: 'Proxied via ChronosOps' }];
                const rewrittenSpec = JSON.stringify(inlineSpec);
                html = html.substring(0, braceStart) + rewrittenSpec + html.substring(braceEnd + 1);

                logger.info(
                  { serviceName, serverUrl: `${origin}${proxyPrefix}` },
                  'Injected servers field into inline OpenAPI spec in Swagger HTML'
                );
              } catch (err) {
                logger.warn(
                  { serviceName, err: err instanceof Error ? err.message : String(err) },
                  'Failed to parse/rewrite inline OpenAPI spec in Swagger HTML'
                );
              }
            }
          }
        }

        buffer = Buffer.from(html, 'utf-8');
        // Update content-length after rewriting
        reply.header('content-length', buffer.length);
      }

      // Rewrite OpenAPI JSON responses to inject the proxy prefix as the
      // server base URL.  Without a "servers" field Swagger UI defaults to
      // the page origin and sends requests to /<path> instead of
      // /apps/<svc>/<path>, which hits the ChronosOps SPA.
      if (
        (remainder === 'openapi.json' || remainder === 'swagger.json') &&
        contentType.includes('application/json')
      ) {
        try {
          const spec = JSON.parse(buffer.toString('utf-8'));

          // Determine the public-facing origin from forwarded headers
          const proto = request.headers['x-forwarded-proto'] || 'https';
          const host = request.headers['x-forwarded-host'] || request.headers.host || '';
          const origin = `${proto}://${host}`;

          // Set (or override) the servers array so Swagger UI sends
          // requests through the proxy prefix
          spec.servers = [{ url: `${origin}${proxyPrefix}`, description: 'Proxied via ChronosOps' }];

          const rewritten = JSON.stringify(spec);
          buffer = Buffer.from(rewritten, 'utf-8');
          reply.header('content-length', buffer.length);
        } catch {
          // If JSON parsing fails, just pass through the original
          logger.warn({ serviceName, remainder }, 'Failed to rewrite OpenAPI spec');
        }
      }

      return reply.send(buffer);
    }

    return reply.send('');
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    // Check if it's a connection refused (service not running)
    if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch failed')) {
      logger.warn({ serviceName, targetUrl }, 'Service is not reachable');
      return reply.status(503).send({
        error: 'Service unavailable',
        service: serviceName,
        message: `Service "${serviceName}" is not responding. It may be starting up or crashed.`,
      });
    }

    // Timeout
    if (errorMessage.includes('TimeoutError') || errorMessage.includes('aborted')) {
      logger.warn({ serviceName, targetUrl }, 'Proxy request timed out');
      return reply.status(504).send({
        error: 'Gateway timeout',
        service: serviceName,
        message: `Request to "${serviceName}" timed out after 30 seconds`,
      });
    }

    logger.error({ err, serviceName, targetUrl }, 'Proxy request failed');
    return reply.status(502).send({
      error: 'Bad gateway',
      service: serviceName,
      message: errorMessage,
    });
  }
}

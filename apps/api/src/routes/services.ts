/**
 * Service Registry API Routes
 * Endpoints for managing deployed services (multi-service architecture)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { serviceRegistryRepository } from '@chronosops/database';
import type { ServiceType, ServiceStatus } from '@chronosops/shared';
import { createChildLogger } from '@chronosops/shared';

const logger = createChildLogger({ component: 'ServicesAPI' });

/**
 * Safely parse JSON string, returning null if invalid
 */
function safeJsonParse<T>(json: string | null): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/**
 * Parse service record JSON fields for API response
 */
function parseServiceFields<T extends {
  apiSpec: string | null;
  endpoints: string | null;
  dependsOnServices: string | null;
}>(service: T): Omit<T, 'apiSpec' | 'endpoints' | 'dependsOnServices'> & {
  apiSpec: unknown;
  endpoints: Array<{ path: string; method?: string; description?: string }>;
  dependsOnServices: string[];
} {
  return {
    ...service,
    apiSpec: safeJsonParse(service.apiSpec),
    endpoints: safeJsonParse<Array<{ path: string; method?: string; description?: string }>>(service.endpoints) ?? [],
    dependsOnServices: safeJsonParse<string[]>(service.dependsOnServices) ?? [],
  };
}

// Query schemas
const listServicesSchema = z.object({
  serviceType: z.enum(['backend', 'frontend', 'fullstack']).optional(),
  status: z.enum(['active', 'degraded', 'unavailable', 'retired']).optional(),
  namespace: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

// Security fix: Schema for backends namespace filter
const backendsQuerySchema = z.object({
  namespace: z.string().regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'Invalid namespace format').optional(),
});

export async function servicesRoutes(app: FastifyInstance): Promise<void> {
  // List all services
  app.get('/', async (request: FastifyRequest, _reply: FastifyReply) => {
    const query = listServicesSchema.parse(request.query);

    const services = await serviceRegistryRepository.list(
      {
        serviceType: query.serviceType as ServiceType | undefined,
        status: query.status as ServiceStatus | undefined,
        namespace: query.namespace,
      },
      query.limit,
      query.offset
    );

    // Parse JSON fields and create summaries
    const parsedServices = services.map((service) => {
      const parsed = parseServiceFields(service);
      return {
        ...parsed,
        // Add endpoint count and previews for UI
        endpointCount: parsed.endpoints.length,
        endpointPreviews: parsed.endpoints.slice(0, 3).map((e) => e.path),
      };
    });

    return { data: parsedServices };
  });

  // List available backend services (for frontend/fullstack service picker)
  app.get('/backends', async (request: FastifyRequest, _reply: FastifyReply) => {
    // Security fix: Validate namespace query parameter
    const { namespace } = backendsQuerySchema.parse(request.query);

    const backends = await serviceRegistryRepository.listBackends(namespace);

    // Return summaries for the service picker
    const summaries = backends.map((service) => {
      const endpoints = safeJsonParse<Array<{ path: string; method: string; description: string }>>(
        service.endpoints
      ) ?? [];

      return {
        id: service.id,
        name: service.name,
        displayName: service.displayName,
        serviceType: service.serviceType,
        serviceUrl: service.serviceUrl,
        status: service.status,
        endpointCount: endpoints.length,
        endpointPreviews: endpoints.slice(0, 5).map((e) => `${e.method} ${e.path}`),
      };
    });

    return { data: summaries };
  });

  // Get service by ID with full details
  app.get(
    '/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      const service = await serviceRegistryRepository.getById(id);

      if (!service) {
        return reply.status(404).send({ error: 'Service not found' });
      }

      return { data: parseServiceFields(service) };
    }
  );

  // Get service by development cycle ID
  app.get(
    '/by-cycle/:cycleId',
    async (request: FastifyRequest<{ Params: { cycleId: string } }>, reply: FastifyReply) => {
      const { cycleId } = request.params;

      const service = await serviceRegistryRepository.getByDevelopmentCycleId(cycleId);

      if (!service) {
        return reply.status(404).send({ error: 'No service found for this development cycle' });
      }

      return { data: parseServiceFields(service) };
    }
  );

  // Get endpoints for a service
  app.get(
    '/:id/endpoints',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      const service = await serviceRegistryRepository.getById(id);

      if (!service) {
        return reply.status(404).send({ error: 'Service not found' });
      }

      const endpoints = safeJsonParse<Array<{
        method: string;
        path: string;
        description: string;
        requestBody?: unknown;
        responseSchema?: unknown;
        pathParams?: string[];
        queryParams?: Array<{ name: string; type: string; required?: boolean; description?: string }>;
        tags?: string[];
      }>>(service.endpoints) ?? [];

      return { data: endpoints };
    }
  );

  // Refresh API spec from live service (re-extract)
  app.post(
    '/:id/refresh-spec',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      const service = await serviceRegistryRepository.getById(id);

      if (!service) {
        return reply.status(404).send({ error: 'Service not found' });
      }

      // API spec refresh implementation:
      // To implement this feature, create an ApiSpecExtractor class that:
      // 1. Fetches OpenAPI/Swagger spec from service.serviceUrl + '/openapi.json' or '/swagger.json'
      // 2. Falls back to probing common endpoint patterns if no spec available
      // 3. Parses the spec to extract endpoints, request/response schemas
      // 4. Updates the service_registry with new apiSpec and endpoints
      //
      // For now, return current spec as this is a future enhancement
      logger.info({ serviceId: id, serviceUrl: service.serviceUrl }, 'API spec refresh requested');

      return {
        data: {
          serviceId: id,
          message: 'API spec refresh requires OpenAPI endpoint on service. Current spec returned.',
          hint: 'Expose /openapi.json or /swagger.json on your service for auto-discovery',
          currentSpec: safeJsonParse(service.apiSpec),
          currentEndpoints: safeJsonParse(service.endpoints) ?? [],
        },
      };
    }
  );

  // Health check a service
  app.post(
    '/:id/health-check',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      const service = await serviceRegistryRepository.getById(id);

      if (!service) {
        return reply.status(404).send({ error: 'Service not found' });
      }

      const healthEndpoint = service.healthEndpoint ?? '/health';

      // If serviceUrl is a relative proxy path (e.g. /apps/<name>/), use
      // internal K8s ClusterIP DNS since Node.js fetch needs absolute URLs.
      let healthUrl: string;
      const proxyMatch = service.serviceUrl.match(/^\/apps\/([^/]+)/);
      if (proxyMatch) {
        const svcName = proxyMatch[1];
        const ns = process.env.DEV_NAMESPACE || 'development';
        healthUrl = `http://${svcName}.${ns}.svc.cluster.local:80${healthEndpoint}`;
      } else {
        healthUrl = `${service.serviceUrl.replace(/\/$/, '')}${healthEndpoint}`;
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(healthUrl, {
          method: 'GET',
          signal: controller.signal,
        });
        clearTimeout(timeout);

        const isHealthy = response.ok;
        const newStatus: ServiceStatus = isHealthy ? 'active' : 'degraded';

        // Update service status
        await serviceRegistryRepository.updateStatus(id, newStatus);

        const data = await response.json().catch(() => null) as { status?: string } | null;

        return {
          data: {
            serviceId: id,
            success: isHealthy,
            status: response.status,
            serviceStatus: newStatus,
            message: isHealthy
              ? data?.status === 'ok'
                ? 'Healthy'
                : `Status ${response.status}`
              : `Error ${response.status}`,
            endpoint: healthUrl,
            timestamp: new Date().toISOString(),
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Connection failed';

        // Mark service as unavailable
        await serviceRegistryRepository.updateStatus(id, 'unavailable');

        return {
          data: {
            serviceId: id,
            success: false,
            status: 0,
            serviceStatus: 'unavailable',
            message: errorMessage.includes('abort') ? 'Timeout' : 'Connection failed',
            endpoint: healthUrl,
            timestamp: new Date().toISOString(),
          },
        };
      }
    }
  );

  // Update service status manually
  app.patch(
    '/:id/status',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { status: ServiceStatus };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { status } = request.body;

      const service = await serviceRegistryRepository.getById(id);

      if (!service) {
        return reply.status(404).send({ error: 'Service not found' });
      }

      const validStatuses: ServiceStatus[] = ['active', 'degraded', 'unavailable', 'retired'];
      if (!validStatuses.includes(status)) {
        return reply.status(400).send({ error: 'Invalid status' });
      }

      const updated = await serviceRegistryRepository.updateStatus(id, status);

      logger.info({ serviceId: id, status }, 'Service status updated');

      return { data: updated ? parseServiceFields(updated) : null };
    }
  );

  // Delete service from registry
  app.delete(
    '/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      const service = await serviceRegistryRepository.getById(id);

      if (!service) {
        return reply.status(404).send({ error: 'Service not found' });
      }

      await serviceRegistryRepository.delete(id);

      logger.info({ serviceId: id, serviceName: service.name }, 'Service deleted from registry');

      return { message: 'Service deleted successfully' };
    }
  );
}

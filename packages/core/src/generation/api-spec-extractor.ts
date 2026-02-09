/**
 * API Spec Extractor
 * Infers OpenAPI-like specifications from generated Express/Fastify code
 *
 * V2: Now accepts GeneratedSchema to generate accurate request/response schemas
 * instead of generic `{ type: 'object' }` placeholders
 */

import type { GeneratedFile } from './types.js';
import type { ServiceEndpoint, HttpMethod, GeneratedSchema, FieldMetadata } from '@chronosops/shared';
import { createChildLogger } from '@chronosops/shared';

const logger = createChildLogger({ component: 'ApiSpecExtractor' });

export interface ApiSpecExtractionResult {
  success: boolean;
  spec?: {
    openapi: string;
    info: {
      title: string;
      version: string;
      description?: string;
    };
    servers?: Array<{ url: string; description?: string }>;
    paths: Record<string, Record<string, unknown>>;
  };
  endpoints: ServiceEndpoint[];
  error?: string;
  method: 'inferred' | 'openapi' | 'swagger';
}

export class ApiSpecExtractor {
  private schema?: GeneratedSchema;

  /**
   * Extract API spec from generated code files
   *
   * @param files - Generated code files to extract routes from
   * @param appName - Application name for the spec
   * @param schema - Optional GeneratedSchema for accurate request/response bodies
   */
  extractFromCode(
    files: GeneratedFile[],
    appName: string,
    schema?: GeneratedSchema
  ): ApiSpecExtractionResult {
    this.schema = schema;
    logger.info({
      fileCount: files.length,
      appName,
      hasSchema: !!schema,
    }, 'Extracting API spec from generated code');

    const endpoints: ServiceEndpoint[] = [];

    // Find route files (typically routes.ts, index.ts with Express routes)
    const routeFiles = files.filter(
      (f) =>
        f.path.includes('routes') ||
        f.path.endsWith('index.ts') ||
        f.path.includes('server') ||
        f.path.includes('app')
    );

    for (const file of routeFiles) {
      const extractedEndpoints = this.parseRoutes(file.content);
      endpoints.push(...extractedEndpoints);
    }

    // If no routes found in specific files, scan all TypeScript files
    if (endpoints.length === 0) {
      for (const file of files) {
        if (file.language === 'typescript' || file.language === 'javascript') {
          const extractedEndpoints = this.parseRoutes(file.content);
          endpoints.push(...extractedEndpoints);
        }
      }
    }

    // Deduplicate endpoints
    const uniqueEndpoints = this.deduplicateEndpoints(endpoints);

    // Ensure list endpoints exist for resources that have CRUD operations
    const completeEndpoints = this.ensureListEndpoints(uniqueEndpoints);

    logger.info({ endpointCount: completeEndpoints.length }, 'API spec extraction complete');

    // Build OpenAPI spec
    const spec = this.buildOpenApiSpec(completeEndpoints, appName);

    return {
      success: true,
      spec,
      endpoints: completeEndpoints,
      method: 'inferred',
    };
  }

  /**
   * Ensure list endpoints exist for resources that have other CRUD operations
   * If a resource has GET/:id, POST, PUT/:id, or DELETE/:id but no GET (list all),
   * log a warning but DON'T add synthetic endpoints - we should only register what actually exists.
   * The code generator prompts should ensure list endpoints are created.
   */
  private ensureListEndpoints(endpoints: ServiceEndpoint[]): ServiceEndpoint[] {
    // Group endpoints by resource
    const resourceMap = new Map<string, ServiceEndpoint[]>();
    for (const endpoint of endpoints) {
      const resource = this.getResourceFromPath(endpoint.path);
      if (!resourceMap.has(resource)) {
        resourceMap.set(resource, []);
      }
      resourceMap.get(resource)!.push(endpoint);
    }

    // Just validate - don't add synthetic endpoints
    for (const [resource, resourceEndpoints] of resourceMap) {
      // Check if this resource has any CRUD operations
      const hasCrudOps = resourceEndpoints.some(
        (e) =>
          (e.method === 'GET' && e.path.includes(':')) ||
          e.method === 'POST' ||
          e.method === 'PUT' ||
          e.method === 'PATCH' ||
          e.method === 'DELETE'
      );

      // Check if list endpoint exists
      const hasListEndpoint = resourceEndpoints.some(
        (e) => e.method === 'GET' && !e.path.includes(':')
      );

      // Log warning if list endpoint is missing but CRUD ops exist
      // This indicates the code generator may need improvement
      if (hasCrudOps && !hasListEndpoint) {
        logger.warn({ resource }, 'Missing list endpoint for resource with CRUD operations - code generator should create this');
      }
    }

    // Return endpoints as-is without synthetic additions
    return endpoints;
  }

  /**
   * Extract resource name from path (e.g., /todos/:id -> todos)
   */
  private getResourceFromPath(path: string): string {
    const parts = path.split('/').filter((p) => p && !p.startsWith(':'));
    return parts[0] ?? 'items';
  }

  /**
   * Parse Express/Fastify routes from TypeScript code
   */
  parseRoutes(code: string): ServiceEndpoint[] {
    const endpoints: ServiceEndpoint[] = [];

    // Pattern 1: Express router - app.method('/path', handler) or router.method('/path', handler)
    // Matches: app.get('/todos', ...), router.post('/users', ...)
    const routePatterns = [
      // app.get/post/put/patch/delete('/path', ...)
      /(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
      // fastify.get/post/put/patch/delete('/path', ...)
      /fastify\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
    ];

    for (const pattern of routePatterns) {
      let match;
      while ((match = pattern.exec(code)) !== null) {
        const method = match[1]!.toUpperCase() as HttpMethod;
        const path = match[2]!;

        // Skip internal/health routes
        if (path === '/health' || path === '/' || path.startsWith('/_')) {
          continue;
        }

        const endpoint: ServiceEndpoint = {
          method,
          path,
          description: this.inferDescription(method, path),
        };

        // Try to extract path parameters
        const pathParams = this.extractPathParams(path);
        if (pathParams.length > 0) {
          endpoint.pathParams = pathParams;
        }

        // Try to infer request body for POST/PUT/PATCH
        // V2: Use schema-based request body if available
        if (['POST', 'PUT', 'PATCH'].includes(method)) {
          endpoint.requestBody = {
            contentType: 'application/json',
            schema: this.getRequestBodySchema(method, path),
            required: true,
          };
        }

        // V2: Use schema-based response schema if available
        endpoint.responseSchema = this.getResponseSchema(method, path);

        endpoints.push(endpoint);
      }
    }

    // Pattern 2: Try to extract from comments or JSDoc
    const commentedRoutes = this.extractRoutesFromComments(code);
    endpoints.push(...commentedRoutes);

    return endpoints;
  }

  /**
   * Extract path parameters from route path (e.g., /todos/:id -> ['id'])
   */
  private extractPathParams(path: string): string[] {
    const params: string[] = [];
    const paramPattern = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;
    let match;
    while ((match = paramPattern.exec(path)) !== null) {
      params.push(match[1]!);
    }
    return params;
  }

  /**
   * Infer a description from HTTP method and path
   */
  private inferDescription(method: string, path: string): string {
    const resourceMatch = path.match(/\/([a-zA-Z-_]+)/);
    const resource = resourceMatch ? resourceMatch[1] : 'resource';
    const hasIdParam = path.includes(':id') || path.includes('/:');

    const descriptions: Record<string, Record<string, string>> = {
      GET: {
        list: `List all ${resource}`,
        single: `Get a single ${resource} by ID`,
      },
      POST: {
        default: `Create a new ${resource}`,
      },
      PUT: {
        default: `Update an existing ${resource}`,
      },
      PATCH: {
        default: `Partially update a ${resource}`,
      },
      DELETE: {
        default: `Delete a ${resource}`,
      },
    };

    if (method === 'GET') {
      const getDesc = descriptions['GET']!;
      return hasIdParam ? getDesc['single']! : getDesc['list']!;
    }

    return descriptions[method]?.default ?? `${method} ${path}`;
  }

  /**
   * Extract routes from JSDoc or inline comments
   */
  private extractRoutesFromComments(code: string): ServiceEndpoint[] {
    const endpoints: ServiceEndpoint[] = [];

    // Pattern: @route METHOD /path - description
    const jsdocPattern = /@route\s+(GET|POST|PUT|PATCH|DELETE)\s+([^\s]+)(?:\s+-\s+(.+))?/gi;
    let match;
    while ((match = jsdocPattern.exec(code)) !== null) {
      const endpoint: ServiceEndpoint = {
        method: match[1]!.toUpperCase() as HttpMethod,
        path: match[2]!,
        description: match[3] ?? this.inferDescription(match[1]!.toUpperCase(), match[2]!),
      };

      const pathParams = this.extractPathParams(match[2]!);
      if (pathParams.length > 0) {
        endpoint.pathParams = pathParams;
      }

      endpoints.push(endpoint);
    }

    return endpoints;
  }

  /**
   * Deduplicate endpoints based on method + path
   */
  private deduplicateEndpoints(endpoints: ServiceEndpoint[]): ServiceEndpoint[] {
    const seen = new Set<string>();
    return endpoints.filter((endpoint) => {
      const key = `${endpoint.method}:${endpoint.path}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Build OpenAPI 3.0 spec from endpoints
   */
  private buildOpenApiSpec(
    endpoints: ServiceEndpoint[],
    appName: string
  ): ApiSpecExtractionResult['spec'] {
    const paths: Record<string, Record<string, unknown>> = {};

    for (const endpoint of endpoints) {
      // Convert Express-style path params (:id) to OpenAPI style ({id})
      const openApiPath = endpoint.path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{$1}');

      if (!paths[openApiPath]) {
        paths[openApiPath] = {};
      }

      const operation: Record<string, unknown> = {
        summary: endpoint.description,
        operationId: this.generateOperationId(endpoint.method, endpoint.path),
        tags: endpoint.tags ?? [this.inferTag(endpoint.path)],
        responses: {
          '200': {
            description: 'Successful response',
            content: {
              'application/json': {
                schema: endpoint.responseSchema ?? { type: 'object' },
              },
            },
          },
        },
      };

      // Add path parameters
      if (endpoint.pathParams && endpoint.pathParams.length > 0) {
        operation.parameters = endpoint.pathParams.map((param) => ({
          name: param,
          in: 'path',
          required: true,
          schema: { type: 'string' },
        }));
      }

      // Add query parameters
      if (endpoint.queryParams && endpoint.queryParams.length > 0) {
        const params = (operation.parameters as unknown[]) ?? [];
        for (const qp of endpoint.queryParams) {
          params.push({
            name: qp.name,
            in: 'query',
            required: qp.required ?? false,
            description: qp.description,
            schema: { type: qp.type },
          });
        }
        operation.parameters = params;
      }

      // Add request body
      if (endpoint.requestBody) {
        operation.requestBody = {
          required: endpoint.requestBody.required ?? true,
          content: {
            [endpoint.requestBody.contentType]: {
              schema: endpoint.requestBody.schema,
            },
          },
        };
      }

      paths[openApiPath][endpoint.method.toLowerCase()] = operation;
    }

    return {
      openapi: '3.0.0',
      info: {
        title: appName,
        version: '1.0.0',
        description: `API specification for ${appName}`,
      },
      paths,
    };
  }

  /**
   * Generate operation ID from method and path
   */
  private generateOperationId(method: string, path: string): string {
    // /todos/:id -> TodosById
    // /users -> Users
    const parts = path
      .split('/')
      .filter((p) => p && !p.startsWith(':'))
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1));

    const hasIdParam = path.includes(':');
    const suffix = hasIdParam ? 'ById' : '';

    const methodPrefix: Record<string, string> = {
      GET: hasIdParam ? 'get' : 'list',
      POST: 'create',
      PUT: 'update',
      PATCH: 'patch',
      DELETE: 'delete',
    };

    return `${methodPrefix[method] ?? method.toLowerCase()}${parts.join('')}${suffix}`;
  }

  /**
   * Infer a tag from the path (for grouping endpoints)
   */
  private inferTag(path: string): string {
    const resourceMatch = path.match(/\/([a-zA-Z-_]+)/);
    if (resourceMatch) {
      const resource = resourceMatch[1]!;
      return resource.charAt(0).toUpperCase() + resource.slice(1);
    }
    return 'Default';
  }

  /**
   * Try to fetch OpenAPI spec from a live service endpoint
   */
  async fetchFromService(serviceUrl: string): Promise<ApiSpecExtractionResult> {
    const commonEndpoints = [
      '/openapi.json',
      '/swagger.json',
      '/api-docs',
      '/api/docs',
      '/docs/openapi.json',
    ];

    for (const endpoint of commonEndpoints) {
      try {
        const url = `${serviceUrl.replace(/\/$/, '')}${endpoint}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        clearTimeout(timeout);

        if (response.ok) {
          const spec = await response.json() as ApiSpecExtractionResult['spec'];

          // Validate it looks like an OpenAPI spec
          if (spec && (spec.openapi || (spec as unknown as { swagger: string }).swagger)) {
            logger.info({ serviceUrl, endpoint }, 'Found OpenAPI spec at service');

            // Extract endpoints from spec
            const endpoints = this.extractEndpointsFromOpenApi(spec);

            return {
              success: true,
              spec,
              endpoints,
              method: spec.openapi ? 'openapi' : 'swagger',
            };
          }
        }
      } catch {
        // Continue to next endpoint
      }
    }

    return {
      success: false,
      endpoints: [],
      error: 'No OpenAPI/Swagger spec found at common endpoints',
      method: 'inferred',
    };
  }

  /**
   * Extract ServiceEndpoint array from OpenAPI spec
   */
  private extractEndpointsFromOpenApi(spec: ApiSpecExtractionResult['spec']): ServiceEndpoint[] {
    const endpoints: ServiceEndpoint[] = [];

    if (!spec?.paths) return endpoints;

    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(methods as Record<string, unknown>)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;

        const op = operation as {
          summary?: string;
          description?: string;
          parameters?: Array<{ name: string; in: string; required?: boolean; schema?: { type: string } }>;
          requestBody?: { content?: Record<string, { schema?: unknown }> };
          responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
          tags?: string[];
        };

        // Convert OpenAPI path params {id} back to Express style :id
        const expressPath = path.replace(/\{([^}]+)\}/g, ':$1');

        const endpoint: ServiceEndpoint = {
          method: method.toUpperCase() as HttpMethod,
          path: expressPath,
          description: op.summary ?? op.description ?? `${method.toUpperCase()} ${path}`,
        };

        // Extract path parameters
        const pathParams = op.parameters
          ?.filter((p) => p.in === 'path')
          .map((p) => p.name);
        if (pathParams && pathParams.length > 0) {
          endpoint.pathParams = pathParams;
        }

        // Extract query parameters
        const queryParams = op.parameters
          ?.filter((p) => p.in === 'query')
          .map((p) => ({
            name: p.name,
            type: p.schema?.type ?? 'string',
            required: p.required,
          }));
        if (queryParams && queryParams.length > 0) {
          endpoint.queryParams = queryParams;
        }

        // Extract request body schema
        if (op.requestBody?.content?.['application/json']?.schema) {
          endpoint.requestBody = {
            contentType: 'application/json',
            schema: op.requestBody.content['application/json'].schema as Record<string, unknown>,
            required: true,
          };
        }

        // Extract response schema
        const successResponse = op.responses?.['200'] ?? op.responses?.['201'];
        if (successResponse?.content?.['application/json']?.schema) {
          endpoint.responseSchema = successResponse.content['application/json'].schema as Record<string, unknown>;
        }

        // Add tags
        if (op.tags && op.tags.length > 0) {
          endpoint.tags = op.tags;
        }

        endpoints.push(endpoint);
      }
    }

    return endpoints;
  }

  /**
   * Get request body schema based on HTTP method and path
   * V2: Uses GeneratedSchema for accurate field definitions
   */
  private getRequestBodySchema(method: string, _path: string): Record<string, unknown> {
    if (!this.schema) {
      return { type: 'object' };
    }

    const pascalName = this.toPascalCase(this.schema.resourceName);

    // Determine which fields to include based on method
    let fields: FieldMetadata[];
    let schemaName: string;

    if (method === 'POST') {
      fields = this.schema.fields.filter(f => f.inCreate);
      schemaName = `Create${pascalName}Input`;
    } else {
      // PUT/PATCH - update fields (all optional for PATCH)
      fields = this.schema.fields.filter(f => f.inUpdate);
      schemaName = `Update${pascalName}Input`;
    }

    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const field of fields) {
      properties[field.name] = this.fieldToOpenAPIProperty(field);
      // For POST, required fields are required in request body
      // For PUT/PATCH, fields are typically optional
      if (field.required && method === 'POST') {
        required.push(field.name);
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
      description: `${schemaName} - request body`,
    };
  }

  /**
   * Get response schema based on HTTP method and path
   * V2: Uses GeneratedSchema for accurate field definitions
   */
  private getResponseSchema(method: string, path: string): Record<string, unknown> {
    if (!this.schema) {
      return { type: 'object' };
    }

    const pascalName = this.toPascalCase(this.schema.resourceName);
    const isCollection = method === 'GET' && !path.includes(':');

    // Build entity properties from schema fields
    const properties: Record<string, unknown> = {};
    for (const field of this.schema.fields) {
      properties[field.name] = this.fieldToOpenAPIProperty(field);
    }

    const entitySchema = {
      type: 'object',
      properties,
      required: this.schema.fields.filter(f => f.required).map(f => f.name),
      description: `${pascalName} entity`,
    };

    // For list endpoints, return array of entities
    if (isCollection) {
      return {
        type: 'array',
        items: entitySchema,
        description: `List of ${this.schema.resourceNamePlural}`,
      };
    }

    return entitySchema;
  }

  /**
   * Convert FieldMetadata to OpenAPI property definition
   */
  private fieldToOpenAPIProperty(field: FieldMetadata): Record<string, unknown> {
    const zodType = field.zodType.toLowerCase();

    // Determine OpenAPI type
    let type = 'string';
    let format: string | undefined;

    if (zodType.includes('number')) {
      type = 'number';
    } else if (zodType.includes('int')) {
      type = 'integer';
    } else if (zodType.includes('boolean')) {
      type = 'boolean';
    } else if (zodType.includes('array')) {
      type = 'array';
    } else if (zodType.includes('object')) {
      type = 'object';
    }

    // Determine format from Zod validators
    if (zodType.includes('email')) {
      format = 'email';
    } else if (zodType.includes('uuid')) {
      format = 'uuid';
    } else if (zodType.includes('url')) {
      format = 'uri';
    } else if (zodType.includes('datetime')) {
      format = 'date-time';
    } else if (zodType.includes('date')) {
      format = 'date';
    }

    const property: Record<string, unknown> = { type };
    if (format) property.format = format;
    if (field.description) property.description = field.description;

    // Extract enum values if present
    const enumMatch = zodType.match(/enum\(\[([^\]]+)\]/);
    if (enumMatch?.[1]) {
      property.enum = enumMatch[1]
        .split(',')
        .map(v => v.trim().replace(/['"]/g, ''));
    }

    return property;
  }

  /**
   * Convert string to PascalCase
   */
  private toPascalCase(str: string): string {
    return str
      .split(/[-_\s]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }
}

// Export singleton instance
export const apiSpecExtractor = new ApiSpecExtractor();

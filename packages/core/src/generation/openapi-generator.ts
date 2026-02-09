/**
 * OpenAPI Generator
 * Generates OpenAPI 3.0 specifications from architecture designs and Zod schemas.
 * Used to create documentation endpoints for generated APIs.
 *
 * V2: Now accepts GeneratedSchema to ensure OpenAPI specs match actual Zod validation
 */

import { createChildLogger } from '@chronosops/shared';
import type { ArchitectureDesign, ComponentSpec, GeneratedSchema, FieldMetadata } from '@chronosops/shared';

const logger = createChildLogger({ component: 'OpenAPIGenerator' });

/**
 * Input for generating OpenAPI spec
 */
export interface OpenAPIGeneratorInput {
  appName: string;
  version: string;
  description: string;
  endpoints: EndpointSpec[];
  schemas: SchemaInfo[];
}

/**
 * Specification for an API endpoint
 */
export interface EndpointSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  summary: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  requestBodySchema?: string;
  responseSchema?: string;
  pathParams?: ParamSpec[];
  queryParams?: ParamSpec[];
  responses?: Record<string, ResponseSpec>;
}

/**
 * Parameter specification
 */
export interface ParamSpec {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
}

/**
 * Response specification
 */
export interface ResponseSpec {
  description: string;
  schema?: string;
}

/**
 * Schema information
 */
export interface SchemaInfo {
  name: string;
  properties: PropertySpec[];
  required?: string[];
  description?: string;
}

/**
 * Property specification
 */
export interface PropertySpec {
  name: string;
  type: string;
  format?: string;
  description?: string;
  required?: boolean;
  items?: PropertySpec;
  enum?: string[];
}

/**
 * Generate OpenAPI 3.0 specification
 */
export function generateOpenAPISpec(input: OpenAPIGeneratorInput): object {
  logger.debug({ appName: input.appName, endpointCount: input.endpoints.length }, 'Generating OpenAPI spec');

  const paths: Record<string, Record<string, object>> = {};
  const components: { schemas: Record<string, object> } = { schemas: {} };

  // Generate schemas
  for (const schema of input.schemas) {
    components.schemas[schema.name] = convertSchemaToOpenAPI(schema);
  }

  // Generate paths
  for (const endpoint of input.endpoints) {
    const pathKey = endpoint.path;
    if (!paths[pathKey]) {
      paths[pathKey] = {};
    }

    const operation = generateOperation(endpoint);
    paths[pathKey][endpoint.method.toLowerCase()] = operation;
  }

  return {
    openapi: '3.0.0',
    info: {
      title: input.appName,
      version: input.version,
      description: input.description,
    },
    servers: [
      {
        url: '/',
        description: 'Current server',
      },
    ],
    paths,
    components,
  };
}

/**
 * Generate an OpenAPI operation object
 */
function generateOperation(endpoint: EndpointSpec): object {
  const operation: Record<string, unknown> = {
    summary: endpoint.summary,
    operationId: endpoint.operationId || generateOperationId(endpoint.method, endpoint.path),
  };

  if (endpoint.description) {
    operation.description = endpoint.description;
  }

  if (endpoint.tags && endpoint.tags.length > 0) {
    operation.tags = endpoint.tags;
  }

  // Add parameters
  const parameters: object[] = [];

  // Path parameters
  if (endpoint.pathParams) {
    for (const param of endpoint.pathParams) {
      parameters.push({
        name: param.name,
        in: 'path',
        required: true,
        schema: { type: mapTypeToOpenAPI(param.type) },
        description: param.description,
      });
    }
  }

  // Query parameters
  if (endpoint.queryParams) {
    for (const param of endpoint.queryParams) {
      parameters.push({
        name: param.name,
        in: 'query',
        required: param.required ?? false,
        schema: { type: mapTypeToOpenAPI(param.type) },
        description: param.description,
      });
    }
  }

  // Extract path params from path pattern
  const pathParamMatches = endpoint.path.match(/:(\w+)/g);
  if (pathParamMatches) {
    for (const match of pathParamMatches) {
      const paramName = match.slice(1); // Remove leading :
      if (!parameters.some(p => (p as { name: string }).name === paramName)) {
        parameters.push({
          name: paramName,
          in: 'path',
          required: true,
          schema: { type: 'string' },
        });
      }
    }
  }

  if (parameters.length > 0) {
    operation.parameters = parameters;
  }

  // Request body
  if (endpoint.requestBodySchema && ['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
    operation.requestBody = {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: `#/components/schemas/${endpoint.requestBodySchema}` },
        },
      },
    };
  }

  // Responses
  if (endpoint.responses) {
    operation.responses = {};
    for (const [code, response] of Object.entries(endpoint.responses)) {
      const responseObj: Record<string, unknown> = {
        description: response.description,
      };
      if (response.schema) {
        responseObj.content = {
          'application/json': {
            schema: { $ref: `#/components/schemas/${response.schema}` },
          },
        };
      }
      (operation.responses as Record<string, unknown>)[code] = responseObj;
    }
  } else {
    // Default responses
    operation.responses = generateDefaultResponses(endpoint);
  }

  return operation;
}

/**
 * Generate default responses based on HTTP method
 */
function generateDefaultResponses(endpoint: EndpointSpec): Record<string, object> {
  const responses: Record<string, object> = {};

  switch (endpoint.method) {
    case 'GET':
      responses['200'] = {
        description: 'Success',
        content: endpoint.responseSchema
          ? {
              'application/json': {
                schema: { $ref: `#/components/schemas/${endpoint.responseSchema}` },
              },
            }
          : {
              'application/json': {
                schema: { type: 'object' },
              },
            },
      };
      if (endpoint.path.includes(':')) {
        responses['404'] = { description: 'Resource not found' };
      }
      break;

    case 'POST':
      responses['201'] = {
        description: 'Created',
        content: endpoint.responseSchema
          ? {
              'application/json': {
                schema: { $ref: `#/components/schemas/${endpoint.responseSchema}` },
              },
            }
          : {
              'application/json': {
                schema: { type: 'object' },
              },
            },
      };
      responses['400'] = { description: 'Validation error' };
      break;

    case 'PUT':
    case 'PATCH':
      responses['200'] = {
        description: 'Updated',
        content: endpoint.responseSchema
          ? {
              'application/json': {
                schema: { $ref: `#/components/schemas/${endpoint.responseSchema}` },
              },
            }
          : {
              'application/json': {
                schema: { type: 'object' },
              },
            },
      };
      responses['400'] = { description: 'Validation error' };
      responses['404'] = { description: 'Resource not found' };
      break;

    case 'DELETE':
      responses['204'] = { description: 'Deleted' };
      responses['404'] = { description: 'Resource not found' };
      break;
  }

  responses['500'] = { description: 'Internal server error' };

  return responses;
}

/**
 * Convert schema info to OpenAPI schema format
 */
function convertSchemaToOpenAPI(schema: SchemaInfo): object {
  const properties: Record<string, object> = {};
  const required: string[] = [];

  for (const prop of schema.properties) {
    properties[prop.name] = convertPropertyToOpenAPI(prop);
    if (prop.required !== false) {
      required.push(prop.name);
    }
  }

  const result: Record<string, unknown> = {
    type: 'object',
    properties,
  };

  if (required.length > 0) {
    result.required = schema.required ?? required;
  }

  if (schema.description) {
    result.description = schema.description;
  }

  return result;
}

/**
 * Convert property to OpenAPI format
 */
function convertPropertyToOpenAPI(prop: PropertySpec): object {
  const result: Record<string, unknown> = {
    type: mapTypeToOpenAPI(prop.type),
  };

  if (prop.format) {
    result.format = prop.format;
  }

  if (prop.description) {
    result.description = prop.description;
  }

  if (prop.enum) {
    result.enum = prop.enum;
  }

  if (prop.type === 'array' && prop.items) {
    result.items = convertPropertyToOpenAPI(prop.items);
  }

  return result;
}

/**
 * Map TypeScript/Zod types to OpenAPI types
 */
function mapTypeToOpenAPI(type: string): string {
  const typeMap: Record<string, string> = {
    string: 'string',
    number: 'number',
    boolean: 'boolean',
    int: 'integer',
    integer: 'integer',
    array: 'array',
    object: 'object',
    date: 'string',
    datetime: 'string',
    uuid: 'string',
  };

  return typeMap[type.toLowerCase()] ?? 'string';
}

/**
 * Generate operation ID from method and path
 */
function generateOperationId(method: string, path: string): string {
  // Extract resource name from path
  const parts = path.split('/').filter(Boolean);
  const resourceParts: string[] = [];

  for (const part of parts) {
    if (!part.startsWith(':')) {
      resourceParts.push(part);
    }
  }

  const resource = resourceParts.join('-');
  const hasId = path.includes(':');

  switch (method) {
    case 'GET':
      return hasId ? `get${capitalize(singularize(resource))}ById` : `list${capitalize(resource)}`;
    case 'POST':
      return `create${capitalize(singularize(resource))}`;
    case 'PUT':
    case 'PATCH':
      return `update${capitalize(singularize(resource))}`;
    case 'DELETE':
      return `delete${capitalize(singularize(resource))}`;
    default:
      return `${method.toLowerCase()}${capitalize(resource)}`;
  }
}

/**
 * Capitalize first letter
 */
function capitalize(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Basic singularization (handles common cases)
 */
function singularize(str: string): string {
  if (!str) return '';
  if (str.endsWith('ies')) {
    return str.slice(0, -3) + 'y';
  }
  if (str.endsWith('es') && !str.endsWith('ses') && !str.endsWith('xes')) {
    return str.slice(0, -2);
  }
  if (str.endsWith('s') && !str.endsWith('ss')) {
    return str.slice(0, -1);
  }
  return str;
}

/**
 * Generate OpenAPI spec from architecture design
 *
 * V2: Now accepts optional GeneratedSchema to use actual Zod field definitions
 * instead of inferring from component interfaces
 *
 * @param design - Architecture design with component specifications
 * @param schema - Optional GeneratedSchema with Zod field metadata
 */
export function generateOpenAPIFromDesign(
  design: ArchitectureDesign,
  schema?: GeneratedSchema
): object {
  const endpoints: EndpointSpec[] = [];
  let schemas: SchemaInfo[] = [];

  // Extract app name from components
  const appComponent = design.components.find(
    (c) => c.name.toLowerCase().includes('app') || c.name.toLowerCase().includes('server')
  );
  const appName = appComponent?.name ?? 'API';

  // V2: If we have a GeneratedSchema, use it to create accurate OpenAPI schemas
  if (schema) {
    logger.debug({
      resourceName: schema.resourceName,
      fieldCount: schema.fields.length,
    }, 'Using GeneratedSchema for OpenAPI specification');

    schemas = convertGeneratedSchemaToOpenAPI(schema);

    // Generate endpoints based on schema resource
    const schemaEndpoints = generateEndpointsFromSchema(schema);
    endpoints.push(...schemaEndpoints);
  }

  // Extract additional endpoints and schemas from components
  for (const component of design.components) {
    const componentEndpoints = extractEndpointsFromComponent(component, schema);
    // Filter out duplicates if we already have schema-based endpoints
    for (const ep of componentEndpoints) {
      const isDuplicate = endpoints.some(
        existing => existing.path === ep.path && existing.method === ep.method
      );
      if (!isDuplicate) {
        endpoints.push(ep);
      }
    }

    // Only extract schemas from components if we don't have a GeneratedSchema
    if (!schema) {
      const componentSchemas = extractSchemasFromComponent(component);
      schemas.push(...componentSchemas);
    }
  }

  return generateOpenAPISpec({
    appName,
    version: '1.0.0',
    description: design.overview,
    endpoints,
    schemas,
  });
}

/**
 * Convert GeneratedSchema to OpenAPI SchemaInfo format
 */
function convertGeneratedSchemaToOpenAPI(schema: GeneratedSchema): SchemaInfo[] {
  const schemas: SchemaInfo[] = [];
  const pascalName = toPascalCase(schema.resourceName);

  // Entity schema (full object with all fields)
  schemas.push({
    name: pascalName,
    description: `${pascalName} entity`,
    properties: schema.fields.map(f => fieldMetadataToProperty(f)),
    required: schema.fields.filter(f => f.required).map(f => f.name),
  });

  // Create input schema (fields with inCreate: true)
  const createFields = schema.fields.filter(f => f.inCreate);
  schemas.push({
    name: `Create${pascalName}Input`,
    description: `Input for creating a new ${schema.resourceName}`,
    properties: createFields.map(f => fieldMetadataToProperty(f)),
    required: createFields.filter(f => f.required).map(f => f.name),
  });

  // Update input schema (fields with inUpdate: true, all optional)
  const updateFields = schema.fields.filter(f => f.inUpdate);
  schemas.push({
    name: `Update${pascalName}Input`,
    description: `Input for updating a ${schema.resourceName}`,
    properties: updateFields.map(f => ({
      ...fieldMetadataToProperty(f),
      required: false,
    })),
  });

  return schemas;
}

/**
 * Convert FieldMetadata to OpenAPI PropertySpec
 */
function fieldMetadataToProperty(field: FieldMetadata): PropertySpec {
  const zodType = field.zodType.toLowerCase();

  // Determine OpenAPI type and format from Zod type
  let type = 'string';
  let format: string | undefined;

  if (zodType.includes('number') || zodType.includes('int')) {
    type = zodType.includes('int') ? 'integer' : 'number';
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

  // Extract enum values if present
  let enumValues: string[] | undefined;
  const enumMatch = zodType.match(/enum\(\[([^\]]+)\]/);
  if (enumMatch?.[1]) {
    enumValues = enumMatch[1]
      .split(',')
      .map(v => v.trim().replace(/['"]/g, ''));
  }

  return {
    name: field.name,
    type,
    format,
    description: field.description,
    required: field.required,
    enum: enumValues,
  };
}

/**
 * Generate REST endpoints from schema
 */
function generateEndpointsFromSchema(schema: GeneratedSchema): EndpointSpec[] {
  const pascalName = toPascalCase(schema.resourceName);
  const resourcePath = `/${schema.resourceNamePlural}`;

  return [
    {
      method: 'GET',
      path: resourcePath,
      summary: `List all ${schema.resourceNamePlural}`,
      operationId: `list${pascalName}s`,
      tags: [pascalName],
      responseSchema: pascalName,
      responses: {
        '200': {
          description: `List of ${schema.resourceNamePlural}`,
          schema: pascalName,
        },
      },
    },
    {
      method: 'POST',
      path: resourcePath,
      summary: `Create a new ${schema.resourceName}`,
      operationId: `create${pascalName}`,
      tags: [pascalName],
      requestBodySchema: `Create${pascalName}Input`,
      responseSchema: pascalName,
      responses: {
        '201': { description: `${pascalName} created`, schema: pascalName },
        '400': { description: 'Validation error' },
      },
    },
    {
      method: 'GET',
      path: `${resourcePath}/:id`,
      summary: `Get a ${schema.resourceName} by ID`,
      operationId: `get${pascalName}ById`,
      tags: [pascalName],
      pathParams: [{ name: 'id', type: 'string', description: `${pascalName} ID` }],
      responseSchema: pascalName,
      responses: {
        '200': { description: `${pascalName} found`, schema: pascalName },
        '404': { description: `${pascalName} not found` },
      },
    },
    {
      method: 'PUT',
      path: `${resourcePath}/:id`,
      summary: `Update a ${schema.resourceName}`,
      operationId: `update${pascalName}`,
      tags: [pascalName],
      pathParams: [{ name: 'id', type: 'string', description: `${pascalName} ID` }],
      requestBodySchema: `Update${pascalName}Input`,
      responseSchema: pascalName,
      responses: {
        '200': { description: `${pascalName} updated`, schema: pascalName },
        '400': { description: 'Validation error' },
        '404': { description: `${pascalName} not found` },
      },
    },
    {
      method: 'DELETE',
      path: `${resourcePath}/:id`,
      summary: `Delete a ${schema.resourceName}`,
      operationId: `delete${pascalName}`,
      tags: [pascalName],
      pathParams: [{ name: 'id', type: 'string', description: `${pascalName} ID` }],
      responses: {
        '204': { description: `${pascalName} deleted` },
        '404': { description: `${pascalName} not found` },
      },
    },
  ];
}

/**
 * Convert string to PascalCase
 */
function toPascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

/**
 * Extract endpoints from component specification
 *
 * V2: Now uses schema-based request/response schemas if available
 */
function extractEndpointsFromComponent(
  component: ComponentSpec,
  schema?: GeneratedSchema
): EndpointSpec[] {
  const endpoints: EndpointSpec[] = [];
  const pascalName = schema ? toPascalCase(schema.resourceName) : null;

  for (const iface of component.interface) {
    // Determine HTTP method and path from interface name
    const { method, path } = inferEndpointFromInterface(iface.name, component.name);
    if (!method || !path) continue;

    // V2: Use schema-based request body names if we have a schema
    let requestBodySchema: string | undefined;
    if (method !== 'GET' && method !== 'DELETE') {
      if (schema && pascalName) {
        const ifaceName = iface.name.toLowerCase();
        if (ifaceName.startsWith('create') || ifaceName.startsWith('add')) {
          requestBodySchema = `Create${pascalName}Input`;
        } else if (ifaceName.startsWith('update') || ifaceName.startsWith('edit')) {
          requestBodySchema = `Update${pascalName}Input`;
        }
      }
      // Fall back to generic inference if no schema
      requestBodySchema = requestBodySchema ?? inferRequestSchema(iface.name);
    }

    endpoints.push({
      method,
      path,
      summary: iface.description ?? iface.name,
      tags: [component.name],
      responseSchema: schema ? pascalName ?? undefined : inferSchemaFromType(iface.returnType),
      requestBodySchema,
    });
  }

  return endpoints;
}

/**
 * Infer HTTP method and path from interface method name
 */
function inferEndpointFromInterface(
  methodName: string,
  componentName: string
): { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path?: string } {
  const name = methodName.toLowerCase();
  const resource = componentName
    .replace(/App|Service|Controller|Repository/gi, '')
    .toLowerCase();
  const resourcePath = `/${resource}s`;

  if (name.startsWith('list') || name.startsWith('getall') || name.startsWith('findall')) {
    return { method: 'GET', path: resourcePath };
  }
  if (name.startsWith('get') || name.startsWith('find') || name.startsWith('fetch')) {
    return { method: 'GET', path: `${resourcePath}/:id` };
  }
  if (name.startsWith('create') || name.startsWith('add')) {
    return { method: 'POST', path: resourcePath };
  }
  if (name.startsWith('update') || name.startsWith('edit') || name.startsWith('modify')) {
    return { method: 'PUT', path: `${resourcePath}/:id` };
  }
  if (name.startsWith('delete') || name.startsWith('remove')) {
    return { method: 'DELETE', path: `${resourcePath}/:id` };
  }

  return {};
}

/**
 * Infer schema name from return type
 */
function inferSchemaFromType(returnType: string): string | undefined {
  if (!returnType) return undefined;

  // Extract type from Promise<Type>, Type[], etc.
  const match = returnType.match(/(?:Promise<)?(\w+)(?:\[\])?(?:>)?/);
  if (match && match[1] && !['void', 'boolean', 'string', 'number'].includes(match[1].toLowerCase())) {
    return match[1];
  }
  return undefined;
}

/**
 * Infer request schema from method name
 */
function inferRequestSchema(methodName: string): string | undefined {
  const name = methodName.toLowerCase();

  if (name.startsWith('create') || name.startsWith('add')) {
    return 'CreateInput';
  }
  if (name.startsWith('update') || name.startsWith('edit') || name.startsWith('modify')) {
    return 'UpdateInput';
  }
  return undefined;
}

/**
 * Extract schemas from component specification
 */
function extractSchemasFromComponent(component: ComponentSpec): SchemaInfo[] {
  const schemas: SchemaInfo[] = [];
  const seenSchemas = new Set<string>();

  for (const iface of component.interface) {
    // Check return type for potential entity schema
    const returnSchema = inferSchemaFromType(iface.returnType);
    if (returnSchema && !seenSchemas.has(returnSchema)) {
      seenSchemas.add(returnSchema);
      schemas.push({
        name: returnSchema,
        properties: [
          { name: 'id', type: 'string', format: 'uuid', required: true },
        ],
        description: `${returnSchema} entity`,
      });
    }

    // Check parameters for input schemas
    for (const param of iface.parameters) {
      const paramSchema = inferSchemaFromType(param.type);
      if (paramSchema && paramSchema.endsWith('Input') && !seenSchemas.has(paramSchema)) {
        seenSchemas.add(paramSchema);
        schemas.push({
          name: paramSchema,
          properties: [],
          description: `${paramSchema} schema`,
        });
      }
    }
  }

  return schemas;
}

/**
 * Generate Swagger UI HTML template
 */
export function generateSwaggerUIHtml(appName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\${appName} - API Documentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.18.2/swagger-ui.css">
  <style>
    body { margin: 0; padding: 0; }
    .swagger-ui .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.18.2/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis]
      });
    };
  </script>
</body>
</html>`.replace(/\${appName}/g, appName);
}

/**
 * Generate documentation code block for injection into generated APIs
 */
export function generateDocumentationCode(appName: string, description: string, openApiSpec: object): string {
  const specJson = JSON.stringify(openApiSpec, null, 2)
    .replace(/'/g, "\\'")
    .split('\n')
    .join('\n');

  const swaggerHtml = generateSwaggerUIHtml(appName)
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');

  return `
// =============================================================================
// API DOCUMENTATION
// =============================================================================

const API_INFO = {
  name: '${appName}',
  version: '1.0.0',
  description: '${description.replace(/'/g, "\\'")}',
};

const openApiSpec = ${specJson};

const swaggerHtml = \`${swaggerHtml}\`;

// Root endpoint - API metadata
app.get('/', (_req: Request, res: Response) => {
  res.json({
    ...API_INFO,
    docs: '/docs',
    openapi: '/openapi.json',
    health: '/health',
    metrics: '/metrics',
  });
});

// OpenAPI specification endpoint
app.get('/openapi.json', (_req: Request, res: Response) => {
  res.json(openApiSpec);
});

// Swagger UI documentation
app.get('/docs', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(swaggerHtml);
});
`;
}

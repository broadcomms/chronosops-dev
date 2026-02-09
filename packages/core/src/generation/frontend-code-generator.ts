/**
 * Frontend Code Generator
 * Generates React frontends using Vite + TanStack Query + Tailwind
 */

import type { GeminiClient } from '@chronosops/gemini';
import type {
  FrontendConfig,
  ServiceEndpoint,
  RegisteredService,
  ArchitectureDesign,
} from '@chronosops/shared';
import type { GeneratedFile } from './types.js';
import { createChildLogger } from '@chronosops/shared';

const logger = createChildLogger({ component: 'FrontendCodeGenerator' });

/**
 * Introspected field from API response
 */
export interface IntrospectedField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'unknown';
  required: boolean;
  isId?: boolean;
  isTimestamp?: boolean;
}

/**
 * Introspected API schema
 */
export interface IntrospectedSchema {
  resourceName: string;
  fields: IntrospectedField[];
  createFields: IntrospectedField[]; // Fields needed for creation (excludes id, timestamps)
}

export interface FrontendGenerationInput {
  /** App name */
  name: string;
  /** User requirement description */
  requirement: string;
  /** Frontend configuration */
  config: FrontendConfig;
  /** Backend services this frontend consumes */
  consumedServices: Array<{
    service: RegisteredService;
    endpoints: ServiceEndpoint[];
  }>;
  /** Architecture design from AI */
  architecture?: ArchitectureDesign;
}

export interface FrontendGenerationResult {
  success: boolean;
  files: GeneratedFile[];
  entryPoint: string;
  error?: string;
}

export class FrontendCodeGenerator {
  // Cache for introspected schemas
  private schemaCache: Map<string, IntrospectedSchema> = new Map();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_geminiClient: GeminiClient) {
    // GeminiClient reserved for future AI-based component generation
  }

  /**
   * Introspect a backend API to discover its actual schema
   * First tries /api-docs.json for accurate schema, then falls back to runtime introspection
   */
  private async introspectApiSchema(
    service: RegisteredService,
    endpoints: ServiceEndpoint[]
  ): Promise<IntrospectedSchema | null> {
    const cacheKey = `${service.id}-${service.name}`;
    if (this.schemaCache.has(cacheKey)) {
      return this.schemaCache.get(cacheKey)!;
    }

    // Filter out non-resource endpoints (api-docs, health, openapi, etc.)
    const resourceEndpoints = endpoints.filter(
      (e) => !e.path.includes('api-docs') && 
             !e.path.includes('health') && 
             !e.path.includes('openapi') &&
             e.path !== '/'
    );

    // Find the primary resource endpoint (first GET without path params)
    const primaryEndpoint = resourceEndpoints.find(
      (e) => e.method === 'GET' && !e.path.includes(':')
    );
    const resourceName = this.getResourceNameFromPath(primaryEndpoint?.path ?? resourceEndpoints[0]?.path ?? '/items');
    
    logger.info(
      { serviceName: service.name, serviceUrl: service.serviceUrl, resourceName },
      'Introspecting backend API schema'
    );

    // First, try to fetch /api-docs.json for accurate schema (preferred method)
    if (service.serviceUrl) {
      const schema = await this.fetchOpenApiSchema(service.serviceUrl, resourceName);
      if (schema) {
        this.schemaCache.set(cacheKey, schema);
        logger.info(
          { serviceName: service.name, fieldCount: schema.fields.length },
          'Successfully fetched schema from /api-docs.json'
        );
        return schema;
      }
    }

    // Fallback: Runtime introspection from GET/POST responses
    logger.info({ serviceName: service.name }, 'Falling back to runtime introspection');
    
    const fields: IntrospectedField[] = [];
    const fieldNames = new Set<string>();

    // Find list endpoint to get sample data (use resourceEndpoints which excludes api-docs, health, etc.)
    const listEndpoint = resourceEndpoints.find(
      (e) => e.method === 'GET' && !e.path.includes(':')
    );

    if (listEndpoint && service.serviceUrl) {
      try {
        // Try to fetch existing items
        const listUrl = `${service.serviceUrl}${listEndpoint.path}`;
        logger.info({ listUrl }, 'Fetching list endpoint for schema introspection');

        const listResponse = await fetch(listUrl, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(5000),
        });

        if (listResponse.ok) {
          const data = await listResponse.json() as Record<string, unknown> | unknown[];
          
          // Handle both array and {data: array} response formats
          const items = Array.isArray(data) 
            ? data 
            : (Array.isArray((data as Record<string, unknown>).data) 
                ? (data as Record<string, unknown>).data as unknown[]
                : []);
          
          // Analyze ALL items to discover all possible fields (not just the first)
          for (const item of items) {
            const sample = item as Record<string, unknown>;
            this.extractFieldsFromObject(sample, fields, fieldNames);
          }
          
          if (fields.length > 0) {
            logger.info(
              { fieldCount: fields.length, fields: fields.map(f => f.name), itemsAnalyzed: items.length },
              'Discovered schema from list response'
            );
          }
        }
      } catch (error) {
        logger.warn(
          { error: error instanceof Error ? error.message : 'Unknown', serviceUrl: service.serviceUrl },
          'Failed to introspect list endpoint'
        );
      }
    }

    // ALWAYS try POST to get complete schema (existing items may have missing optional fields)
    const createEndpoint = resourceEndpoints.find((e) => e.method === 'POST');
    if (createEndpoint && service.serviceUrl) {
      try {
        // Send a test POST with common field names to discover full schema
        const createUrl = `${service.serviceUrl}${createEndpoint.path}`;
        logger.info({ createUrl, existingFields: fields.length }, 'Trying POST endpoint for complete schema introspection');

        // Try with common field names to trigger all optional fields
        const testBody = { 
          title: 'ChronosOps Schema Discovery Test', 
          name: 'ChronosOps Schema Discovery Test',
          description: 'Auto-generated for schema discovery - will be deleted',
          content: 'Test content for schema discovery',
          completed: false,
          status: 'pending',
        };

        const createResponse = await fetch(createUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(testBody),
          signal: AbortSignal.timeout(5000),
        });

        if (createResponse.ok || createResponse.status === 201) {
          const created = await createResponse.json() as Record<string, unknown>;
          // Handle {data: object} or object response
          const item = (created.data ?? created) as Record<string, unknown>;
          const newFieldCount = this.extractFieldsFromObject(item, fields, fieldNames);
          
          if (newFieldCount > 0) {
            logger.info(
              { newFieldsDiscovered: newFieldCount, totalFields: fields.length, fields: fields.map(f => f.name) },
              'Discovered additional fields from POST response'
            );
          }
          
          // Try to delete the test item to clean up
          const itemId = item.id ?? item._id;
          if (itemId) {
            const deleteEndpoint = resourceEndpoints.find((e) => e.method === 'DELETE');
            if (deleteEndpoint && service.serviceUrl) {
              try {
                const deleteUrl = `${service.serviceUrl}${deleteEndpoint.path.replace(':id', String(itemId))}`;
                await fetch(deleteUrl, { 
                  method: 'DELETE',
                  signal: AbortSignal.timeout(3000),
                });
                logger.debug({ itemId }, 'Cleaned up test item after schema discovery');
              } catch {
                // Ignore delete errors - not critical
              }
            }
          }
        }
      } catch (error) {
        logger.warn(
          { error: error instanceof Error ? error.message : 'Unknown' },
          'Failed to introspect POST endpoint'
        );
      }
    }

    // If still no fields, fail fast - no fallbacks allowed
    if (fields.length === 0) {
      logger.error({ serviceName: service.name, serviceUrl: service.serviceUrl }, 
        'Schema introspection failed: No fields found from /api-docs.json or API responses');
      return null;
    }

    // Separate create fields (exclude id, timestamps)
    const createFields = fields.filter(
      (f) => !f.isId && !f.isTimestamp
    );

    const schema: IntrospectedSchema = {
      resourceName,
      fields,
      createFields,
    };

    this.schemaCache.set(cacheKey, schema);
    return schema;
  }

  /**
   * Fetch OpenAPI schema from /api-docs.json endpoint
   * This is the preferred method as it provides accurate schema from Zod definitions
   */
  private async fetchOpenApiSchema(
    serviceUrl: string,
    resourceName: string
  ): Promise<IntrospectedSchema | null> {
    const apiDocsUrl = `${serviceUrl}/api-docs.json`;
    logger.info({ apiDocsUrl }, 'Fetching OpenAPI schema from /api-docs.json');

    try {
      const response = await fetch(apiDocsUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        logger.debug({ status: response.status }, 'No /api-docs.json endpoint found');
        return null;
      }

      const apiDocs = await response.json() as Record<string, unknown>;
      
      // Extract schema from OpenAPI components
      const components = apiDocs.components as Record<string, unknown> | undefined;
      const schemas = components?.schemas as Record<string, unknown> | undefined;
      
      if (!schemas) {
        logger.debug({}, 'No schemas found in OpenAPI spec');
        return null;
      }

      // Find the main resource schema (e.g., Task, Item)
      const singularName = resourceName.endsWith('s') ? resourceName.slice(0, -1) : resourceName;
      const pascalName = singularName.charAt(0).toUpperCase() + singularName.slice(1);
      
      // Try various naming conventions
      const schemaKey = Object.keys(schemas).find(
        key => key.toLowerCase() === singularName.toLowerCase() ||
               key.toLowerCase() === pascalName.toLowerCase() ||
               key === pascalName
      );

      if (!schemaKey) {
        logger.debug({ availableSchemas: Object.keys(schemas) }, 'Could not find matching schema');
        return null;
      }

      const resourceSchema = schemas[schemaKey] as Record<string, unknown>;
      const properties = resourceSchema.properties as Record<string, { type: string; required?: boolean }> | undefined;

      if (!properties) {
        logger.debug({}, 'No properties found in resource schema');
        return null;
      }

      // Convert OpenAPI properties to IntrospectedField[]
      const fields: IntrospectedField[] = [];
      for (const [name, prop] of Object.entries(properties)) {
        const field: IntrospectedField = {
          name,
          type: this.mapOpenApiTypeToFieldType(prop.type),
          required: prop.required ?? true,
          isId: name === 'id' || name === '_id',
          isTimestamp: ['createdAt', 'updatedAt', 'created_at', 'updated_at', 'timestamp'].includes(name),
        };
        fields.push(field);
      }

      // Also try to get CreateInput schema for form fields
      const createSchemaKey = Object.keys(schemas).find(
        key => key.toLowerCase().includes('create') || key.toLowerCase().includes('input')
      );

      let createFields: IntrospectedField[] = [];
      if (createSchemaKey) {
        const createSchema = schemas[createSchemaKey] as Record<string, unknown>;
        const createProps = createSchema.properties as Record<string, { type: string; required?: boolean }> | undefined;
        if (createProps) {
          for (const [name, prop] of Object.entries(createProps)) {
            createFields.push({
              name,
              type: this.mapOpenApiTypeToFieldType(prop.type),
              required: prop.required ?? true,
              isId: false,
              isTimestamp: false,
            });
          }
        }
      }

      // If no CreateInput schema, derive from main schema (exclude id, timestamps)
      if (createFields.length === 0) {
        createFields = fields.filter(f => !f.isId && !f.isTimestamp);
      }

      logger.info(
        { resourceName, fieldCount: fields.length, createFieldCount: createFields.length },
        'Successfully parsed OpenAPI schema'
      );

      return {
        resourceName,
        fields,
        createFields,
      };
    } catch (error) {
      logger.debug(
        { error: error instanceof Error ? error.message : 'Unknown' },
        'Failed to fetch /api-docs.json'
      );
      return null;
    }
  }

  /**
   * Map OpenAPI type to IntrospectedField type
   */
  private mapOpenApiTypeToFieldType(openApiType: string): IntrospectedField['type'] {
    switch (openApiType) {
      case 'string': return 'string';
      case 'number': return 'number';
      case 'integer': return 'number';
      case 'boolean': return 'boolean';
      case 'array': return 'array';
      case 'object': return 'object';
      default: return 'unknown';
    }
  }

  /**
   * Extract field information from a sample object
   * Returns the count of new fields added
   */
  private extractFieldsFromObject(
    obj: Record<string, unknown>, 
    fields: IntrospectedField[],
    seenFieldNames: Set<string>
  ): number {
    let newFieldCount = 0;
    
    for (const [key, value] of Object.entries(obj)) {
      // Skip if we've already seen this field
      if (seenFieldNames.has(key)) continue;
      seenFieldNames.add(key);
      
      const field: IntrospectedField = {
        name: key,
        type: this.inferFieldType(value),
        required: true,
        isId: key === 'id' || key === '_id',
        isTimestamp: ['createdAt', 'updatedAt', 'created_at', 'updated_at', 'timestamp'].includes(key),
      };
      fields.push(field);
      newFieldCount++;
    }
    
    return newFieldCount;
  }

  /**
   * Infer the TypeScript type from a value
   */
  private inferFieldType(value: unknown): IntrospectedField['type'] {
    if (value === null || value === undefined) return 'unknown';
    if (typeof value === 'string') return 'string';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object') return 'object';
    return 'unknown';
  }

  /**
   * Generate a complete React frontend
   */
  async generate(input: FrontendGenerationInput): Promise<FrontendGenerationResult> {
    logger.info(
      {
        name: input.name,
        framework: input.config.framework,
        serviceCount: input.consumedServices.length,
      },
      'Generating frontend code'
    );

    const files: GeneratedFile[] = [];

    try {
      // 0. Introspect backend APIs to discover actual schemas
      const introspectedSchemas = new Map<string, IntrospectedSchema>();
      for (const { service, endpoints } of input.consumedServices) {
        const schema = await this.introspectApiSchema(service, endpoints);
        if (schema) {
          introspectedSchemas.set(service.id, schema);
          logger.info(
            { serviceName: service.name, fields: schema.fields.map(f => f.name) },
            'Successfully introspected API schema'
          );
        }
      }

      // 1. Generate package.json
      files.push(this.generatePackageJson(input.name, input.config));

      // 2. Generate Vite config
      files.push(this.generateViteConfig(input.consumedServices));

      // 3. Generate Tailwind config
      files.push(this.generateTailwindConfig());

      // 4. Generate postcss config
      files.push(this.generatePostCssConfig());

      // 5. Generate index.html
      files.push(this.generateIndexHtml(input.name));

      // 6. Generate main.tsx (entry point)
      files.push(this.generateMainTsx(input.config));

      // 7. Generate App.tsx (main app component)
      files.push(this.generateAppTsx(input));

      // 8. Generate API types from consumed services (using introspected schemas)
      files.push(...this.generateApiTypes(input.consumedServices, introspectedSchemas));

      // 9. Generate API client hooks (TanStack Query)
      files.push(...this.generateApiHooks(input.consumedServices, input.config));

      // 10. Generate components using introspected schemas
      const components = await this.generateComponentsWithAI(input, introspectedSchemas);
      files.push(...components);

      // 11. Generate index.css
      files.push(this.generateIndexCss());

      // 12. Generate tsconfig.json
      files.push(this.generateTsConfig());

      // 13. Generate tsconfig.node.json (required by Vite)
      files.push(this.generateTsConfigNode());

      // 14. Generate nginx.conf for production (with API proxying)
      files.push(this.generateNginxConfig(input.consumedServices));

      logger.info({ fileCount: files.length }, 'Frontend code generation complete');

      return {
        success: true,
        files,
        entryPoint: 'src/main.tsx',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage }, 'Frontend code generation failed');

      return {
        success: false,
        files: [],
        entryPoint: 'src/main.tsx',
        error: errorMessage,
      };
    }
  }

  /**
   * Generate package.json
   */
  private generatePackageJson(name: string, config: FrontendConfig): GeneratedFile {
    const dependencies: Record<string, string> = {
      react: '^18.3.1',
      'react-dom': '^18.3.1',
      'react-router-dom': '^6.28.0',
    };

    // Add state management
    if (config.stateManagement === 'tanstack-query') {
      dependencies['@tanstack/react-query'] = '^5.60.0';
    } else if (config.stateManagement === 'zustand') {
      dependencies['zustand'] = '^5.0.0';
    } else if (config.stateManagement === 'redux') {
      dependencies['@reduxjs/toolkit'] = '^2.3.0';
      dependencies['react-redux'] = '^9.1.0';
    }

    const devDependencies: Record<string, string> = {
      '@types/react': '^18.3.12',
      '@types/react-dom': '^18.3.1',
      '@vitejs/plugin-react': '^4.3.3',
      typescript: '^5.6.0',
      vite: '^5.4.0',
    };

    // Add styling
    if (config.styling === 'tailwind') {
      devDependencies['tailwindcss'] = '^3.4.0';
      devDependencies['postcss'] = '^8.4.0';
      devDependencies['autoprefixer'] = '^10.4.0';
    }

    const packageJson = {
      name: name.toLowerCase().replace(/\s+/g, '-'),
      version: '1.0.0',
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'tsc && vite build',
        preview: 'vite preview',
        lint: 'eslint . --ext ts,tsx',
      },
      dependencies,
      devDependencies,
    };

    return {
      path: 'package.json',
      content: JSON.stringify(packageJson, null, 2),
      language: 'json',
      purpose: 'Package configuration',
      isNew: true,
    };
  }

  /**
   * Generate Vite config with proxy to backend services
   */
  private generateViteConfig(
    consumedServices: FrontendGenerationInput['consumedServices']
  ): GeneratedFile {
    const proxyEntries = consumedServices
      .map((cs) => {
        const apiPrefix = `/api/${cs.service.name}`;
        return `    '${apiPrefix}': {
      target: '${cs.service.serviceUrl}',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\\/api\\/${cs.service.name}/, ''),
    }`;
      })
      .join(',\n');

    const content = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    proxy: {
${proxyEntries}
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
`;

    return {
      path: 'vite.config.ts',
      content,
      language: 'typescript',
      purpose: 'Vite build configuration with API proxy',
      isNew: true,
    };
  }

  /**
   * Generate Tailwind config
   */
  private generateTailwindConfig(): GeneratedFile {
    const content = `/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
`;

    return {
      path: 'tailwind.config.js',
      content,
      language: 'javascript',
      purpose: 'Tailwind CSS configuration',
      isNew: true,
    };
  }

  /**
   * Generate PostCSS config
   */
  private generatePostCssConfig(): GeneratedFile {
    const content = `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`;

    return {
      path: 'postcss.config.js',
      content,
      language: 'javascript',
      purpose: 'PostCSS configuration for Tailwind',
      isNew: true,
    };
  }

  /**
   * Generate index.html
   */
  private generateIndexHtml(name: string): GeneratedFile {
    const content = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

    return {
      path: 'index.html',
      content,
      language: 'html',
      purpose: 'HTML entry point',
      isNew: true,
    };
  }

  /**
   * Generate main.tsx entry point
   */
  private generateMainTsx(config: FrontendConfig): GeneratedFile {
    let imports = `import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
`;

    let wrappers: string[] = [];

    if (config.stateManagement === 'tanstack-query') {
      imports += `import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: 1,
    },
  },
});
`;
      wrappers.push('QueryClientProvider client={queryClient}');
    }

    wrappers.push('BrowserRouter');

    const wrapperOpen = wrappers.map((w) => `    <${w}>`).join('\n');
    const wrapperClose = wrappers
      .reverse()
      .map((w) => `    </${w.split(' ')[0]}>`)
      .join('\n');

    const content = `${imports}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
${wrapperOpen}
      <App />
${wrapperClose}
  </React.StrictMode>
);
`;

    return {
      path: 'src/main.tsx',
      content,
      language: 'typescript',
      purpose: 'Application entry point',
      isNew: true,
    };
  }

  /**
   * Generate App.tsx
   */
  private generateAppTsx(input: FrontendGenerationInput): GeneratedFile {
    const content = `import { Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';

function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-gray-900">${input.name}</h1>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-8">
        <Routes>
          <Route path="/" element={<HomePage />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
`;

    return {
      path: 'src/App.tsx',
      content,
      language: 'typescript',
      purpose: 'Main application component',
      isNew: true,
    };
  }

  /**
   * Generate TypeScript types from consumed service endpoints
   */
  private generateApiTypes(
    consumedServices: FrontendGenerationInput['consumedServices'],
    introspectedSchemas: Map<string, IntrospectedSchema>
  ): GeneratedFile[] {
    const files: GeneratedFile[] = [];

    for (const { service, endpoints } of consumedServices) {
      const schema = introspectedSchemas.get(service.id);
      const typeContent = this.generateTypesForService(service, endpoints, schema);
      files.push({
        path: `src/api/types/${service.name}.ts`,
        content: typeContent,
        language: 'typescript',
        purpose: `API types for ${service.displayName}`,
        isNew: true,
      });
    }

    // Generate index.ts for types
    const indexContent = consumedServices
      .map(({ service }) => `export * from './${service.name}';`)
      .join('\n');

    files.push({
      path: 'src/api/types/index.ts',
      content: indexContent + '\n',
      language: 'typescript',
      purpose: 'API types index',
      isNew: true,
    });

    return files;
  }

  /**
   * Generate TypeScript types for a single service
   */
  private generateTypesForService(
    service: RegisteredService,
    endpoints: ServiceEndpoint[],
    introspectedSchema?: IntrospectedSchema
  ): string {
    const typeLines: string[] = [
      `/**`,
      ` * API Types for ${service.displayName}`,
      ` * Auto-generated from service endpoints`,
      ` */`,
      '',
    ];

    // Generate types from response schemas
    // Filter out non-resource endpoints
    const seenTypes = new Set<string>();
    const resourceEndpoints = endpoints.filter(e => 
      !e.path.includes('api-docs') && 
      !e.path.includes('health') && 
      !e.path.includes('openapi') &&
      e.path !== '/'
    );

    for (const endpoint of resourceEndpoints) {
      const resourceName = this.getResourceNameFromPath(endpoint.path);
      const typeName = this.toPascalCase(resourceName);

      if (!seenTypes.has(typeName)) {
        seenTypes.add(typeName);

        // Generate interface from introspected schema if available
        typeLines.push(`export interface ${typeName} {`);
        
        if (introspectedSchema && introspectedSchema.fields.length > 0) {
          // Use real fields from introspection
          for (const field of introspectedSchema.fields) {
            const tsType = this.mapFieldTypeToTypeScript(field.type);
            typeLines.push(`  ${field.name}: ${tsType};`);
          }
          logger.info(
            { typeName, fieldCount: introspectedSchema.fields.length },
            'Generated type from introspected schema'
          );
        } else {
          // NO FALLBACK: Schema introspection is required for accurate type generation
          // Throw error so the orchestrator can retry or fix the backend
          const errorMsg = `Schema introspection failed for resource "${resourceName}". ` +
            `The backend at "${service.serviceUrl}" must expose either: ` +
            `1) A /api-docs.json endpoint with OpenAPI schema, or ` +
            `2) Return sample data from GET ${endpoint.path} for inference. ` +
            `Cannot generate accurate types without schema information.`;
          logger.error({ typeName, resourceName, serviceUrl: service.serviceUrl, endpoint: endpoint.path }, errorMsg);
          throw new Error(errorMsg);
        }

        typeLines.push(`}`);
        typeLines.push('');

        // Generate Create input type - exclude id and timestamps
        if (introspectedSchema && introspectedSchema.createFields.length > 0) {
          typeLines.push(`export interface Create${typeName}Input {`);
          for (const field of introspectedSchema.createFields) {
            const tsType = this.mapFieldTypeToTypeScript(field.type);
            typeLines.push(`  ${field.name}?: ${tsType};`);
          }
          typeLines.push(`}`);
        } else {
          // NO FALLBACK: If we got here, introspection succeeded but has no createFields
          // This means the type has no editable fields (all auto-generated like id, timestamps)
          // Generate empty create input - this is valid (e.g., creating with defaults)
          const errorMsg = `No create fields found for resource "${resourceName}". ` +
            `The introspected schema has no editable fields. ` +
            `Check that the backend returns fields other than id/timestamps.`;
          logger.error({ typeName, resourceName }, errorMsg);
          throw new Error(errorMsg);
        }
        typeLines.push('');

        // Generate Update input type
        typeLines.push(`export type Update${typeName}Input = Partial<Create${typeName}Input>;`);
        typeLines.push('');
      }
    }

    // Generate list response type
    typeLines.push(`export interface ApiListResponse<T> {`);
    typeLines.push(`  data: T[];`);
    typeLines.push(`  total?: number;`);
    typeLines.push(`}`);
    typeLines.push('');

    typeLines.push(`export interface ApiSingleResponse<T> {`);
    typeLines.push(`  data: T;`);
    typeLines.push(`}`);
    typeLines.push('');

    return typeLines.join('\n');
  }

  /**
   * Map introspected field type to TypeScript type
   */
  private mapFieldTypeToTypeScript(fieldType: IntrospectedField['type']): string {
    switch (fieldType) {
      case 'string': return 'string';
      case 'number': return 'number';
      case 'boolean': return 'boolean';
      case 'array': return 'unknown[]';
      case 'object': return 'Record<string, unknown>';
      default: return 'unknown';
    }
  }

  /**
   * Generate TanStack Query hooks for API calls
   */
  private generateApiHooks(
    consumedServices: FrontendGenerationInput['consumedServices'],
    config: FrontendConfig
  ): GeneratedFile[] {
    if (config.stateManagement !== 'tanstack-query') {
      return [];
    }

    const files: GeneratedFile[] = [];

    for (const { service, endpoints } of consumedServices) {
      const hooksContent = this.generateHooksForService(service, endpoints);
      files.push({
        path: `src/api/hooks/${service.name}.ts`,
        content: hooksContent,
        language: 'typescript',
        purpose: `TanStack Query hooks for ${service.displayName}`,
        isNew: true,
      });
    }

    // Generate index.ts for hooks
    const indexContent = consumedServices
      .map(({ service }) => `export * from './${service.name}';`)
      .join('\n');

    files.push({
      path: 'src/api/hooks/index.ts',
      content: indexContent + '\n',
      language: 'typescript',
      purpose: 'API hooks index',
      isNew: true,
    });

    return files;
  }

  /**
   * Generate TanStack Query hooks for a single service
   */
  private generateHooksForService(
    service: RegisteredService,
    endpoints: ServiceEndpoint[]
  ): string {
    const lines: string[] = [
      `/**`,
      ` * TanStack Query Hooks for ${service.displayName}`,
      ` * Auto-generated from service endpoints`,
      ` */`,
      '',
      `import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';`,
      `import type * as Types from '../types/${service.name}';`,
      '',
      `const API_BASE = '/api/${service.name}';`,
      '',
      `// Generic fetch helper`,
      `async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {`,
      `  const response = await fetch(url, {`,
      `    headers: { 'Content-Type': 'application/json' },`,
      `    ...options,`,
      `  });`,
      `  if (!response.ok) {`,
      `    const errorText = await response.text();`,
      `    throw new Error(errorText || \`API error: \${response.status}\`);`,
      `  }`,
      `  // Handle 204 No Content (common for DELETE)`,
      `  if (response.status === 204 || response.headers.get('content-length') === '0') {`,
      `    return undefined as T;`,
      `  }`,
      `  return response.json();`,
      `}`,
      '',
    ];

    // Group endpoints by resource, filtering out non-resource endpoints
    const resourceEndpoints = new Map<string, ServiceEndpoint[]>();
    for (const endpoint of endpoints) {
      // Skip non-resource endpoints
      if (endpoint.path.includes('api-docs') || 
          endpoint.path.includes('health') || 
          endpoint.path.includes('openapi') ||
          endpoint.path === '/') {
        continue;
      }
      const resource = this.getResourceNameFromPath(endpoint.path);
      if (!resourceEndpoints.has(resource)) {
        resourceEndpoints.set(resource, []);
      }
      resourceEndpoints.get(resource)!.push(endpoint);
    }

    for (const [resource, eps] of resourceEndpoints) {
      const typeName = this.toPascalCase(resource);
      const resourceLower = resource.toLowerCase();

      // Find endpoints by method
      const listEndpoint = eps.find((e) => e.method === 'GET' && !e.path.includes(':'));
      const getEndpoint = eps.find((e) => e.method === 'GET' && e.path.includes(':'));
      const createEndpoint = eps.find((e) => e.method === 'POST');
      const updateEndpoint = eps.find((e) => e.method === 'PUT' || e.method === 'PATCH');
      const deleteEndpoint = eps.find((e) => e.method === 'DELETE');

      // Generate list hook
      if (listEndpoint) {
        lines.push(`// List ${resourceLower}`);
        lines.push(`export function use${typeName}List() {`);
        lines.push(`  return useQuery({`);
        lines.push(`    queryKey: ['${resourceLower}', 'list'],`);
        lines.push(`    queryFn: () => fetchApi<Types.ApiListResponse<Types.${typeName}>>(\`\${API_BASE}${listEndpoint.path}\`),`);
        lines.push(`  });`);
        lines.push(`}`);
        lines.push('');
      }

      // Generate get by ID hook
      if (getEndpoint) {
        lines.push(`// Get single ${resourceLower}`);
        lines.push(`export function use${typeName}(id: string) {`);
        lines.push(`  return useQuery({`);
        lines.push(`    queryKey: ['${resourceLower}', id],`);
        lines.push(`    queryFn: () => fetchApi<Types.ApiSingleResponse<Types.${typeName}>>(\`\${API_BASE}/${resourceLower}/\${id}\`),`);
        lines.push(`    enabled: !!id,`);
        lines.push(`  });`);
        lines.push(`}`);
        lines.push('');
      }

      // Generate create mutation
      if (createEndpoint) {
        lines.push(`// Create ${resourceLower}`);
        lines.push(`export function useCreate${typeName}() {`);
        lines.push(`  const queryClient = useQueryClient();`);
        lines.push(`  return useMutation({`);
        lines.push(`    mutationFn: (input: Types.Create${typeName}Input) =>`);
        lines.push(`      fetchApi<Types.ApiSingleResponse<Types.${typeName}>>(\`\${API_BASE}${createEndpoint.path}\`, {`);
        lines.push(`        method: 'POST',`);
        lines.push(`        body: JSON.stringify(input),`);
        lines.push(`      }),`);
        lines.push(`    onSuccess: () => {`);
        lines.push(`      queryClient.invalidateQueries({ queryKey: ['${resourceLower}'] });`);
        lines.push(`    },`);
        lines.push(`  });`);
        lines.push(`}`);
        lines.push('');
      }

      // Generate update mutation
      if (updateEndpoint) {
        lines.push(`// Update ${resourceLower}`);
        lines.push(`export function useUpdate${typeName}() {`);
        lines.push(`  const queryClient = useQueryClient();`);
        lines.push(`  return useMutation({`);
        lines.push(`    mutationFn: ({ id, ...input }: { id: string } & Types.Update${typeName}Input) =>`);
        lines.push(`      fetchApi<Types.ApiSingleResponse<Types.${typeName}>>(\`\${API_BASE}/${resourceLower}/\${id}\`, {`);
        lines.push(`        method: '${updateEndpoint.method}',`);
        lines.push(`        body: JSON.stringify(input),`);
        lines.push(`      }),`);
        lines.push(`    onSuccess: (_, { id }) => {`);
        lines.push(`      queryClient.invalidateQueries({ queryKey: ['${resourceLower}'] });`);
        lines.push(`      queryClient.invalidateQueries({ queryKey: ['${resourceLower}', id] });`);
        lines.push(`    },`);
        lines.push(`  });`);
        lines.push(`}`);
        lines.push('');
      }

      // Generate delete mutation
      if (deleteEndpoint) {
        lines.push(`// Delete ${resourceLower}`);
        lines.push(`export function useDelete${typeName}() {`);
        lines.push(`  const queryClient = useQueryClient();`);
        lines.push(`  return useMutation({`);
        lines.push(`    mutationFn: (id: string) =>`);
        lines.push(`      fetchApi<void>(\`\${API_BASE}/${resourceLower}/\${id}\`, { method: 'DELETE' }),`);
        lines.push(`    onSuccess: () => {`);
        lines.push(`      queryClient.invalidateQueries({ queryKey: ['${resourceLower}'] });`);
        lines.push(`    },`);
        lines.push(`  });`);
        lines.push(`}`);
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate React components using Gemini AI
   */
  private async generateComponentsWithAI(
    input: FrontendGenerationInput,
    introspectedSchemas: Map<string, IntrospectedSchema>
  ): Promise<GeneratedFile[]> {
    const files: GeneratedFile[] = [];

    // Use the fallback component directly - provides a clean, working component
    // without relying on AI generation for simple cases
    logger.info('Generating HomePage component using template');
    
    // Get the schema for the first consumed service
    const firstService = input.consumedServices[0];
    const schema = firstService ? introspectedSchemas.get(firstService.service.id) : undefined;
    
    files.push(this.generateFallbackHomePage(input, schema));

    return files;
  }

  /**
   * Generate a fallback HomePage component
   * Checks what endpoints actually exist and only uses hooks for those
   */
  private generateFallbackHomePage(
    input: FrontendGenerationInput,
    introspectedSchema?: IntrospectedSchema
  ): GeneratedFile {
    const service = input.consumedServices[0];
    const endpoints = service?.endpoints ?? [];
    
    // Filter out non-resource endpoints to find the actual resource path
    const resourceEndpoints = endpoints.filter(e => 
      !e.path.includes('api-docs') && 
      !e.path.includes('health') &&
      !e.path.includes('openapi') &&
      e.path !== '/'
    );
    
    const resource = service && resourceEndpoints.length > 0
      ? this.getResourceNameFromPath(resourceEndpoints[0]?.path ?? '/items')
      : 'items';
    const typeName = this.toPascalCase(resource);
    const displayName = this.pluralize(typeName);

    // Check what endpoints actually exist (use filtered endpoints)
    const hasListEndpoint = resourceEndpoints.some(
      (e) => e.method === 'GET' && !e.path.includes(':')
    );
    const hasCreateEndpoint = resourceEndpoints.some((e) => e.method === 'POST');
    const hasDeleteEndpoint = resourceEndpoints.some((e) => e.method === 'DELETE');

    // Get form fields from introspected schema or use fallback
    const formFields = introspectedSchema?.createFields ?? [];
    
    if (formFields.length > 0) {
      logger.info(
        { typeName, formFields: formFields.map(f => f.name) },
        'Using introspected schema for form generation'
      );
    } else {
      logger.warn(
        { typeName },
        'No introspected schema - using default form fields'
      );
    }

    // Build imports based on available endpoints
    const hookImports: string[] = [];
    if (hasListEndpoint) hookImports.push(`use${typeName}List`);
    if (hasCreateEndpoint) hookImports.push(`useCreate${typeName}`);
    if (hasDeleteEndpoint) hookImports.push(`useDelete${typeName}`);

    // If no list endpoint, we need a different approach - generate a simpler component
    if (!hasListEndpoint) {
      logger.warn(
        { resource, typeName, endpoints: endpoints.length },
        'No list endpoint found, generating simplified HomePage'
      );
      return this.generateSimplifiedHomePage(input, typeName, hasCreateEndpoint, introspectedSchema);
    }

    const importLine =
      hookImports.length > 0
        ? `import { ${hookImports.join(', ')} } from '../api/hooks';`
        : '';

    // Generate form fields code
    const formFieldsJsx = this.generateFormFieldsJsx(formFields, typeName);
    const formDataExtraction = this.generateFormDataExtraction(formFields);
    const itemDisplayJsx = this.generateItemDisplayJsx(introspectedSchema);

    const content = `${importLine}
import type { ${typeName}${hasCreateEndpoint ? `, Create${typeName}Input` : ''} } from '../api/types';
import { useState } from 'react';

function HomePage() {
  const { data, isLoading, error } = use${typeName}List();
${hasCreateEndpoint ? `  const createMutation = useCreate${typeName}();` : ''}
${hasDeleteEndpoint ? `  const deleteMutation = useDelete${typeName}();` : ''}
  const [showForm, setShowForm] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-800">Error loading data: {error.message}</p>
      </div>
    );
  }

  const items = Array.isArray(data) ? data : (data?.data ?? []);
${hasCreateEndpoint ? `
  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const input: Create${typeName}Input = {
${formDataExtraction}
    };
    await createMutation.mutateAsync(input);
    setShowForm(false);
    (e.target as HTMLFormElement).reset();
  };
` : ''}
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-gray-900">${displayName}</h2>
${hasCreateEndpoint ? `        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
        >
          {showForm ? 'Cancel' : 'Add New'}
        </button>` : ''}
      </div>
${hasCreateEndpoint ? `
      {showForm && (
        <form onSubmit={handleCreate} className="bg-white p-6 rounded-lg shadow space-y-4">
${formFieldsJsx}
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition disabled:opacity-50"
          >
            {createMutation.isPending ? 'Creating...' : 'Create'}
          </button>
        </form>
      )}
` : ''}
      <div className="grid gap-4">
        {items.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No items yet.${hasCreateEndpoint ? ' Add one to get started!' : ''}</p>
        ) : (
          items.map((item: ${typeName}) => (
            <div key={item.id} className="bg-white p-4 rounded-lg shadow flex justify-between items-start">
              <div>
${itemDisplayJsx}
              </div>
${hasDeleteEndpoint ? `              <button
                onClick={() => deleteMutation.mutate(item.id)}
                disabled={deleteMutation.isPending}
                className="text-red-600 hover:text-red-800 transition"
              >
                Delete
              </button>` : ''}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default HomePage;
`;

    return {
      path: 'src/pages/HomePage.tsx',
      content,
      language: 'typescript',
      purpose: 'Main home page component',
      isNew: true,
    };
  }

  /**
   * Generate JSX for form fields based on introspected schema
   */
  private generateFormFieldsJsx(fields: IntrospectedField[], typeName: string): string {
    if (fields.length === 0) {
      // NO FALLBACK: Form generation requires schema fields
      // Throw error so the orchestrator can fix the issue
      const errorMsg = `No fields available for form generation of "${typeName}". ` +
        `Schema introspection did not return any editable fields. ` +
        `Ensure the backend exposes /api-docs.json or returns sample data with fields.`;
      logger.error({ typeName }, errorMsg);
      throw new Error(errorMsg);
    }

    return fields.map(field => {
      const label = this.formatFieldLabel(field.name);
      
      if (field.type === 'boolean') {
        return `          <div className="flex items-center">
            <input
              type="checkbox"
              name="${field.name}"
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label className="ml-2 block text-sm text-gray-900">${label}</label>
          </div>`;
      }
      
      if (field.type === 'number') {
        return `          <div>
            <label className="block text-sm font-medium text-gray-700">${label}</label>
            <input
              type="number"
              name="${field.name}"
              ${field.required ? 'required' : ''}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border"
            />
          </div>`;
      }
      
      // Determine input type based on field name patterns (generic patterns)
      const fieldNameLower = field.name.toLowerCase();
      
      // Use textarea for long-form content fields
      const isTextArea = fieldNameLower.includes('description') || 
                         fieldNameLower.includes('content') || 
                         fieldNameLower.includes('body') || 
                         fieldNameLower.includes('text') || 
                         fieldNameLower.includes('notes') ||
                         fieldNameLower.includes('bio') ||
                         fieldNameLower.includes('summary') ||
                         fieldNameLower.includes('details') ||
                         fieldNameLower.includes('comment') ||
                         fieldNameLower.includes('message');
      
      // Use email input for email fields
      const isEmail = fieldNameLower.includes('email');
      
      // Use URL input for URL/link fields
      const isUrl = fieldNameLower.includes('url') || 
                    fieldNameLower.includes('link') || 
                    fieldNameLower.includes('website') ||
                    fieldNameLower.includes('href');
      
      // Use date input for date fields
      const isDate = fieldNameLower.includes('date') && !fieldNameLower.includes('update');
      
      // Use password input for password fields
      const isPassword = fieldNameLower.includes('password');
      
      // Use tel input for phone fields
      const isPhone = fieldNameLower.includes('phone') || fieldNameLower.includes('tel');
      
      if (isTextArea) {
        return `          <div>
            <label className="block text-sm font-medium text-gray-700">${label}</label>
            <textarea
              name="${field.name}"
              ${field.required ? 'required' : ''}
              rows={3}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border"
            />
          </div>`;
      }
      
      if (isEmail) {
        return `          <div>
            <label className="block text-sm font-medium text-gray-700">${label}</label>
            <input
              type="email"
              name="${field.name}"
              ${field.required ? 'required' : ''}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border"
            />
          </div>`;
      }
      
      if (isUrl) {
        return `          <div>
            <label className="block text-sm font-medium text-gray-700">${label}</label>
            <input
              type="url"
              name="${field.name}"
              ${field.required ? 'required' : ''}
              placeholder="https://..."
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border"
            />
          </div>`;
      }
      
      if (isDate) {
        return `          <div>
            <label className="block text-sm font-medium text-gray-700">${label}</label>
            <input
              type="date"
              name="${field.name}"
              ${field.required ? 'required' : ''}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border"
            />
          </div>`;
      }
      
      if (isPassword) {
        return `          <div>
            <label className="block text-sm font-medium text-gray-700">${label}</label>
            <input
              type="password"
              name="${field.name}"
              ${field.required ? 'required' : ''}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border"
            />
          </div>`;
      }
      
      if (isPhone) {
        return `          <div>
            <label className="block text-sm font-medium text-gray-700">${label}</label>
            <input
              type="tel"
              name="${field.name}"
              ${field.required ? 'required' : ''}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border"
            />
          </div>`;
      }
      
      // Default: text input
      return `          <div>
            <label className="block text-sm font-medium text-gray-700">${label}</label>
            <input
              name="${field.name}"
              ${field.required ? 'required' : ''}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border"
            />
          </div>`;
    }).join('\n');
  }

  /**
   * Generate form data extraction code
   */
  private generateFormDataExtraction(fields: IntrospectedField[]): string {
    if (fields.length === 0) {
      // No schema - use generic JSON fallback (must be parsed on submit)
      logger.warn({}, 'No fields for form data extraction - using JSON fallback');
      return `      // Schema not available - parse JSON input
      ...JSON.parse(formData.get('jsonData') as string || '{}'),`;
    }

    return fields.map(field => {
      if (field.type === 'boolean') {
        return `      ${field.name}: formData.get('${field.name}') === 'on',`;
      }
      if (field.type === 'number') {
        return `      ${field.name}: Number(formData.get('${field.name}')),`;
      }
      return `      ${field.name}: formData.get('${field.name}') as string,`;
    }).join('\n');
  }

  /**
   * Generate JSX for displaying an item based on introspected schema
   * Dynamically displays fields from the actual schema - NO HARDCODED FIELD NAMES
   */
  private generateItemDisplayJsx(schema?: IntrospectedSchema): string {
    if (!schema || schema.fields.length === 0) {
      // No schema available - display as JSON (no assumptions about field names)
      logger.warn({}, 'No schema for item display - showing raw JSON');
      return `                <pre className="text-sm text-gray-700 overflow-auto">{JSON.stringify(item, null, 2)}</pre>`;
    }

    const displayFields = schema.fields.filter(f => !f.isId && !f.isTimestamp);
    
    if (displayFields.length === 0) {
      return `                <h3 className="font-medium text-gray-900">ID: {item.id}</h3>`;
    }

    // Select the first string field as the "title" (primary display field)
    // Common patterns: title, name, label, subject, heading, productName, etc.
    const commonTitlePatterns = ['title', 'name', 'label', 'subject', 'heading', 'summary', 'sku', 'code'];
    const titleField = displayFields.find(f => 
      f.type === 'string' && commonTitlePatterns.some(p => f.name.toLowerCase().includes(p))
    ) ?? displayFields.find(f => f.type === 'string') ?? displayFields[0];
    
    // Get secondary fields (not the primary display field), limited to first 4
    const secondaryFields = displayFields.filter(f => f.name !== titleField!.name).slice(0, 4);

    let jsx = `                <h3 className="font-medium text-gray-900">{item.${titleField!.name}}</h3>`;
    
    for (const field of secondaryFields) {
      if (field.type === 'boolean') {
        jsx += `
                {item.${field.name} !== undefined && (
                  <span className={\`inline-block mt-1 px-2 py-1 text-xs rounded \${item.${field.name} ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}\`}>
                    {item.${field.name} ? '${this.formatFieldLabel(field.name)}' : 'Not ${this.formatFieldLabel(field.name)}'}
                  </span>
                )}`;
      } else {
        jsx += `
                {item.${field.name} && (
                  <p className="text-gray-500 text-sm mt-1">{item.${field.name}}</p>
                )}`;
      }
    }
    
    return jsx;
  }

  /**
   * Format field name as human-readable label
   */
  private formatFieldLabel(fieldName: string): string {
    return fieldName
      .replace(/([A-Z])/g, ' $1')
      .replace(/[_-]/g, ' ')
      .replace(/^\s+/, '')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Properly pluralize a name, avoiding double pluralization
   */
  private pluralize(name: string): string {
    // If already ends with 's', don't add another
    if (name.endsWith('s') && !name.endsWith('ss')) {
      return name;
    }
    // If ends with 'y' preceded by consonant, replace with 'ies'
    if (name.endsWith('y') && !/[aeiou]y$/i.test(name)) {
      return name.slice(0, -1) + 'ies';
    }
    // If ends with 's', 'x', 'z', 'ch', 'sh', add 'es'
    if (/[sxz]$|ch$|sh$/i.test(name)) {
      return name + 'es';
    }
    // Default: add 's'
    return name + 's';
  }

  /**
   * Generate a simplified HomePage when no list endpoint exists
   * Uses create endpoint to add items and shows a success message
   */
  private generateSimplifiedHomePage(
    _input: FrontendGenerationInput,
    typeName: string,
    hasCreateEndpoint: boolean,
    introspectedSchema?: IntrospectedSchema
  ): GeneratedFile {
    const createImport = hasCreateEndpoint ? `import { useCreate${typeName} } from '../api/hooks';` : '';
    const createType = hasCreateEndpoint ? `, Create${typeName}Input` : '';
    const displayName = this.pluralize(typeName);

    // Get form fields from introspected schema or use fallback
    const formFields = introspectedSchema?.createFields ?? [];
    const formFieldsJsx = this.generateFormFieldsJsx(formFields, typeName);
    const formDataExtraction = this.generateFormDataExtraction(formFields);
    const itemDisplayJsx = this.generateItemDisplayJsx(introspectedSchema);

    const content = `${createImport}
import type { ${typeName}${createType} } from '../api/types';
import { useState } from 'react';

function HomePage() {
${hasCreateEndpoint ? `  const createMutation = useCreate${typeName}();` : ''}
  const [showForm, setShowForm] = useState(false);
  const [createdItems, setCreatedItems] = useState<${typeName}[]>([]);
${hasCreateEndpoint ? `
  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const input: Create${typeName}Input = {
${formDataExtraction}
    };
    const result = await createMutation.mutateAsync(input);
    if (result.data) {
      setCreatedItems((prev) => [...prev, result.data!]);
    }
    setShowForm(false);
    (e.target as HTMLFormElement).reset();
  };
` : ''}
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-gray-900">${displayName}</h2>
${hasCreateEndpoint ? `        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
        >
          {showForm ? 'Cancel' : 'Add New'}
        </button>` : ''}
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <p className="text-yellow-800 text-sm">
          Note: This API does not provide a list endpoint. Items created here are tracked locally.
        </p>
      </div>
${hasCreateEndpoint ? `
      {showForm && (
        <form onSubmit={handleCreate} className="bg-white p-6 rounded-lg shadow space-y-4">
${formFieldsJsx}
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition disabled:opacity-50"
          >
            {createMutation.isPending ? 'Creating...' : 'Create'}
          </button>
        </form>
      )}
` : ''}
      <div className="grid gap-4">
        {createdItems.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No items created yet.${hasCreateEndpoint ? ' Add one to get started!' : ''}</p>
        ) : (
          createdItems.map((item: ${typeName}) => (
            <div key={item.id} className="bg-white p-4 rounded-lg shadow">
              <div>
${itemDisplayJsx}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default HomePage;
`;

    return {
      path: 'src/pages/HomePage.tsx',
      content,
      language: 'typescript',
      purpose: 'Main home page component (simplified - no list endpoint)',
      isNew: true,
    };
  }

  /**
   * Generate index.css with Tailwind directives
   */
  private generateIndexCss(): GeneratedFile {
    const content = `@tailwind base;
@tailwind components;
@tailwind utilities;

/* Custom base styles */
body {
  @apply antialiased;
}

/* Custom utility classes */
.btn-primary {
  @apply bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition;
}

.btn-secondary {
  @apply bg-gray-200 text-gray-800 px-4 py-2 rounded-lg hover:bg-gray-300 transition;
}

.input {
  @apply block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border;
}
`;

    return {
      path: 'src/index.css',
      content,
      language: 'css',
      purpose: 'Global styles with Tailwind directives',
      isNew: true,
    };
  }

  /**
   * Generate tsconfig.json
   */
  private generateTsConfig(): GeneratedFile {
    const tsconfig = {
      compilerOptions: {
        target: 'ES2020',
        useDefineForClassFields: true,
        lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        module: 'ESNext',
        skipLibCheck: true,
        moduleResolution: 'bundler',
        allowImportingTsExtensions: true,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        jsx: 'react-jsx',
        strict: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noFallthroughCasesInSwitch: true,
      },
      include: ['src'],
      references: [{ path: './tsconfig.node.json' }],
    };

    return {
      path: 'tsconfig.json',
      content: JSON.stringify(tsconfig, null, 2),
      language: 'json',
      purpose: 'TypeScript configuration',
      isNew: true,
    };
  }

  /**
   * Generate tsconfig.node.json (required by Vite for vite.config.ts)
   */
  private generateTsConfigNode(): GeneratedFile {
    const tsconfigNode = {
      compilerOptions: {
        composite: true,
        skipLibCheck: true,
        module: 'ESNext',
        moduleResolution: 'bundler',
        allowSyntheticDefaultImports: true,
        strict: true,
      },
      include: ['vite.config.ts'],
    };

    return {
      path: 'tsconfig.node.json',
      content: JSON.stringify(tsconfigNode, null, 2),
      language: 'json',
      purpose: 'TypeScript configuration for Vite config',
      isNew: true,
    };
  }

  /**
   * Generate nginx.conf for production deployment with API proxying
   * Uses the actual backend service URL for proxying
   */
  private generateNginxConfig(
    consumedServices: FrontendGenerationInput['consumedServices']
  ): GeneratedFile {
    // Generate proxy locations for each consumed backend service
    const proxyLocations = consumedServices
      .map(({ service }) => {
        // Use the actual service URL from the service registry
        // For Docker containers to reach host services, replace localhost with host.docker.internal
        let backendUrl = service.serviceUrl;
        const apiPath = `/api/${service.name}`;

        // Validate that we have a real URL, not just a placeholder
        if (!backendUrl || !backendUrl.startsWith('http')) {
          throw new Error(
            `Invalid backend URL for service "${service.name}": ${backendUrl}. ` +
            `Service must have a valid serviceUrl in the registry.`
          );
        }

        // For Docker containers running locally, localhost won't work
        // Replace localhost with host.docker.internal so nginx in container can reach host services
        const dockerBackendUrl = backendUrl.replace('localhost', 'host.docker.internal');

        return `
    # Proxy API requests to ${service.displayName || service.name}
    # Original backend URL: ${backendUrl}
    # Docker-accessible URL: ${dockerBackendUrl}
    location ${apiPath}/ {
        proxy_pass ${dockerBackendUrl}/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 60s;
        proxy_read_timeout 60s;
    }`;
      })
      .join('\n');

    const nginxConfig = `server {
    listen 8080;
    root /usr/share/nginx/html;
    index index.html;
${proxyLocations}

    # Health check endpoint
    location /health {
        return 200 "ok";
        add_header Content-Type text/plain;
    }

    # Serve static files and SPA routing
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
}
`;

    return {
      path: 'nginx.conf',
      content: nginxConfig,
      language: 'shell',
      purpose: 'Production nginx configuration with API proxying',
      isNew: true,
    };
  }

  /**
   * Helper: Extract resource name from path
   */
  private getResourceNameFromPath(path: string): string {
    // /todos/:id -> todos
    // /api/users -> users
    const parts = path.split('/').filter((p) => p && !p.startsWith(':') && !p.startsWith('api'));
    return parts[0] ?? 'items';
  }

  /**
   * Helper: Convert string to PascalCase
   */
  private toPascalCase(str: string): string {
    return str
      .split(/[-_\s]+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }
}

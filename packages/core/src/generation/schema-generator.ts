/**
 * SchemaGenerator - Generate Zod schemas BEFORE code generation
 * 
 * This is the key to 99%+ accuracy: by generating the complete type system
 * FIRST, all downstream code generation is constrained to use these exact types.
 * 
 * Flow:
 * 1. Requirement → SchemaGenerator → Complete Zod schemas
 * 2. Schemas + Architecture → CodeGenerator → Type-safe code
 */

import { createChildLogger } from '@chronosops/shared';
import type { AnalyzedRequirement } from '@chronosops/shared';

const logger = createChildLogger({ component: 'SchemaGenerator' });

/**
 * Function type for generating schema via LLM
 * This allows the SchemaGenerator to work with any LLM client
 */
export type SchemaGenerationFn = (
  systemInstruction: string,
  prompt: string
) => Promise<{ success: boolean; data?: unknown; error?: string }>;

// =============================================================================
// TYPES
// =============================================================================

export interface GeneratedSchema {
  /** The main entity schema (e.g., UserSchema) */
  entitySchema: string;
  
  /** Schema for create operations (required fields only) */
  createSchema: string;
  
  /** Schema for update operations (all fields optional) */
  updateSchema: string;
  
  /** TypeScript type derivations */
  typeDerivations: string;
  
  /** Complete schema file content */
  completeSchemaFile: string;
  
  /** Metadata about fields */
  fields: FieldMetadata[];
  
  /** Resource name (singular, e.g., "user") */
  resourceName: string;
  
  /** Resource name (plural, e.g., "users") */
  resourceNamePlural: string;
}

export interface FieldMetadata {
  name: string;
  type: string;
  zodType: string;
  required: boolean;
  inCreate: boolean;
  inUpdate: boolean;
  description?: string;
  validation?: string[];
}

export interface SchemaGenerationResult {
  success: boolean;
  schema?: GeneratedSchema;
  error?: string;
  processingTimeMs: number;
}

// =============================================================================
// SCHEMA GENERATION PROMPT
// =============================================================================

const SCHEMA_GENERATION_PROMPT = `You are generating Zod schemas for a TypeScript REST API.

CRITICAL RULES:
1. Create schemas MUST have all required fields as z.string() (NO .optional())
2. Update schemas MUST have all fields as .optional() (for partial updates)
3. Types MUST be derived using z.infer<typeof Schema>
4. Field names must be camelCase
5. Use proper Zod validators: z.string().email(), z.string().uuid(), z.string().datetime()

OUTPUT FORMAT (JSON):
{
  "resourceName": "user",
  "resourceNamePlural": "users", 
  "fields": [
    {
      "name": "id",
      "type": "string",
      "zodType": "z.string().uuid()",
      "required": true,
      "inCreate": false,
      "inUpdate": false,
      "description": "Unique identifier"
    },
    {
      "name": "email",
      "type": "string", 
      "zodType": "z.string().email()",
      "required": true,
      "inCreate": true,
      "inUpdate": true,
      "description": "User email address"
    }
  ],
  "entitySchema": "const UserSchema = z.object({\\n  id: z.string().uuid(),\\n  email: z.string().email(),\\n  createdAt: z.string().datetime(),\\n  updatedAt: z.string().datetime(),\\n});",
  "createSchema": "const CreateUserSchema = z.object({\\n  email: z.string().email(),\\n});",
  "updateSchema": "const UpdateUserSchema = z.object({\\n  email: z.string().email().optional(),\\n});"
}`;

// =============================================================================
// SCHEMA GENERATOR CLASS
// =============================================================================

export class SchemaGenerator {
  private generateFn?: SchemaGenerationFn;

  /**
   * Create a SchemaGenerator with an optional LLM generation function
   * If no function is provided, only generateFromFields() will work
   */
  constructor(generateFn?: SchemaGenerationFn) {
    this.generateFn = generateFn;
  }

  /**
   * Generate complete Zod schema system from requirement using LLM
   * Requires a generation function to be provided in constructor
   */
  async generate(requirement: AnalyzedRequirement): Promise<SchemaGenerationResult> {
    const startTime = Date.now();

    if (!this.generateFn) {
      return {
        success: false,
        error: 'No generation function provided. Use generateFromFields() for non-LLM generation.',
        processingTimeMs: Date.now() - startTime,
      };
    }

    logger.info({
      title: requirement.title,
      complexity: requirement.estimatedComplexity
    }, 'Generating schema from requirement');

    try {
      // Build the prompt
      const prompt = this.buildPrompt(requirement);

      // Call the generation function
      const response = await this.generateFn(SCHEMA_GENERATION_PROMPT, prompt);

      if (!response.success || !response.data) {
        throw new Error(response.error ?? 'Schema generation failed');
      }

      // Parse and validate the response
      const schemaData = this.parseResponse(response.data);

      // Build the complete schema file
      const completeSchemaFile = this.buildCompleteSchemaFile(schemaData);

      const schema: GeneratedSchema = {
        ...schemaData,
        completeSchemaFile,
      };

      logger.info({
        resourceName: schema.resourceName,
        fieldCount: schema.fields.length,
        processingTimeMs: Date.now() - startTime,
      }, 'Schema generated successfully');

      return {
        success: true,
        schema,
        processingTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage }, 'Schema generation failed');

      return {
        success: false,
        error: errorMessage,
        processingTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Generate schema from explicit field definitions (no LLM needed)
   */
  generateFromFields(
    resourceName: string,
    fields: FieldMetadata[]
  ): GeneratedSchema {
    const resourceNamePlural = this.pluralize(resourceName);
    const pascalName = this.toPascalCase(resourceName);

    // Build entity schema
    const entityFields = fields
      .map(f => `  ${f.name}: ${f.zodType},`)
      .join('\n');
    const entitySchema = `const ${pascalName}Schema = z.object({\n${entityFields}\n});`;

    // Build create schema (only fields with inCreate: true)
    const createFields = fields
      .filter(f => f.inCreate)
      .map(f => `  ${f.name}: ${f.zodType},`)
      .join('\n');
    const createSchema = `const Create${pascalName}Schema = z.object({\n${createFields}\n});`;

    // Build update schema (fields with inUpdate: true, all optional)
    const updateFields = fields
      .filter(f => f.inUpdate)
      .map(f => `  ${f.name}: ${f.zodType}.optional(),`)
      .join('\n');
    const updateSchema = `const Update${pascalName}Schema = z.object({\n${updateFields}\n});`;

    // Type derivations
    const typeDerivations = `type ${pascalName} = z.infer<typeof ${pascalName}Schema>;
type Create${pascalName}Input = z.infer<typeof Create${pascalName}Schema>;
type Update${pascalName}Input = z.infer<typeof Update${pascalName}Schema>;`;

    const completeSchemaFile = this.buildCompleteSchemaFile({
      resourceName,
      resourceNamePlural,
      fields,
      entitySchema,
      createSchema,
      updateSchema,
      typeDerivations,
    });

    return {
      entitySchema,
      createSchema,
      updateSchema,
      typeDerivations,
      completeSchemaFile,
      fields,
      resourceName,
      resourceNamePlural,
    };
  }

  /**
   * Build prompt for schema generation
   */
  private buildPrompt(requirement: AnalyzedRequirement): string {
    return `Generate Zod schemas for the following API:

REQUIREMENT:
${requirement.description}

ACCEPTANCE CRITERIA:
${requirement.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

SUGGESTED APPROACH:
${requirement.suggestedApproach}

COMPLEXITY: ${requirement.estimatedComplexity}

Analyze this requirement and generate:
1. The main entity schema with all necessary fields
2. The create input schema (fields required when creating)
3. The update input schema (fields that can be updated, all optional)
4. Include standard fields: id, createdAt, updatedAt

Be thorough - infer all fields that would be needed for this API.
Include proper validation (email, uuid, min/max lengths, etc.).
`;
  }

  /**
   * Parse and validate Gemini response
   */
  private parseResponse(data: unknown): Omit<GeneratedSchema, 'completeSchemaFile'> {
    const response = data as {
      resourceName?: string;
      resourceNamePlural?: string;
      fields?: FieldMetadata[];
      entitySchema?: string;
      createSchema?: string;
      updateSchema?: string;
    };

    if (!response.resourceName) {
      throw new Error('Missing resourceName in schema response');
    }

    const resourceName = response.resourceName.toLowerCase();
    const resourceNamePlural = response.resourceNamePlural || this.pluralize(resourceName);
    const fields = response.fields || [];

    // Validate fields
    for (const field of fields) {
      if (!field.name || !field.zodType) {
        throw new Error(`Invalid field: ${JSON.stringify(field)}`);
      }
    }

    // Use provided schemas or generate from fields
    const pascalName = this.toPascalCase(resourceName);
    
    const entitySchema = response.entitySchema || this.generateEntitySchema(pascalName, fields);
    const createSchema = response.createSchema || this.generateCreateSchema(pascalName, fields);
    const updateSchema = response.updateSchema || this.generateUpdateSchema(pascalName, fields);
    const typeDerivations = this.generateTypeDerivations(pascalName);

    return {
      resourceName,
      resourceNamePlural,
      fields,
      entitySchema,
      createSchema,
      updateSchema,
      typeDerivations,
    };
  }

  /**
   * Generate entity schema from fields
   */
  private generateEntitySchema(pascalName: string, fields: FieldMetadata[]): string {
    const fieldLines = fields
      .map(f => `  ${f.name}: ${f.zodType},`)
      .join('\n');
    return `const ${pascalName}Schema = z.object({\n${fieldLines}\n});`;
  }

  /**
   * Generate create schema from fields
   */
  private generateCreateSchema(pascalName: string, fields: FieldMetadata[]): string {
    const createFields = fields
      .filter(f => f.inCreate)
      .map(f => `  ${f.name}: ${f.zodType},`)
      .join('\n');
    return `const Create${pascalName}Schema = z.object({\n${createFields}\n});`;
  }

  /**
   * Generate update schema from fields
   */
  private generateUpdateSchema(pascalName: string, fields: FieldMetadata[]): string {
    const updateFields = fields
      .filter(f => f.inUpdate)
      .map(f => {
        // Make field optional for updates
        const zodType = f.zodType.includes('.optional()') 
          ? f.zodType 
          : `${f.zodType}.optional()`;
        return `  ${f.name}: ${zodType},`;
      })
      .join('\n');
    return `const Update${pascalName}Schema = z.object({\n${updateFields}\n});`;
  }

  /**
   * Generate type derivations
   */
  private generateTypeDerivations(pascalName: string): string {
    return `type ${pascalName} = z.infer<typeof ${pascalName}Schema>;
type Create${pascalName}Input = z.infer<typeof Create${pascalName}Schema>;
type Update${pascalName}Input = z.infer<typeof Update${pascalName}Schema>;`;
  }

  /**
   * Build complete schema file content
   */
  private buildCompleteSchemaFile(
    schema: Omit<GeneratedSchema, 'completeSchemaFile'>
  ): string {
    const pascalName = this.toPascalCase(schema.resourceName);

    return `/**
 * ${pascalName} Schema Definitions
 * Generated by ChronosOps SchemaGenerator
 * 
 * These schemas are the SINGLE SOURCE OF TRUTH for:
 * - Runtime validation (Zod)
 * - TypeScript types (z.infer)
 * - API documentation
 */

import { z } from 'zod';

// =============================================================================
// ENTITY SCHEMA
// =============================================================================

${schema.entitySchema}

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

/**
 * Schema for creating a new ${schema.resourceName}
 * All required fields must be provided
 */
${schema.createSchema}

/**
 * Schema for updating an existing ${schema.resourceName}
 * All fields are optional (partial update)
 */
${schema.updateSchema}

// =============================================================================
// TYPE DERIVATIONS
// =============================================================================

${schema.typeDerivations}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  ${pascalName}Schema,
  Create${pascalName}Schema,
  Update${pascalName}Schema,
};

export type {
  ${pascalName},
  Create${pascalName}Input,
  Update${pascalName}Input,
};
`;
  }

  /**
   * Convert to PascalCase
   */
  private toPascalCase(str: string): string {
    return str
      .split(/[-_\s]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }

  /**
   * Simple pluralization
   */
  private pluralize(str: string): string {
    if (str.endsWith('y')) {
      return str.slice(0, -1) + 'ies';
    }
    if (str.endsWith('s') || str.endsWith('x') || str.endsWith('ch') || str.endsWith('sh')) {
      return str + 'es';
    }
    return str + 's';
  }
}

// =============================================================================
// COMMON SCHEMA TEMPLATES
// =============================================================================

/**
 * Pre-built field templates for common entity types
 */
export const COMMON_FIELD_TEMPLATES = {
  id: {
    name: 'id',
    type: 'string',
    zodType: 'z.string().uuid()',
    required: true,
    inCreate: false,
    inUpdate: false,
    description: 'Unique identifier',
  },
  email: {
    name: 'email',
    type: 'string',
    zodType: 'z.string().email()',
    required: true,
    inCreate: true,
    inUpdate: true,
    description: 'Email address',
  },
  name: {
    name: 'name',
    type: 'string',
    zodType: 'z.string().min(1).max(100)',
    required: true,
    inCreate: true,
    inUpdate: true,
    description: 'Display name',
  },
  title: {
    name: 'title',
    type: 'string',
    zodType: 'z.string().min(1).max(200)',
    required: true,
    inCreate: true,
    inUpdate: true,
    description: 'Title',
  },
  description: {
    name: 'description',
    type: 'string',
    zodType: 'z.string().max(1000).optional()',
    required: false,
    inCreate: true,
    inUpdate: true,
    description: 'Description',
  },
  status: {
    name: 'status',
    type: 'string',
    zodType: "z.enum(['active', 'inactive', 'pending'])",
    required: true,
    inCreate: false,
    inUpdate: true,
    description: 'Status',
  },
  completed: {
    name: 'completed',
    type: 'boolean',
    zodType: 'z.boolean()',
    required: true,
    inCreate: false,
    inUpdate: true,
    description: 'Completion status',
  },
  createdAt: {
    name: 'createdAt',
    type: 'string',
    zodType: 'z.string().datetime()',
    required: true,
    inCreate: false,
    inUpdate: false,
    description: 'Creation timestamp',
  },
  updatedAt: {
    name: 'updatedAt',
    type: 'string',
    zodType: 'z.string().datetime()',
    required: true,
    inCreate: false,
    inUpdate: false,
    description: 'Last update timestamp',
  },
} as const satisfies Record<string, FieldMetadata>;

// Note: SchemaGenerator is already exported at class declaration (line 120)

/**
 * Generated Schema Types for Contract-First Code Generation
 * Part of the V2 pipeline for achieving 99%+ first-pass accuracy
 */

/**
 * Metadata about a single field in the schema
 */
export interface FieldMetadata {
  /** Field name (camelCase) */
  name: string;
  /** TypeScript type */
  type: string;
  /** Zod validator string (e.g., "z.string().email()") */
  zodType: string;
  /** Whether the field is required in the entity */
  required: boolean;
  /** Whether the field appears in the Create schema */
  inCreate: boolean;
  /** Whether the field appears in the Update schema */
  inUpdate: boolean;
  /** Optional description */
  description?: string;
  /** Optional validation rules */
  validation?: string[];
}

/**
 * Complete generated schema system for a resource
 */
export interface GeneratedSchema {
  /** The main entity schema (e.g., UserSchema) */
  entitySchema: string;

  /** Schema for create operations (required fields only) */
  createSchema: string;

  /** Schema for update operations (all fields optional) */
  updateSchema: string;

  /** TypeScript type derivations */
  typeDerivations: string;

  /** Complete schema file content ready to write */
  completeSchemaFile: string;

  /** Metadata about all fields */
  fields: FieldMetadata[];

  /** Resource name (singular, e.g., "user") */
  resourceName: string;

  /** Resource name (plural, e.g., "users") */
  resourceNamePlural: string;
}

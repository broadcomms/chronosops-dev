/**
 * Code Generation Pipeline
 * Self-regenerating app ecosystem components
 */

export { RequirementAnalyzer } from './requirement-analyzer.js';
export type { RequirementAnalyzerConfig } from './requirement-analyzer.js';

export { CodeGenerator } from './code-generator.js';
export type { CodeGenerationOptions } from './code-generator.js';

export { CodeValidator } from './code-validator.js';

export { CodeFixer } from './code-fixer.js';

export { TestGenerator } from './test-generator.js';
export type { TestGenerationOptions } from './test-generator.js';

export { ManifestGenerator } from './manifest-generator.js';

export { FileManager } from './file-manager.js';

export { ApiSpecExtractor, apiSpecExtractor } from './api-spec-extractor.js';
export type { ApiSpecExtractionResult } from './api-spec-extractor.js';

export { FrontendCodeGenerator } from './frontend-code-generator.js';
export type { FrontendGenerationInput, FrontendGenerationResult } from './frontend-code-generator.js';

// V2: Fast validation and schema-first generation
export { FastValidator, AutoFixer, fastValidator, autoFixer } from './fast-validator.js';
export type { FastValidationResult, FastValidationError, FastValidationWarning } from './fast-validator.js';

export { SchemaGenerator, COMMON_FIELD_TEMPLATES } from './schema-generator.js';
export type { GeneratedSchema, FieldMetadata, SchemaGenerationResult, SchemaGenerationFn } from './schema-generator.js';

// V3: OpenAPI documentation generation
export {
  generateOpenAPISpec,
  generateOpenAPIFromDesign,
  generateSwaggerUIHtml,
  generateDocumentationCode,
} from './openapi-generator.js';
export type {
  OpenAPIGeneratorInput,
  EndpointSpec,
  ParamSpec,
  ResponseSpec,
  SchemaInfo,
  PropertySpec,
} from './openapi-generator.js';

// V4: Database persistence support
export {
  generateDatabaseSchema,
  extractTableDefinitions,
  generateDrizzleCrudOperations,
} from './database-schema-generator.js';
export type {
  FieldDefinition,
  TableDefinition,
  GeneratedDatabaseSchema,
} from './database-schema-generator.js';

// Export all types
export type {
  CodeGenerationConfig,
  RequirementAnalysisResult,
  ArchitectureDesignResult,
  CodeGenerationResult,
  CodeValidationPipelineResult,
  CodeFixResult,
  TestGenerationResult,
  TestExecutionResult,
  ManifestGenerationResult,
  ManifestType,
  ManifestGenerationOptions,
  FileWriteResult,
  BatchFileWriteResult,
  StorageMode,
  PersistenceConfig,
  TimeBudget,
} from './types.js';

export {
  DEFAULT_CODE_GENERATION_CONFIG,
  DEFAULT_PERSISTENCE_CONFIG,
  MIN_TIME_FOR_FIX_ITERATION_MS,
} from './types.js';

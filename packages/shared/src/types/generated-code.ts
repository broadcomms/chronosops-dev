/**
 * Generated code types for self-regenerating app ecosystem
 */

import type { ExternalDependency, ComponentSpec } from './architecture.js';

/**
 * Supported file languages
 */
export type FileLanguage =
  | 'typescript'
  | 'javascript'
  | 'json'
  | 'yaml'
  | 'markdown'
  | 'dockerfile'
  | 'shell'
  | 'css'
  | 'html';

/**
 * Generated code from AI
 */
export interface GeneratedCode {
  /** All generated files */
  files: GeneratedFile[];

  /** Dependencies to add to package.json */
  dependencies: ExternalDependency[];

  /** Explanation of the implementation */
  explanation: string;

  /** Integration notes for existing code */
  integrationNotes?: string;

  /** Thought signature for continuity */
  thoughtSignature?: string;
}

/**
 * A single generated file
 */
export interface GeneratedFile {
  /** Relative path from project root */
  path: string;

  /** File content */
  content: string;

  /** Language of the file */
  language: FileLanguage;

  /** Purpose of this file */
  purpose: string;

  /** Whether this is a new file or modification */
  isNew: boolean;

  /** For modifications, the original content */
  originalContent?: string;

  /** Hash of content for change detection */
  contentHash?: string;
}

/**
 * Generated test file
 */
export interface GeneratedTest extends GeneratedFile {
  /** What this test covers */
  covers: string[];

  /** Test framework used */
  framework: 'vitest' | 'jest';

  /** Number of test cases */
  testCount: number;

  /** Types of tests included */
  testTypes: ('unit' | 'integration' | 'e2e')[];
}

/**
 * Code validation result
 */
export interface CodeValidationResult {
  /** Whether all validations passed */
  valid: boolean;

  /** TypeScript compilation errors */
  typeErrors: CodeValidationIssue[];

  /** ESLint errors */
  lintErrors: CodeValidationIssue[];

  /** Test syntax errors */
  testErrors: CodeValidationIssue[];

  /** Overall error count */
  errorCount: number;

  /** Warning count */
  warningCount: number;
}

/**
 * Single code validation issue (renamed to avoid conflict with errors/ValidationError)
 */
export interface CodeValidationIssue {
  /** File path */
  file: string;

  /** Line number */
  line: number;

  /** Column number */
  column: number;

  /** Error message */
  message: string;

  /** Error code (e.g., TS2345) */
  code?: string;

  /** Severity */
  severity: 'error' | 'warning';

  /** Rule that triggered the error (for lint) */
  rule?: string;
}

/**
 * Code fix request
 */
export interface CodeFixRequest {
  /** Original code */
  code: string;

  /** Errors to fix */
  errors: string[];

  /** File language */
  language: FileLanguage;

  /** Context about the code */
  context?: string;

  /** Previous fix attempts */
  previousAttempts?: number;
}

/**
 * Code fix response
 */
export interface CodeFixResponse {
  /** Fixed code */
  fixedCode: string;

  /** Explanation of fixes */
  explanation: string;

  /** Whether all errors were addressed */
  allErrorsFixed: boolean;

  /** Remaining errors if any */
  remainingErrors?: string[];
}

/**
 * Request to generate code
 */
export interface CodeGenerationRequest {
  /** Unique identifier for tracking */
  requirementId: string;

  /** Requirement description */
  requirement: string;

  /** Type of generation */
  type: 'component' | 'service' | 'route' | 'test' | 'manifest';

  /** Project context */
  context: string;

  /** Existing code patterns to follow */
  existingCode?: string;

  /** Target language */
  targetLanguage: FileLanguage;

  /** Constraints for generation */
  constraints?: string[];

  /** Continue from previous generation */
  thoughtSignature?: string;
}

/**
 * Response from code generation
 */
export interface CodeGenerationResponse {
  /** Generated files */
  files: GeneratedFile[];

  /** Dependencies to add */
  dependencies: ExternalDependency[];

  /** Explanation */
  explanation: string;

  /** Integration notes */
  integrationNotes?: string;

  /** Generated tests */
  tests?: GeneratedTest[];
}

/**
 * Request to generate tests
 */
export interface TestGenerationRequest {
  /** Component specification */
  component: ComponentSpec;

  /** Generated code to test */
  code: GeneratedCode;

  /** Test framework */
  framework: 'vitest' | 'jest';

  /** Coverage requirements */
  coverageTarget?: number;
}

/**
 * Response from test generation
 */
export interface TestGenerationResponse {
  /** Generated test files */
  files: GeneratedTest[];

  /** Total test count */
  testCount: number;

  /** Explanation */
  explanation: string;
}

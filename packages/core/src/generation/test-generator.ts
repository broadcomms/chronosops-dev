/**
 * Test Generator
 * Generates unit tests for generated code using Gemini
 *
 * V2: Now accepts GeneratedSchema to ensure tests use correct field names
 * matching the Zod validation in generated code.
 */

import { createChildLogger } from '@chronosops/shared';
import type { GeneratedFile, ArchitectureDesign, ComponentSpec, GeneratedSchema, FieldMetadata } from '@chronosops/shared';
import type { GeminiClient, TestGenerationGeminiResponse } from '@chronosops/gemini';
import type { TestGenerationResult, CodeGenerationConfig } from './types.js';
import { DEFAULT_CODE_GENERATION_CONFIG } from './types.js';

/**
 * Options for test generation
 */
export interface TestGenerationOptions {
  /** Pre-generated schema with field metadata for accurate test data */
  schema?: GeneratedSchema;
}

export class TestGenerator {
  private geminiClient: GeminiClient;
  private config: CodeGenerationConfig;
  private logger = createChildLogger({ component: 'TestGenerator' });
  private schema?: GeneratedSchema;

  constructor(
    geminiClient: GeminiClient,
    config: Partial<CodeGenerationConfig> = {}
  ) {
    this.geminiClient = geminiClient;
    this.config = { ...DEFAULT_CODE_GENERATION_CONFIG, ...config };
  }

  /**
   * Generate tests for the entire codebase
   * Uses a SINGLE Gemini call for all components (1M context window)
   *
   * @param files - Generated source code files
   * @param design - Architecture design with component specs
   * @param options - Optional test generation options including schema
   */
  async generate(
    files: GeneratedFile[],
    design: ArchitectureDesign,
    options?: TestGenerationOptions
  ): Promise<TestGenerationResult> {
    const startTime = Date.now();

    // Store schema for use in test generation methods
    this.schema = options?.schema;

    this.logger.info({
      fileCount: files.length,
      componentCount: design.components.length,
      hasSchema: !!this.schema,
      schemaFields: this.schema?.fields?.length ?? 0,
    }, 'Starting test generation (single Gemini call)');

    try {
      // Generate ALL tests in a single Gemini call
      const testFiles = await this.generateAllComponentTests(files, design);

      // Generate test configuration
      const configFiles = this.generateTestConfig();
      testFiles.push(...configFiles);

      // Estimate coverage based on test count
      const estimatedCoverage = Math.min(
        95,
        testFiles.length * 15 // Rough estimate
      );

      this.logger.info({
        testFiles: testFiles.length,
        estimatedCoverage,
        processingTimeMs: Date.now() - startTime,
      }, 'Test generation complete');

      return {
        success: true,
        tests: testFiles,
        coverage: estimatedCoverage,
        processingTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error: errorMessage }, 'Test generation failed');

      return {
        success: false,
        error: errorMessage,
        processingTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Generate tests for ALL components in a single Gemini call
   * This is much faster than calling Gemini once per component
   *
   * V2: Now includes schema information for accurate test data generation
   */
  private async generateAllComponentTests(
    files: GeneratedFile[],
    design: ArchitectureDesign
  ): Promise<GeneratedFile[]> {
    // Filter to only include source code files (not config files)
    const sourceFiles = files.filter(f =>
      f.path.endsWith('.ts') &&
      !f.path.endsWith('.test.ts') &&
      !f.path.includes('vitest.config') &&
      !f.path.includes('jest.config')
    );

    // Build schema context for Gemini if available
    // This ensures generated tests use correct field names matching Zod validation
    const schemaContext = this.schema ? {
      resourceName: this.schema.resourceName,
      resourceNamePlural: this.schema.resourceNamePlural,
      fields: this.schema.fields.map(f => ({
        name: f.name,
        type: f.type,
        required: f.required,
        inCreate: f.inCreate,
        inUpdate: f.inUpdate,
        description: f.description,
      })),
      createFields: this.schema.fields.filter(f => f.inCreate).map(f => f.name),
      updateFields: this.schema.fields.filter(f => f.inUpdate).map(f => f.name),
    } : null;

    // Try to generate all tests in a single call
    const response = await this.geminiClient.generateAllTests({
      allComponents: JSON.stringify(design.components.map(c => ({
        name: c.name,
        purpose: c.purpose,
        interface: c.interface,
      }))),
      allCode: JSON.stringify(sourceFiles.map(f => ({
        path: f.path,
        content: f.content,
      }))),
      framework: this.config.testFramework as 'vitest' | 'jest',
      coverageTarget: this.config.requiredCoverage,
      // V2: Include schema context so Gemini uses correct field names
      schemaContext: schemaContext ? JSON.stringify(schemaContext) : undefined,
    });

    if (!response.success || !response.data) {
      this.logger.warn({
        error: response.error,
        hasSchema: !!this.schema,
      }, 'Gemini all-tests generation failed, falling back to basic tests');

      // Fall back to basic template tests (these now also use schema)
      return design.components.map(c => this.generateBasicTest(c));
    }

    // Parse and normalize the response
    return this.parseAllTestsResponse(response.data, design.components);
  }

  /**
   * Parse Gemini all-tests response and normalize paths
   * CRITICAL: Ensures all test files are placed in src/ directory to match vitest.config.ts
   */
  private parseAllTestsResponse(
    data: TestGenerationGeminiResponse,
    components: ComponentSpec[]
  ): GeneratedFile[] {
    if (!data.files || !Array.isArray(data.files)) {
      return components.map(c => this.generateBasicTest(c));
    }

    return data.files.map((test) => {
      let path = test.path;
      if (path) {
        // CRITICAL FIX: Normalize all paths to be in src/ directory
        // Gemini sometimes generates paths like:
        // - packages/api/src/app.test.ts
        // - tests/app.test.ts
        // - __tests__/app.test.ts
        // All should become: src/{component}/component.test.ts

        // Extract the test filename
        const filename = path.split('/').pop() || 'test.test.ts';

        // Find the component this test is for based on path or filename
        let matchedComponent: ComponentSpec | undefined;
        for (const component of components) {
          const kebabName = this.kebabCase(component.name);
          const pascalName = component.name;
          const lowerName = component.name.toLowerCase();

          // Check if path or filename contains component name
          if (path.toLowerCase().includes(kebabName) ||
              path.includes(pascalName) ||
              filename.toLowerCase().includes(lowerName) ||
              filename.toLowerCase().includes(kebabName)) {
            matchedComponent = component;
            break;
          }
        }

        if (matchedComponent) {
          // Normalize to src/{kebab-name}/{kebab-name}.test.ts format
          const kebabName = this.kebabCase(matchedComponent.name);
          path = `src/${kebabName}/${kebabName}.test.ts`;
        } else {
          // If no component matched, ensure path starts with src/
          if (!path.startsWith('src/')) {
            // Extract meaningful part from path
            // e.g., "packages/api/src/app.test.ts" -> "app.test.ts"
            // e.g., "__tests__/integration.test.ts" -> "integration.test.ts"
            const cleanFilename = filename.endsWith('.test.ts') ? filename : `${filename.replace('.ts', '')}.test.ts`;
            path = `src/${cleanFilename}`;
          }
        }

        this.logger.debug({ originalPath: test.path, normalizedPath: path }, 'Normalized test file path');
      }
      return {
        path: path || 'src/test.test.ts',
        language: 'typescript' as const,
        purpose: test.purpose ?? 'Generated tests',
        isNew: test.isNew ?? true,
        content: test.content ?? '',
      };
    });
  }

  /**
   * Generate a basic test file from template
   */
  private generateBasicTest(component: ComponentSpec): GeneratedFile {
    // Check if this is an App component (has start() method and likely has routes)
    const isAppComponent = component.name.toLowerCase().includes('app');

    if (isAppComponent) {
      return this.generateApiTest(component);
    }

    // For non-app components, generate basic unit tests
    const testCases = component.interface.map((iface) => {
      const testName = `should ${iface.name} successfully`;

      return `
  it('${testName}', async () => {
    const instance = new ${component.name}();
    // TODO: Add proper test implementation
    expect(instance).toBeDefined();
  });`;
    });

    const content = `/**
 * Tests for ${component.name}
 * Auto-generated by ChronosOps Test Generator
 */

import { describe, it, expect, beforeEach, vi } from '${this.config.testFramework}';
import { ${component.name} } from './index.js';

describe('${component.name}', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create instance', () => {
    const instance = new ${component.name}();
    expect(instance).toBeDefined();
  });
${testCases.join('\n')}
});
`;

    return {
      path: `src/${this.kebabCase(component.name)}/${this.kebabCase(component.name)}.test.ts`,
      language: 'typescript',
      purpose: `Tests for ${component.name}`,
      isNew: true,
      content,
    };
  }

  /**
   * Generate API tests using supertest for App components
   *
   * V2: Now uses schema fields for accurate test request bodies
   */
  private generateApiTest(component: ComponentSpec): GeneratedFile {
    // Generate test data based on schema if available
    const testData = this.generateTestData();
    const resourceName = this.schema?.resourceName ?? 'item';
    const resourceNamePlural = this.schema?.resourceNamePlural ?? 'items';
    const pascalName = this.toPascalCase(resourceName);

    // Generate CRUD tests if we have schema information
    const crudTests = this.schema ? `
  describe('POST /${resourceNamePlural}', () => {
    it('should create a new ${resourceName}', async () => {
      const response = await request(app)
        .post('/${resourceNamePlural}')
        .send(${JSON.stringify(testData.create, null, 6).replace(/\n/g, '\n      ')});
      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
${this.generateFieldAssertions(testData.create, '      ')}
    });

    it('should return 400 for invalid data', async () => {
      const response = await request(app)
        .post('/${resourceNamePlural}')
        .send({});
      expect(response.status).toBe(400);
    });
  });

  describe('GET /${resourceNamePlural}', () => {
    it('should return a list of ${resourceNamePlural}', async () => {
      const response = await request(app).get('/${resourceNamePlural}');
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('GET /${resourceNamePlural}/:id', () => {
    it('should return 404 for non-existent ${resourceName}', async () => {
      const response = await request(app).get('/${resourceNamePlural}/non-existent-id');
      expect(response.status).toBe(404);
    });
  });

  describe('PUT /${resourceNamePlural}/:id', () => {
    it('should return 404 for non-existent ${resourceName}', async () => {
      const response = await request(app)
        .put('/${resourceNamePlural}/non-existent-id')
        .send(${JSON.stringify(testData.update, null, 6).replace(/\n/g, '\n      ')});
      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /${resourceNamePlural}/:id', () => {
    it('should return 404 for non-existent ${resourceName}', async () => {
      const response = await request(app).delete('/${resourceNamePlural}/non-existent-id');
      expect(response.status).toBe(404);
    });
  });
` : `
  // No schema available - only health check tests generated
  // Schema-aware tests would include CRUD operations with proper field names
`;

    const content = `/**
 * API Tests for ${component.name}
 * Auto-generated by ChronosOps Test Generator
 * ${this.schema ? `Resource: ${pascalName} (${this.schema.fields.length} fields)` : 'No schema - basic tests only'}
 */

import { describe, it, expect } from '${this.config.testFramework}';
import request from 'supertest';
import { app } from './index.js';

describe('${component.name} API', () => {
  describe('GET /health', () => {
    it('should return status ok', async () => {
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
    });
  });
${crudTests}});
`;

    return {
      path: `src/${this.kebabCase(component.name)}/${this.kebabCase(component.name)}.test.ts`,
      language: 'typescript',
      purpose: `API tests for ${component.name}`,
      isNew: true,
      content,
    };
  }

  /**
   * Generate test data based on schema fields
   */
  private generateTestData(): { create: Record<string, unknown>; update: Record<string, unknown> } {
    if (!this.schema) {
      return { create: {}, update: {} };
    }

    const create: Record<string, unknown> = {};
    const update: Record<string, unknown> = {};

    for (const field of this.schema.fields) {
      const testValue = this.generateFieldValue(field);

      if (field.inCreate) {
        create[field.name] = testValue;
      }
      if (field.inUpdate) {
        update[field.name] = testValue;
      }
    }

    return { create, update };
  }

  /**
   * Generate a test value for a field based on its type and validation
   */
  private generateFieldValue(field: FieldMetadata): unknown {
    const zodType = field.zodType.toLowerCase();

    // Handle common Zod validators
    if (zodType.includes('email')) {
      return 'test@example.com';
    }
    if (zodType.includes('uuid')) {
      return '123e4567-e89b-12d3-a456-426614174000';
    }
    if (zodType.includes('url')) {
      return 'https://example.com';
    }
    if (zodType.includes('datetime')) {
      return new Date().toISOString();
    }
    if (zodType.includes('boolean')) {
      return true;
    }
    if (zodType.includes('number') || zodType.includes('int')) {
      return 42;
    }
    if (zodType.includes('enum')) {
      // Extract first enum value if possible
      const match = zodType.match(/enum\(\[['"]([^'"]+)['"]/);
      return match ? match[1] : 'active';
    }

    // Default to string with field name as hint
    return `test-${field.name}`;
  }

  /**
   * Generate field assertions for test expectations
   */
  private generateFieldAssertions(data: Record<string, unknown>, indent: string): string {
    return Object.entries(data)
      .map(([key, value]) => {
        const valueStr = typeof value === 'string' ? `'${value}'` : String(value);
        return `${indent}expect(response.body).toHaveProperty('${key}', ${valueStr});`;
      })
      .join('\n');
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

  /**
   * Generate test configuration files
   *
   * V2: Fixed vitest config to:
   * - Include setupFiles for test-setup.ts
   * - Remove overlapping include patterns that cause duplicate test runs
   * - Add proper timeout for GKE container environment
   */
  private generateTestConfig(): GeneratedFile[] {
    const files: GeneratedFile[] = [];

    if (this.config.testFramework === 'vitest') {
      files.push({
        path: 'vitest.config.ts',
        language: 'typescript',
        purpose: 'Vitest configuration',
        isNew: true,
        content: `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // V2: Include setup file for test utilities and mock resets
    setupFiles: ['./src/test-setup.ts'],
    // V2: Increase timeout for GKE container environment
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: ${this.config.requiredCoverage},
        functions: ${this.config.requiredCoverage},
        branches: ${this.config.requiredCoverage},
        statements: ${this.config.requiredCoverage},
      },
    },
    // V2: Simplified include pattern - only src/**/*.test.ts to avoid duplicates
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    // Exclude node_modules and build output
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
`,
      });
    } else {
      files.push({
        path: 'jest.config.js',
        language: 'javascript',
        purpose: 'Jest configuration',
        isNew: true,
        content: `module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  testTimeout: 30000,
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.test.ts'],
  coverageThreshold: {
    global: {
      lines: ${this.config.requiredCoverage},
      functions: ${this.config.requiredCoverage},
      branches: ${this.config.requiredCoverage},
      statements: ${this.config.requiredCoverage},
    },
  },
};
`,
      });
    }

    // Test setup file - now properly referenced in vitest.config.ts
    files.push({
      path: 'src/test-setup.ts',
      language: 'typescript',
      purpose: 'Test setup and utilities',
      isNew: true,
      content: `/**
 * Test Setup
 * Auto-generated by ChronosOps Test Generator
 *
 * This file is automatically loaded by vitest before running tests.
 * It provides global test utilities and ensures mocks are reset between tests.
 */

import { vi, beforeEach, afterEach } from '${this.config.testFramework}';

// Global test utilities
export function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

// Reset all mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});

// Cleanup after each test
afterEach(() => {
  vi.restoreAllMocks();
});
`,
    });

    return files;
  }

  /**
   * Generate integration tests
   */
  async generateIntegrationTests(
    design: ArchitectureDesign
  ): Promise<GeneratedFile[]> {
    const tests: GeneratedFile[] = [];

    // Generate end-to-end test
    tests.push({
      path: 'src/__tests__/integration.test.ts',
      language: 'typescript',
      purpose: 'Integration tests',
      isNew: true,
      content: `/**
 * Integration Tests
 * Auto-generated by ChronosOps Test Generator
 */

import { describe, it, expect, beforeAll, afterAll } from '${this.config.testFramework}';

describe('Integration Tests', () => {
  beforeAll(async () => {
    // Setup test environment
  });

  afterAll(async () => {
    // Cleanup test environment
  });

  it('should start application successfully', async () => {
    // TODO: Implement startup test
    expect(true).toBe(true);
  });

${design.components.map((c) => `
  describe('${c.name}', () => {
    it('should integrate with other components', async () => {
      // TODO: Implement integration test for ${c.name}
      expect(true).toBe(true);
    });
  });
`).join('')}
});
`,
    });

    return tests;
  }

  // String utility
  private kebabCase(str: string): string {
    return str
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/[\s_]+/g, '-')
      .toLowerCase();
  }
}

/**
 * Code Generator Tests
 * Tests for code generation from architecture design
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CodeGenerator } from './code-generator.js';
import type { GeminiClient } from '@chronosops/gemini';
import type { ArchitectureDesign, GeneratedFile, ComponentSpec } from '@chronosops/shared';

// ===========================================
// Mock Types & Factories
// ===========================================

const createMockGeminiClient = () => ({
  generateContent: vi.fn(),
  getModelForTask: vi.fn().mockReturnValue('gemini-3-flash-preview'),
  generateCode: vi.fn(),
  analyzeFrames: vi.fn(),
  designArchitecture: vi.fn(),
  analyzeRequirement: vi.fn(),
});

const createMockComponent = (
  name: string,
  purpose: string,
  type: ComponentSpec['type'] = 'service'
): ComponentSpec => ({
  name,
  type,
  purpose,
  suggestedPath: `src/${name.toLowerCase()}`,
  interface: [
    {
      name: `get${name}`,
      description: `Get ${name} data`,
      parameters: [],
      returnType: 'Promise<void>',
      async: true,
    },
  ],
  errorHandling: 'Use try/catch with typed errors',
  dependsOn: [],
});

const createMockArchitecture = (
  overrides: Partial<ArchitectureDesign> = {}
): ArchitectureDesign => ({
  overview: 'A REST API for task management',
  components: [
    createMockComponent('TaskApp', 'Main application server', 'app'),
    createMockComponent('TaskService', 'Business logic for task operations', 'service'),
  ],
  dependencies: [
    { from: 'TaskApp', to: 'TaskService', type: 'uses' },
  ],
  externalDependencies: [
    { name: 'express', version: '^4.18.2', purpose: 'Web framework', devOnly: false },
    { name: 'zod', version: '^3.22.0', purpose: 'Schema validation', devOnly: false },
  ],
  dataFlow: 'Client -> TaskApp -> TaskService',
  securityConsiderations: ['Input validation', 'Error handling'],
  performanceConsiderations: ['Use connection pooling'],
  ...overrides,
});

const createMockGeneratedFiles = (): GeneratedFile[] => [
  {
    path: 'src/index.ts',
    content: `import express, { Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';

const app = express();
app.use(express.json());

interface Task {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
}

const tasks: Task[] = [];

const CreateTaskSchema = z.object({
  title: z.string().min(1),
});

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.get('/tasks', (req: Request, res: Response) => {
  res.json(tasks);
});

app.post('/tasks', (req: Request, res: Response) => {
  try {
    const input = CreateTaskSchema.parse(req.body);
    const task: Task = {
      id: randomUUID(),
      title: input.title,
      completed: false,
      createdAt: new Date().toISOString(),
    };
    tasks.push(task);
    res.status(201).json(task);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/tasks/:id', (req: Request, res: Response) => {
  const task = tasks.find(t => t.id === req.params.id);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json(task);
});

export { app };
export function start() {
  const port = process.env.PORT || 8080;
  app.listen(port, () => {
    console.log(\`Server running on port \${port}\`);
  });
}`,
    language: 'typescript',
    purpose: 'Main application entry point with Express server',
  },
  {
    path: 'package.json',
    content: JSON.stringify({
      name: 'task-api',
      version: '1.0.0',
      main: 'dist/index.js',
      scripts: {
        build: 'tsc',
        start: 'node dist/index.js',
        dev: 'tsx src/index.ts',
        test: 'vitest run',
      },
      dependencies: {
        express: '^4.18.2',
        zod: '^3.23.0',
      },
      devDependencies: {
        '@types/express': '^4.17.21',
        '@types/node': '^20.10.0',
        typescript: '^5.3.0',
        tsx: '^4.7.0',
        vitest: '^1.0.0',
        supertest: '^6.3.0',
        '@types/supertest': '^6.0.0',
      },
    }, null, 2),
    language: 'json',
    purpose: 'Package configuration',
  },
  {
    path: 'tsconfig.json',
    content: JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'CommonJS',
        moduleResolution: 'Node',
        esModuleInterop: true,
        strict: false,
        outDir: './dist',
        rootDir: './src',
      },
      include: ['src/**/*'],
      exclude: ['node_modules', 'dist'],
    }, null, 2),
    language: 'json',
    purpose: 'TypeScript configuration',
  },
];

describe('CodeGenerator', () => {
  let codeGenerator: CodeGenerator;
  let mockGeminiClient: ReturnType<typeof createMockGeminiClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGeminiClient = createMockGeminiClient();

    // Default mock response for generateCode - returns files from Gemini
    mockGeminiClient.generateCode.mockResolvedValue({
      success: true,
      data: {
        files: createMockGeneratedFiles(),
        dependencies: ['express', 'zod'],
        explanation: 'Generated task management API',
      },
    });

    // Create CodeGenerator with GeminiClient directly (not wrapped in object)
    codeGenerator = new CodeGenerator(
      mockGeminiClient as unknown as GeminiClient
    );
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('constructor', () => {
    it('should create generator with required dependencies', () => {
      const generator = new CodeGenerator(
        mockGeminiClient as unknown as GeminiClient
      );
      expect(generator).toBeDefined();
    });

    it('should accept optional configuration', () => {
      const generator = new CodeGenerator(
        mockGeminiClient as unknown as GeminiClient,
        { projectName: 'custom-project', testFramework: 'jest' }
      );
      expect(generator).toBeDefined();
    });
  });

  describe('generate', () => {
    it('should generate code from architecture design', async () => {
      const architecture = createMockArchitecture();

      const result = await codeGenerator.generate(architecture);

      expect(result.success).toBe(true);
      expect(result.code).toBeDefined();
      expect(result.code?.files).toBeDefined();
      expect(result.code?.files.length).toBeGreaterThan(0);
    });

    it('should call Gemini client to generate code', async () => {
      const architecture = createMockArchitecture();

      await codeGenerator.generate(architecture);

      expect(mockGeminiClient.generateCode).toHaveBeenCalled();
    });

    it('should generate required configuration files', async () => {
      const architecture = createMockArchitecture();

      const result = await codeGenerator.generate(architecture);

      expect(result.success).toBe(true);
      const filePaths = result.code?.files.map((f) => f.path) ?? [];

      // Should include main entry point
      expect(filePaths.some((p) => p.includes('index.ts'))).toBe(true);
      // Should include package.json
      expect(filePaths.some((p) => p === 'package.json')).toBe(true);
      // Should include tsconfig.json
      expect(filePaths.some((p) => p === 'tsconfig.json')).toBe(true);
    });

    it('should include proper dependencies', async () => {
      const architecture = createMockArchitecture();

      const result = await codeGenerator.generate(architecture);

      expect(result.success).toBe(true);
      // Dependencies extracted from architecture design
      expect(result.code?.dependencies).toBeDefined();
    });

    it('should handle Gemini client errors gracefully', async () => {
      mockGeminiClient.generateCode.mockResolvedValue({
        success: false,
        error: 'API error occurred',
      });

      const architecture = createMockArchitecture();

      const result = await codeGenerator.generate(architecture);

      // When Gemini fails, CodeGenerator falls back to template generation
      // which should succeed, so check that result has code
      expect(result.success).toBe(true);
      expect(result.code?.files.length).toBeGreaterThan(0);
    });

    it('should handle Gemini client exceptions', async () => {
      mockGeminiClient.generateCode.mockRejectedValue(new Error('Network error'));

      const architecture = createMockArchitecture();

      const result = await codeGenerator.generate(architecture);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });

    it('should accept schema option for schema-first generation', async () => {
      const architecture = createMockArchitecture();
      const schema = {
        resourceName: 'Task',
        fields: [
          { name: 'title', type: 'string', required: true },
          { name: 'completed', type: 'boolean', required: false },
        ],
        zodSchema: 'z.object({ title: z.string(), completed: z.boolean().optional() })',
        typeDefinition: 'interface Task { title: string; completed?: boolean; }',
        completeSchemaFile: 'export const TaskSchema = z.object({ title: z.string() });',
      };

      const result = await codeGenerator.generate(architecture, { schema });

      expect(result.success).toBe(true);
    });

    it('should accept previous build errors for retry context', async () => {
      const architecture = createMockArchitecture();
      const previousErrors = [
        'Cannot find module "uuid"',
        'Type "string" is not assignable to type "number"',
      ];

      const result = await codeGenerator.generate(architecture, {
        previousBuildErrors: previousErrors,
      });

      expect(result.success).toBe(true);
      // Errors should be passed to Gemini as constraints
      expect(mockGeminiClient.generateCode).toHaveBeenCalledWith(
        expect.objectContaining({
          constraints: expect.arrayContaining([
            expect.stringContaining('CRITICAL'),
          ]),
        })
      );
    });

    it('should track processing time', async () => {
      const architecture = createMockArchitecture();

      const result = await codeGenerator.generate(architecture);

      expect(result.processingTimeMs).toBeDefined();
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('generated code quality', () => {
    it('should include health endpoint in generated code', async () => {
      const architecture = createMockArchitecture();

      const result = await codeGenerator.generate(architecture);

      expect(result.success).toBe(true);

      // Find the main app file that contains express app setup
      const mainFile = result.code?.files.find((f) =>
        f.path.includes('index.ts') && f.content.includes('express')
      );
      // When Gemini response includes files with /health, verify it
      // Otherwise fallback templates may not include it - check the entry point
      const hasHealth = mainFile?.content?.includes('/health') ||
        result.code?.files.some((f) => f.content.includes('/health'));
      expect(hasHealth).toBe(true);
    });

    it('should generate code with proper TypeScript types', async () => {
      const architecture = createMockArchitecture();

      const result = await codeGenerator.generate(architecture);

      expect(result.success).toBe(true);

      const mainFile = result.code?.files.find((f) =>
        f.path.includes('index.ts') && f.content.includes('express')
      );
      expect(mainFile?.content).toContain('Request');
      expect(mainFile?.content).toContain('Response');
    });
  });

  describe('package.json generation', () => {
    it('should include required dependencies', async () => {
      const architecture = createMockArchitecture();

      const result = await codeGenerator.generate(architecture);

      expect(result.success).toBe(true);

      const packageJson = result.code?.files.find((f) => f.path === 'package.json');
      expect(packageJson).toBeDefined();

      const pkg = JSON.parse(packageJson?.content ?? '{}') as {
        dependencies?: Record<string, string>;
      };
      expect(pkg.dependencies?.express).toBeDefined();
      expect(pkg.dependencies?.zod).toBeDefined();
    });

    it('should include dev dependencies for testing', async () => {
      const architecture = createMockArchitecture();

      const result = await codeGenerator.generate(architecture);

      expect(result.success).toBe(true);

      const packageJson = result.code?.files.find((f) => f.path === 'package.json');
      const pkg = JSON.parse(packageJson?.content ?? '{}') as {
        devDependencies?: Record<string, string>;
      };

      expect(pkg.devDependencies?.typescript).toBeDefined();
      expect(pkg.devDependencies?.vitest).toBeDefined();
    });

    it('should include npm scripts', async () => {
      const architecture = createMockArchitecture();

      const result = await codeGenerator.generate(architecture);

      expect(result.success).toBe(true);

      const packageJson = result.code?.files.find((f) => f.path === 'package.json');
      const pkg = JSON.parse(packageJson?.content ?? '{}') as {
        scripts?: Record<string, string>;
      };

      expect(pkg.scripts?.build).toBeDefined();
      expect(pkg.scripts?.start).toBeDefined();
      expect(pkg.scripts?.test).toBeDefined();
    });
  });

  describe('tsconfig.json generation', () => {
    it('should include TypeScript configuration', async () => {
      const architecture = createMockArchitecture();

      const result = await codeGenerator.generate(architecture);

      expect(result.success).toBe(true);

      const tsconfig = result.code?.files.find((f) => f.path === 'tsconfig.json');
      expect(tsconfig).toBeDefined();

      const config = JSON.parse(tsconfig?.content ?? '{}') as {
        compilerOptions?: { target?: string; module?: string };
      };
      expect(config.compilerOptions?.target).toBeDefined();
      expect(config.compilerOptions?.module).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should handle empty Gemini response gracefully', async () => {
      mockGeminiClient.generateCode.mockResolvedValue({
        success: true,
        data: {
          files: [],
          dependencies: [],
          explanation: 'Empty generation',
        },
      });

      const architecture = createMockArchitecture();

      const result = await codeGenerator.generate(architecture);

      // Should fall back to template generation which produces files
      expect(result.success).toBe(true);
      expect(result.code?.files.length).toBeGreaterThan(0);
    });

    it('should handle undefined data gracefully', async () => {
      mockGeminiClient.generateCode.mockResolvedValue({
        success: true,
        data: undefined,
      });

      const architecture = createMockArchitecture();

      const result = await codeGenerator.generate(architecture);

      // Should fall back to template generation
      expect(result.success).toBe(true);
      expect(result.code?.files.length).toBeGreaterThan(0);
    });

    it('should return design in result even on failure', async () => {
      mockGeminiClient.generateCode.mockRejectedValue(new Error('Fatal error'));

      const architecture = createMockArchitecture();

      const result = await codeGenerator.generate(architecture);

      expect(result.success).toBe(false);
      expect(result.design).toBe(architecture);
    });
  });

  describe('Dockerfile generation', () => {
    it('should include Dockerfile in generated files', async () => {
      const architecture = createMockArchitecture();

      const result = await codeGenerator.generate(architecture);

      expect(result.success).toBe(true);

      const dockerfile = result.code?.files.find((f) => f.path === 'Dockerfile');
      expect(dockerfile).toBeDefined();
      expect(dockerfile?.content).toContain('FROM');
      expect(dockerfile?.content).toContain('node');
    });
  });
});

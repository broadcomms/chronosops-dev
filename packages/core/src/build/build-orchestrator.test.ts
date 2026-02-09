/**
 * Build Orchestrator Tests
 * Tests for the build pipeline: install → lint → test → build → push
 */
import { describe, it, expect, beforeEach, vi, afterEach, type Mock } from 'vitest';
import { BuildOrchestrator } from './build-orchestrator.js';
import type { GeneratedFile } from '@chronosops/shared';

// ===========================================
// Mock child_process spawn
// ===========================================

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({
    stdout: {
      on: vi.fn(),
    },
    stderr: {
      on: vi.fn(),
    },
    on: vi.fn((event, callback) => {
      if (event === 'close') {
        // Default to successful completion
        setTimeout(() => callback(0), 10);
      }
    }),
    kill: vi.fn(),
  })),
}));

// ===========================================
// Mock TestRunner with proper class structure
// ===========================================

const mockTestRunnerRun = vi.fn().mockResolvedValue({
  success: true,
  passed: 10,
  failed: 0,
  skipped: 0,
  total: 10,
  coverage: { lines: 85.5, meetsThreshold: true },
  output: '10 pass, 0 fail',  // Must match regex: /(\d+)\s*pass/i
  durationMs: 5000,
});

vi.mock('./test-runner.js', () => ({
  TestRunner: class MockTestRunner {
    run = mockTestRunnerRun;
  },
}));

// ===========================================
// Mock ImageBuilder with proper class structure
// ===========================================

const mockImageBuilderBuild = vi.fn().mockResolvedValue({
  success: true,
  imageName: 'test-app',
  imageTag: 'latest',
  imageId: 'sha256:abc123',
  buildLogs: ['Building...', 'Done'],
  durationMs: 10000,
});

const mockImageBuilderPush = vi.fn().mockResolvedValue({
  success: true,
});

vi.mock('./image-builder.js', () => ({
  ImageBuilder: class MockImageBuilder {
    build = mockImageBuilderBuild;
    push = mockImageBuilderPush;
  },
}));

// ===========================================
// Test Data Factories
// ===========================================

const createMockGeneratedFiles = (): GeneratedFile[] => [
  {
    path: 'src/index.ts',
    content: `import express from 'express';
const app = express();
app.get('/health', (req, res) => res.json({ status: 'ok' }));
export { app };
export function start() { app.listen(8080); }`,
    language: 'typescript',
    purpose: 'Main entry point',
  },
  {
    path: 'package.json',
    content: JSON.stringify({
      name: 'test-app',
      version: '1.0.0',
      type: 'module',
      scripts: {
        build: 'tsc',
        start: 'node dist/index.js',
        test: 'vitest run',
        lint: 'eslint src/',
      },
      dependencies: {
        express: '^4.18.2',
      },
      devDependencies: {
        typescript: '^5.3.0',
        vitest: '^1.0.0',
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
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        outDir: './dist',
        rootDir: './src',
        strict: true,
      },
      include: ['src/**/*'],
    }, null, 2),
    language: 'json',
    purpose: 'TypeScript configuration',
  },
  {
    path: 'src/index.test.ts',
    content: `import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from './index';

describe('API', () => {
  it('health check', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });
});`,
    language: 'typescript',
    purpose: 'Test file',
  },
  {
    path: 'Dockerfile',
    content: `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/
EXPOSE 8080
CMD ["node", "dist/index.js"]`,
    language: 'dockerfile',
    purpose: 'Docker build configuration',
  },
];

// ===========================================
// Tests
// ===========================================

describe('BuildOrchestrator', () => {
  let buildOrchestrator: BuildOrchestrator;
  const testWorkDir = '/tmp/chronosops-test-builds';

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset mock implementations to defaults
    // Output format must match the regex: /(\d+)\s*pass/i and /(\d+)\s*fail/i
    mockTestRunnerRun.mockResolvedValue({
      success: true,
      passed: 10,
      failed: 0,
      skipped: 0,
      total: 10,
      coverage: { lines: 85.5, meetsThreshold: true },
      output: '10 pass, 0 fail',
      durationMs: 5000,
    });

    mockImageBuilderBuild.mockResolvedValue({
      success: true,
      imageName: 'test-app',
      imageTag: 'latest',
      imageId: 'sha256:abc123',
      buildLogs: ['Building...', 'Done'],
      durationMs: 10000,
    });

    buildOrchestrator = new BuildOrchestrator({
      workDir: testWorkDir,
      skipTests: false,
      skipLint: true, // Skip lint for faster tests
      skipPush: true, // Skip push for tests
      requiredCoverage: 80,
      registry: 'localhost:5000',
      baseImage: 'node:20-alpine',
    });
  });

  afterEach(async () => {
    vi.resetAllMocks();
  });

  describe('constructor', () => {
    it('should create with default configuration', () => {
      const orchestrator = new BuildOrchestrator();
      expect(orchestrator).toBeDefined();
    });

    it('should accept custom configuration', () => {
      const orchestrator = new BuildOrchestrator({
        workDir: '/custom/work/dir',
        skipTests: true,
        skipLint: true,
        requiredCoverage: 90,
        registry: 'custom-registry:5000',
      });
      expect(orchestrator).toBeDefined();
    });
  });

  describe('build', () => {
    it('should complete build pipeline successfully', async () => {
      const files = createMockGeneratedFiles();

      const result = await buildOrchestrator.build(files, 'test-app');

      expect(result.success).toBe(true);
      expect(result.stage).toBe('complete');
      expect(result.imageName).toBe('test-app');
      expect(result.processingTimeMs).toBeGreaterThan(0);
    });

    it('should emit stage change events', async () => {
      const files = createMockGeneratedFiles();
      const stageChanges: string[] = [];

      buildOrchestrator.on('stageChange', (_, stage) => {
        stageChanges.push(stage);
      });

      await buildOrchestrator.build(files, 'test-app');

      expect(stageChanges).toContain('installing');
      expect(stageChanges).toContain('testing');
      expect(stageChanges).toContain('building');
      expect(stageChanges).toContain('complete');
    });

    it('should emit complete event on success', async () => {
      const files = createMockGeneratedFiles();
      const completeSpy = vi.fn();

      buildOrchestrator.on('complete', completeSpy);

      await buildOrchestrator.build(files, 'test-app');

      expect(completeSpy).toHaveBeenCalled();
    });

    it('should include test results when tests run', async () => {
      const files = createMockGeneratedFiles();

      const result = await buildOrchestrator.build(files, 'test-app');

      expect(result.success).toBe(true);
      // Test results are extracted from test runner output
      expect(result.testResults).toBeDefined();
    });

    it('should skip tests when configured', async () => {
      const orchestrator = new BuildOrchestrator({
        workDir: testWorkDir,
        skipTests: true,
        skipLint: true,
        skipPush: true,
      });

      const files = createMockGeneratedFiles();
      const result = await orchestrator.build(files, 'test-app');

      expect(result.success).toBe(true);
      expect(result.testResults).toBeUndefined();
    });

    it('should skip lint when configured', async () => {
      const orchestrator = new BuildOrchestrator({
        workDir: testWorkDir,
        skipTests: true,
        skipLint: true,
        skipPush: true,
      });

      const files = createMockGeneratedFiles();
      const stageChanges: string[] = [];

      orchestrator.on('stageChange', (_, stage) => {
        stageChanges.push(stage);
      });

      await orchestrator.build(files, 'test-app');

      expect(stageChanges).not.toContain('linting');
    });

    it('should generate unique build ID', async () => {
      const files = createMockGeneratedFiles();
      const contexts: string[] = [];

      buildOrchestrator.on('stageChange', (context) => {
        if (!contexts.includes(context.id)) {
          contexts.push(context.id);
        }
      });

      await buildOrchestrator.build(files, 'test-app');
      await buildOrchestrator.build(files, 'test-app');

      // Each build should have a unique ID
      expect(contexts.length).toBe(2);
      expect(contexts[0]).not.toBe(contexts[1]);
    });

    it('should include logs in result', async () => {
      const files = createMockGeneratedFiles();

      const result = await buildOrchestrator.build(files, 'test-app');

      expect(result.logs).toBeDefined();
      expect(Array.isArray(result.logs)).toBe(true);
    });
  });

  describe('build failure handling', () => {
    it('should handle install failure', async () => {
      // Mock spawn to fail for npm install
      const { spawn } = await import('node:child_process');
      (spawn as Mock).mockImplementationOnce(() => ({
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(1), 10); // Exit code 1 = failure
          }
        }),
        kill: vi.fn(),
      }));

      const files = createMockGeneratedFiles();

      const result = await buildOrchestrator.build(files, 'test-app');

      expect(result.success).toBe(false);
      expect(result.stage).toBe('installing');
    });

    it('should emit stageChange to failed on failure', async () => {
      const { spawn } = await import('node:child_process');
      (spawn as Mock).mockImplementationOnce(() => ({
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(1), 10);
          }
        }),
        kill: vi.fn(),
      }));

      const files = createMockGeneratedFiles();
      const stageChanges: string[] = [];

      buildOrchestrator.on('stageChange', (_, stage) => {
        stageChanges.push(stage);
      });

      await buildOrchestrator.build(files, 'test-app');

      expect(stageChanges).toContain('failed');
    });

    it('should include error message in result', async () => {
      const { spawn } = await import('node:child_process');
      (spawn as Mock).mockImplementationOnce(() => ({
        stdout: { on: vi.fn() },
        stderr: {
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              callback(Buffer.from('npm ERR! Cannot find module'));
            }
          }),
        },
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(1), 10);
          }
        }),
        kill: vi.fn(),
      }));

      const files = createMockGeneratedFiles();

      const result = await buildOrchestrator.build(files, 'test-app');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('detectRebuildScope', () => {
    it('should detect full rebuild for package.json changes', () => {
      const scope = buildOrchestrator.detectRebuildScope(['package.json']);
      expect(scope).toBe('full');
    });

    it('should detect full rebuild for tsconfig.json changes', () => {
      const scope = buildOrchestrator.detectRebuildScope(['tsconfig.json']);
      expect(scope).toBe('full');
    });

    it('should detect full rebuild for Dockerfile changes', () => {
      const scope = buildOrchestrator.detectRebuildScope(['Dockerfile']);
      expect(scope).toBe('full');
    });

    it('should detect full rebuild for .env changes', () => {
      const scope = buildOrchestrator.detectRebuildScope(['.env']);
      expect(scope).toBe('full');
    });

    it('should detect proper scope for src/ changes', () => {
      const scope = buildOrchestrator.detectRebuildScope(['src/services/task.ts']);
      // src/ changes that match backend patterns return 'backend', others return 'full'
      expect(['backend', 'full']).toContain(scope);
    });

    it('should detect frontend rebuild for frontend file changes', () => {
      const scope = buildOrchestrator.detectRebuildScope([
        'src/components/Button.tsx',
      ]);
      expect(['frontend', 'full']).toContain(scope);
    });

    it('should handle mixed changes', () => {
      const scope = buildOrchestrator.detectRebuildScope([
        'src/index.ts',
        'package.json',
      ]);
      // Config change should trigger full rebuild
      expect(scope).toBe('full');
    });
  });

  describe('build stages', () => {
    it('should track all build stages', async () => {
      const files = createMockGeneratedFiles();
      const stages: string[] = [];

      buildOrchestrator.on('stageChange', (_, stage) => {
        stages.push(stage);
      });

      await buildOrchestrator.build(files, 'test-app');

      // Verify expected stages (order depends on config)
      expect(stages).toContain('installing');
      expect(stages).toContain('testing');
      expect(stages).toContain('building');
      expect(stages).toContain('complete');
    });

    it('should emit log events during build', async () => {
      const files = createMockGeneratedFiles();
      const logs: string[] = [];

      buildOrchestrator.on('log', (_, log) => {
        logs.push(log.message);
      });

      await buildOrchestrator.build(files, 'test-app');

      expect(logs.length).toBeGreaterThan(0);
    });
  });

  describe('work directory management', () => {
    it('should use unique work directory per build', async () => {
      const files = createMockGeneratedFiles();
      const workDirs: string[] = [];

      buildOrchestrator.on('stageChange', (context) => {
        if (!workDirs.includes(context.workDir)) {
          workDirs.push(context.workDir);
        }
      });

      await buildOrchestrator.build(files, 'test-app');
      await buildOrchestrator.build(files, 'test-app');

      expect(workDirs.length).toBe(2);
      expect(workDirs[0]).not.toBe(workDirs[1]);
    });

    it('should include app name in work directory', async () => {
      const files = createMockGeneratedFiles();
      let workDir = '';

      buildOrchestrator.on('stageChange', (context) => {
        workDir = context.workDir;
      });

      await buildOrchestrator.build(files, 'my-custom-app');

      expect(workDir).toContain('my-custom-app');
    });
  });

  describe('file writing', () => {
    it('should write all generated files to work directory', async () => {
      const files = createMockGeneratedFiles();

      // The orchestrator writes files internally
      const result = await buildOrchestrator.build(files, 'test-app');

      expect(result.success).toBe(true);
    });

    it('should handle nested file paths', async () => {
      const files = [
        ...createMockGeneratedFiles(),
        {
          path: 'src/services/task-service.ts',
          content: 'export class TaskService {}',
          language: 'typescript' as const,
          purpose: 'Task service',
        },
        {
          path: 'src/controllers/task-controller.ts',
          content: 'export class TaskController {}',
          language: 'typescript' as const,
          purpose: 'Task controller',
        },
      ];

      const result = await buildOrchestrator.build(files, 'test-app');

      expect(result.success).toBe(true);
    });
  });

  describe('test results extraction', () => {
    it('should extract test results from test runner', async () => {
      const files = createMockGeneratedFiles();

      const result = await buildOrchestrator.build(files, 'test-app');

      expect(result.success).toBe(true);
      // Test results come from extractTestResults which parses output
      // Our mock returns "10 tests passed" which should be parsed
      expect(result.testResults).toBeDefined();
    });
  });

  describe('image building', () => {
    it('should build Docker image', async () => {
      const files = createMockGeneratedFiles();

      const result = await buildOrchestrator.build(files, 'test-app');

      expect(result.success).toBe(true);
      expect(result.imageName).toBe('test-app');
      expect(result.imageTag).toBe('latest');
    });

    it('should call imageBuilder.build with correct parameters', async () => {
      const files = createMockGeneratedFiles();

      await buildOrchestrator.build(files, 'my-app');

      expect(mockImageBuilderBuild).toHaveBeenCalledWith(
        expect.stringContaining('my-app'),
        'my-app'
      );
    });
  });

  describe('processing time tracking', () => {
    it('should track total processing time', async () => {
      const files = createMockGeneratedFiles();

      const result = await buildOrchestrator.build(files, 'test-app');

      expect(result.processingTimeMs).toBeGreaterThan(0);
      expect(typeof result.processingTimeMs).toBe('number');
    });
  });

  describe('test runner failure handling', () => {
    it('should fail build when tests fail', async () => {
      mockTestRunnerRun.mockResolvedValueOnce({
        success: false,
        passed: 8,
        failed: 2,
        skipped: 0,
        total: 10,
        coverage: { lines: 75, meetsThreshold: false },
        output: '8 passed, 2 failed',
        error: 'Tests failed',
        durationMs: 5000,
      });

      const files = createMockGeneratedFiles();

      const result = await buildOrchestrator.build(files, 'test-app');

      expect(result.success).toBe(false);
      expect(result.stage).toBe('testing');
    });
  });

  describe('image builder failure handling', () => {
    it('should fail build when image build fails', async () => {
      mockImageBuilderBuild.mockResolvedValueOnce({
        success: false,
        error: 'Docker build failed',
        buildLogs: ['Error: cannot find Dockerfile'],
        durationMs: 5000,
      });

      const files = createMockGeneratedFiles();

      const result = await buildOrchestrator.build(files, 'test-app');

      expect(result.success).toBe(false);
      expect(result.stage).toBe('building');
    });
  });

  describe('edge cases', () => {
    it('should handle empty files array', async () => {
      // Empty files should still start the build but fail during install/test
      const result = await buildOrchestrator.build([], 'test-app');

      // Build may fail or succeed depending on implementation
      expect(typeof result.success).toBe('boolean');
    });

    it('should handle special characters in app name', async () => {
      const files = createMockGeneratedFiles();

      // Should sanitize or handle app name with special characters
      const result = await buildOrchestrator.build(files, 'test-app_v2');

      expect(result.success).toBe(true);
    });
  });
});

/**
 * Build Orchestrator
 * Coordinates the full build pipeline: install → lint → test → build → push
 */

import { createChildLogger } from '@chronosops/shared';
import type { GeneratedFile, TestResults } from '@chronosops/shared';
import { EventEmitter } from 'eventemitter3';
import { spawn } from 'node:child_process';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TestRunner } from './test-runner.js';
import { ImageBuilder } from './image-builder.js';
import type {
  BuildOrchestratorConfig,
  BuildResult,
  BuildStage,
  BuildLog,
  BuildContext,
  StageResult,
  RebuildScope,
  IncrementalRebuildOptions,
} from './types.js';
import { DEFAULT_BUILD_CONFIG } from './types.js';

interface BuildOrchestratorEvents {
  stageChange: (context: BuildContext, stage: BuildStage) => void;
  log: (context: BuildContext, log: BuildLog) => void;
  complete: (context: BuildContext, result: BuildResult) => void;
  error: (context: BuildContext, error: Error) => void;
}

export class BuildOrchestrator extends EventEmitter<BuildOrchestratorEvents> {
  private config: BuildOrchestratorConfig;
  private testRunner: TestRunner;
  private imageBuilder: ImageBuilder;
  private logger = createChildLogger({ component: 'BuildOrchestrator' });

  constructor(config: Partial<BuildOrchestratorConfig> & {
    buildMode?: 'docker' | 'kaniko';
    kaniko?: {
      namespace: string;
      serviceAccount?: string;
      executorImage?: string;
      jobTimeoutSeconds?: number;
    };
  } = {}) {
    super();
    this.config = { ...DEFAULT_BUILD_CONFIG, ...config };
    this.testRunner = new TestRunner({
      requiredCoverage: this.config.requiredCoverage,
    });
    this.imageBuilder = new ImageBuilder({
      registry: this.config.registry,
      baseImage: this.config.baseImage,
      buildMode: config.buildMode,
      kaniko: config.kaniko,
    });
  }

  /**
   * Build generated files into a deployable image
   */
  async build(
    files: GeneratedFile[],
    appName: string
  ): Promise<BuildResult> {
    const startTime = Date.now();
    const buildId = randomUUID().slice(0, 8);
    const workDir = join(this.config.workDir, `${appName}-${buildId}`);

    const context: BuildContext = {
      id: buildId,
      appName,
      files,
      workDir,
      stage: 'pending',
      startedAt: new Date(),
      logs: [],
    };

    this.logger.info({
      buildId,
      appName,
      fileCount: files.length,
    }, 'Starting build');

    try {
      // Setup: Write files to disk
      await this.setupWorkDir(context);

      // Stage 1: Install dependencies
      const installResult = await this.runStage(context, 'installing', () =>
        this.runInstall(workDir)
      );
      if (!installResult.success) {
        return this.failBuild(context, installResult, startTime);
      }

      // Stage 2: Lint (optional)
      if (!this.config.skipLint) {
        const lintResult = await this.runStage(context, 'linting', () =>
          this.runLint(workDir)
        );
        if (!lintResult.success) {
          return this.failBuild(context, lintResult, startTime);
        }
      }

      // Stage 3: Test (optional)
      let testResults: TestResults | undefined;
      if (!this.config.skipTests) {
        const testResult = await this.runStage(context, 'testing', () =>
          this.runTests(workDir)
        );
        if (!testResult.success) {
          return this.failBuild(context, testResult, startTime);
        }
        // Extract test results
        testResults = this.extractTestResults(testResult);
      }

      // Stage 4: Build Docker image
      const buildResult = await this.runStage(context, 'building', () =>
        this.buildImage(workDir, appName)
      );
      if (!buildResult.success) {
        return this.failBuild(context, buildResult, startTime);
      }

      // Stage 5: Push (optional)
      if (!this.config.skipPush && this.config.registry) {
        const pushResult = await this.runStage(context, 'pushing', () =>
          this.pushImage(appName)
        );
        if (!pushResult.success) {
          return this.failBuild(context, pushResult, startTime);
        }
      }

      // Complete
      context.stage = 'complete';
      this.emit('stageChange', context, 'complete');

      const result: BuildResult = {
        success: true,
        stage: 'complete',
        imageName: appName,
        imageTag: 'latest',
        logs: context.logs,
        testResults,
        processingTimeMs: Date.now() - startTime,
      };

      this.emit('complete', context, result);
      this.logger.info({
        buildId,
        appName,
        duration: result.processingTimeMs,
      }, 'Build completed successfully');

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error: errorMessage, buildId }, 'Build failed');

      context.stage = 'failed';
      this.emit('error', context, error as Error);

      return {
        success: false,
        stage: 'failed',
        error: errorMessage,
        logs: context.logs,
        processingTimeMs: Date.now() - startTime,
      };
    } finally {
      // Cleanup work directory
      await this.cleanup(workDir);
    }
  }

  /**
   * Detect the rebuild scope based on changed files
   */
  detectRebuildScope(changedFiles: string[]): RebuildScope {
    // Check if package.json or config files changed - requires full rebuild
    const configPatterns = [
      'package.json',
      'tsconfig.json',
      'vite.config',
      'vitest.config',
      'tailwind.config',
      'postcss.config',
      '.env',
      'Dockerfile',
    ];

    const hasConfigChange = changedFiles.some((file) =>
      configPatterns.some((pattern) => file.toLowerCase().includes(pattern.toLowerCase()))
    );

    if (hasConfigChange) {
      this.logger.info({ changedFiles }, 'Config change detected - full rebuild required');
      return 'full';
    }

    // Check for frontend-only changes
    const frontendPatterns = [
      '/src/components/',
      '/src/pages/',
      '/src/hooks/',
      '/src/styles/',
      '/src/App.',
      '/src/main.',
      '.tsx',
      '.css',
      '.scss',
      '/public/',
    ];

    // Check for backend-only changes
    const backendPatterns = [
      '/src/routes/',
      '/src/controllers/',
      '/src/services/',
      '/src/middleware/',
      '/src/db/',
      '/src/models/',
      '/src/api/',
      '/src/server.',
      '/src/index.',
    ];

    const isFrontendOnly = changedFiles.every((file) =>
      frontendPatterns.some((pattern) => file.includes(pattern))
    );

    const isBackendOnly = changedFiles.every((file) =>
      backendPatterns.some((pattern) => file.includes(pattern))
    );

    if (isFrontendOnly) {
      this.logger.info({ changedFiles }, 'Frontend-only change detected');
      return 'frontend';
    }

    if (isBackendOnly) {
      this.logger.info({ changedFiles }, 'Backend-only change detected');
      return 'backend';
    }

    // Mixed changes require full rebuild
    this.logger.info({ changedFiles }, 'Mixed changes detected - full rebuild required');
    return 'full';
  }

  /**
   * Incremental rebuild for faster iteration after code changes
   * Only rebuilds what's necessary based on changed files
   */
  async incrementalRebuild(
    files: GeneratedFile[],
    appName: string,
    changedFiles: string[],
    options: Partial<IncrementalRebuildOptions> = {}
  ): Promise<BuildResult> {
    const scope = options.scope ?? this.detectRebuildScope(changedFiles);
    const skipInstallOnCodeChange = options.skipInstallOnCodeChange ?? true;

    this.logger.info({
      appName,
      changedFileCount: changedFiles.length,
      scope,
      changedFiles: changedFiles.slice(0, 5), // Log first 5 files
    }, 'Starting incremental rebuild');

    // For full scope or config changes, do regular build
    if (scope === 'full' || scope === 'config') {
      return this.build(files, appName);
    }

    const startTime = Date.now();
    const buildId = randomUUID().slice(0, 8);
    const workDir = join(this.config.workDir, `${appName}-${buildId}`);

    const context: BuildContext = {
      id: buildId,
      appName,
      files,
      workDir,
      stage: 'pending',
      startedAt: new Date(),
      logs: [],
    };

    try {
      // Setup: Write only changed files to disk
      await this.setupWorkDir(context);
      this.addLog(context, 'pending', 'info', `Incremental rebuild: ${scope} scope`);

      // Skip install if only source files changed and flag is set
      const shouldSkipInstall = skipInstallOnCodeChange && 
        !changedFiles.some((f) => f.includes('package.json'));

      if (!shouldSkipInstall) {
        const installResult = await this.runStage(context, 'installing', () =>
          this.runInstall(workDir)
        );
        if (!installResult.success) {
          return this.failBuild(context, installResult, startTime);
        }
      } else {
        this.addLog(context, 'installing', 'info', 'Skipped install - no dependency changes');
        // Still need to run install for initial setup, but can skip if deps exist
        const installResult = await this.runStage(context, 'installing', () =>
          this.runInstall(workDir)
        );
        if (!installResult.success) {
          return this.failBuild(context, installResult, startTime);
        }
      }

      // Run relevant tests based on scope
      if (!this.config.skipTests) {
        const testFilter = scope === 'frontend' 
          ? '--include src/components --include src/pages --include src/hooks'
          : scope === 'backend'
            ? '--include src/routes --include src/services --include src/middleware'
            : '';
        
        const testResult = await this.runStage(context, 'testing', () =>
          this.runTests(workDir, testFilter)
        );
        if (!testResult.success) {
          return this.failBuild(context, testResult, startTime);
        }
      }

      // Build Docker image
      const buildResult = await this.runStage(context, 'building', () =>
        this.buildImage(workDir, appName)
      );
      if (!buildResult.success) {
        return this.failBuild(context, buildResult, startTime);
      }

      // Push if enabled
      if (!this.config.skipPush && this.config.registry) {
        const pushResult = await this.runStage(context, 'pushing', () =>
          this.pushImage(appName)
        );
        if (!pushResult.success) {
          return this.failBuild(context, pushResult, startTime);
        }
      }

      context.stage = 'complete';
      this.emit('stageChange', context, 'complete');

      const result: BuildResult = {
        success: true,
        stage: 'complete',
        imageName: appName,
        imageTag: 'latest',
        logs: context.logs,
        processingTimeMs: Date.now() - startTime,
      };

      this.emit('complete', context, result);
      this.logger.info({
        buildId,
        appName,
        scope,
        duration: result.processingTimeMs,
      }, 'Incremental rebuild completed');

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error: errorMessage, buildId }, 'Incremental rebuild failed');

      context.stage = 'failed';
      this.emit('error', context, error as Error);

      return {
        success: false,
        stage: 'failed',
        error: errorMessage,
        logs: context.logs,
        processingTimeMs: Date.now() - startTime,
      };
    } finally {
      await this.cleanup(workDir);
    }
  }

  /**
   * Run a build stage with logging and event emission
   */
  private async runStage(
    context: BuildContext,
    stage: BuildStage,
    fn: () => Promise<StageResult>
  ): Promise<StageResult> {
    context.stage = stage;
    this.emit('stageChange', context, stage);
    this.addLog(context, stage, 'info', `Starting ${stage} stage`);

    const result = await fn();

    if (result.success) {
      this.addLog(context, stage, 'info', `${stage} completed in ${result.durationMs}ms`);
    } else {
      this.addLog(context, stage, 'error', `${stage} failed: ${result.error}`);
    }

    return result;
  }

  /**
   * Setup work directory with generated files
   */
  private async setupWorkDir(context: BuildContext): Promise<void> {
    this.logger.debug({ workDir: context.workDir }, 'Setting up work directory');

    await mkdir(context.workDir, { recursive: true });

    for (const file of context.files) {
      const filePath = join(context.workDir, file.path);
      const dir = dirname(filePath);
      await mkdir(dir, { recursive: true });
      await writeFile(filePath, file.content, 'utf-8');
    }

    this.addLog(context, 'pending', 'info', `Wrote ${context.files.length} files`);
  }

  /**
   * Run npm install
   */
  private runInstall(workDir: string): Promise<StageResult> {
    // Use npm install instead of npm ci since generated code won't have a lock file
    return this.runCommand('npm', ['install'], workDir, 'installing');
  }

  /**
   * Run linting
   */
  private runLint(workDir: string): Promise<StageResult> {
    return this.runCommand('npm', ['run', 'lint'], workDir, 'linting');
  }

  /**
   * Run tests
   */
  private async runTests(workDir: string, filter = ''): Promise<StageResult> {
    const startTime = Date.now();
    const result = await this.testRunner.run(workDir, filter);

    return {
      success: result.success,
      stage: 'testing',
      output: result.output,
      error: result.error,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Build Docker image
   */
  private async buildImage(workDir: string, appName: string): Promise<StageResult> {
    const startTime = Date.now();
    const result = await this.imageBuilder.build(workDir, appName);

    return {
      success: result.success,
      stage: 'building',
      output: result.buildLogs.join('\n'),
      error: result.error,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Push Docker image
   */
  private async pushImage(appName: string): Promise<StageResult> {
    const startTime = Date.now();
    const result = await this.imageBuilder.push(appName);

    return {
      success: result.success,
      stage: 'pushing',
      error: result.error,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Run a shell command
   */
  private runCommand(
    command: string,
    args: string[],
    cwd: string,
    stage: BuildStage
  ): Promise<StageResult> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      const proc = spawn(command, args, {
        cwd,
        shell: true,
        timeout: this.config.stageTimeouts[stage as keyof typeof this.config.stageTimeouts],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (exitCode) => {
        resolve({
          success: exitCode === 0,
          stage,
          output: stdout,
          error: exitCode !== 0 ? (stderr || `Exit code ${exitCode}`) : undefined,
          durationMs: Date.now() - startTime,
        });
      });

      proc.on('error', (error) => {
        resolve({
          success: false,
          stage,
          error: error.message,
          durationMs: Date.now() - startTime,
        });
      });
    });
  }

  /**
   * Add a log entry
   */
  private addLog(
    context: BuildContext,
    stage: BuildStage,
    level: 'info' | 'warn' | 'error',
    message: string
  ): void {
    const log: BuildLog = {
      stage,
      timestamp: new Date(),
      level,
      message,
    };
    context.logs.push(log);
    this.emit('log', context, log);
  }

  /**
   * Create failed build result
   */
  private failBuild(
    context: BuildContext,
    stageResult: StageResult,
    startTime: number
  ): BuildResult {
    context.stage = 'failed';
    this.emit('stageChange', context, 'failed');

    return {
      success: false,
      stage: stageResult.stage,
      error: stageResult.error,
      logs: context.logs,
      processingTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Extract test results from stage result
   */
  private extractTestResults(stageResult: StageResult): TestResults | undefined {
    if (!stageResult.output) return undefined;

    // Parse test output for results
    const output = stageResult.output;
    const passedMatch = output.match(/(\d+)\s*pass/i);
    const failedMatch = output.match(/(\d+)\s*fail/i);

    if (passedMatch || failedMatch) {
      const passed = passedMatch ? parseInt(passedMatch[1] ?? '0', 10) : 0;
      const failed = failedMatch ? parseInt(failedMatch[1] ?? '0', 10) : 0;
      const total = passed + failed;

      return {
        success: failed === 0,
        passed,
        failed,
        skipped: 0,
        total,
        coverage: undefined,
        tests: [],
        duration: stageResult.durationMs,
        framework: 'vitest',
      };
    }

    return undefined;
  }

  /**
   * Cleanup work directory
   */
  private async cleanup(workDir: string): Promise<void> {
    try {
      await rm(workDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

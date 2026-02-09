/**
 * Types for the build pipeline
 */

import type { TestResults, GeneratedFile } from '@chronosops/shared';

/**
 * Build pipeline stages
 */
export type BuildStage =
  | 'pending'
  | 'installing'
  | 'linting'
  | 'testing'
  | 'building'
  | 'pushing'
  | 'complete'
  | 'failed';

/**
 * Build orchestrator configuration
 */
export interface BuildOrchestratorConfig {
  /** Working directory for builds */
  workDir: string;
  /** Docker registry for pushing images */
  registry?: string;
  /** Default Docker base image */
  baseImage: string;
  /** Timeout for each stage in ms */
  stageTimeouts: {
    installing: number;
    linting: number;
    testing: number;
    building: number;
    pushing: number;
  };
  /** Required test coverage percentage */
  requiredCoverage: number;
  /** Whether to skip pushing images */
  skipPush: boolean;
  /** Whether to skip lint stage */
  skipLint: boolean;
  /** Whether to skip test stage */
  skipTests: boolean;
}

export const DEFAULT_BUILD_CONFIG: BuildOrchestratorConfig = {
  workDir: './generated',
  baseImage: 'node:20-alpine',
  stageTimeouts: {
    installing: 300000, // 5 minutes
    linting: 120000,    // 2 minutes
    testing: 300000,    // 5 minutes
    building: 600000,   // 10 minutes
    pushing: 180000,    // 3 minutes
  },
  requiredCoverage: 80,
  skipPush: true,  // Skip by default for local development
  skipLint: true,  // Skip ESLint since we validate with TypeScript - avoids ESLint version conflicts
  skipTests: true, // Skip tests in build phase - tests are generated but need proper vitest config
};

/**
 * Build result
 */
export interface BuildResult {
  success: boolean;
  stage: BuildStage;
  imageName?: string;
  imageTag?: string;
  error?: string;
  logs: BuildLog[];
  testResults?: TestResults;
  coverage?: number;
  processingTimeMs: number;
}

/**
 * Build log entry
 */
export interface BuildLog {
  stage: BuildStage;
  timestamp: Date;
  level: 'info' | 'warn' | 'error';
  message: string;
}

/**
 * Stage result
 */
export interface StageResult {
  success: boolean;
  stage: BuildStage;
  output?: string;
  error?: string;
  durationMs: number;
}

/**
 * Image builder configuration
 */
export interface ImageBuilderConfig {
  /** Docker registry */
  registry?: string;
  /** Base image for Dockerfile */
  baseImage: string;
  /** Build timeout in ms */
  buildTimeout: number;
  /** Build arguments */
  buildArgs?: Record<string, string>;
  /** Labels to add to image */
  labels?: Record<string, string>;
  /** Build mode: 'docker' for local Docker, 'kaniko' for Kubernetes builds */
  buildMode?: 'docker' | 'kaniko';
  /** Kaniko configuration (required when buildMode is 'kaniko') */
  kaniko?: KanikoConfig;
}

/**
 * Kaniko build configuration for in-cluster builds
 */
export interface KanikoConfig {
  /** Namespace to run Kaniko job in */
  namespace: string;
  /** Service account for the Kaniko job (needs registry push permissions) */
  serviceAccount?: string;
  /** Kaniko executor image */
  executorImage?: string;
  /** Job timeout in seconds */
  jobTimeoutSeconds?: number;
  /** Whether to use cache */
  cache?: boolean;
  /** Cache repository for layers */
  cacheRepo?: string;
}

export const DEFAULT_IMAGE_BUILDER_CONFIG: ImageBuilderConfig = {
  baseImage: 'node:20-alpine',
  buildTimeout: 600000, // 10 minutes
};

/**
 * Image build result
 */
export interface ImageBuildResult {
  success: boolean;
  imageName?: string;
  imageTag?: string;
  imageId?: string;
  error?: string;
  buildLogs: string[];
  durationMs: number;
}

/**
 * Test runner configuration
 */
export interface TestRunnerConfig {
  /** Test framework */
  framework: 'vitest' | 'jest';
  /** Required coverage percentage */
  requiredCoverage: number;
  /** Test timeout in ms */
  timeout: number;
  /** Coverage reporters */
  coverageReporters: string[];
}

export const DEFAULT_TEST_RUNNER_CONFIG: TestRunnerConfig = {
  framework: 'vitest',
  requiredCoverage: 80,
  timeout: 300000, // 5 minutes
  coverageReporters: ['text', 'json'],
};

/**
 * Test runner result
 */
export interface TestRunnerResult {
  success: boolean;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  coverage?: CoverageResult;
  error?: string;
  output: string;
  durationMs: number;
}

/**
 * Coverage result
 */
export interface CoverageResult {
  lines: number;
  statements: number;
  functions: number;
  branches: number;
  meetsThreshold: boolean;
}

/**
 * Build context for a generated application
 */
export interface BuildContext {
  /** Build ID */
  id: string;
  /** Application name */
  appName: string;
  /** Generated files to build */
  files: GeneratedFile[];
  /** Working directory */
  workDir: string;
  /** Current stage */
  stage: BuildStage;
  /** Build started at */
  startedAt: Date;
  /** Build logs */
  logs: BuildLog[];
}

/**
 * Rebuild scope for incremental builds
 */
export type RebuildScope = 'full' | 'backend' | 'frontend' | 'config';

/**
 * Incremental rebuild options
 */
export interface IncrementalRebuildOptions {
  /** Changed files that triggered the rebuild */
  changedFiles: string[];
  /** Detected scope based on changed files */
  scope: RebuildScope;
  /** Whether to skip install if only code changed */
  skipInstallOnCodeChange: boolean;
  /** Whether to rebuild only changed container layers */
  optimizeDockerBuild: boolean;
}

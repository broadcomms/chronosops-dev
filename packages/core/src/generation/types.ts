/**
 * Types for code generation pipeline
 */

import type {
  AnalyzedRequirement,
  ArchitectureDesign,
  GeneratedCode,
  GeneratedFile,
  CodeValidationResult,
  TestResults,
} from '@chronosops/shared';

// Re-export types from shared for convenience
export type { GeneratedFile, GeneratedCode, AnalyzedRequirement, ArchitectureDesign };

/**
 * Storage mode for generated APIs
 * - 'memory': In-memory Map storage (default, no persistence)
 * - 'sqlite': SQLite database with PVC (single replica only)
 * - 'postgres': PostgreSQL database (supports multi-replica scaling)
 */
export type StorageMode = 'memory' | 'sqlite' | 'postgres';

/**
 * Database persistence configuration for generated APIs
 */
export interface PersistenceConfig {
  /** Whether persistence is enabled */
  enabled: boolean;
  /** Storage mode to use */
  storageMode: StorageMode;
  // SQLite options
  /** PVC storage size (e.g., '1Gi') - SQLite only */
  storageSize?: string;
  /** Mount path for data volume (e.g., '/app/data') - SQLite only */
  mountPath?: string;
  /** Storage class name for PVC - SQLite only */
  storageClassName?: string;
  // PostgreSQL options
  /** PostgreSQL host (e.g., 'chronosops-postgres.development.svc.cluster.local') */
  postgresHost?: string;
  /** PostgreSQL port (default: 5432) */
  postgresPort?: number;
  /** Database name (defaults to app name) */
  databaseName?: string;
}

/**
 * Default persistence configuration
 */
export const DEFAULT_PERSISTENCE_CONFIG: PersistenceConfig = {
  enabled: false,
  storageMode: 'memory',
  storageSize: '1Gi',
  mountPath: '/app/data',
  postgresHost: 'chronosops-postgres.database.svc.cluster.local',
  postgresPort: 5432,
};

/**
 * Configuration for the code generation pipeline
 */
export interface CodeGenerationConfig {
  /** Maximum retries for code validation fixes */
  maxFixRetries: number;
  /** Required test coverage percentage */
  requiredCoverage: number;
  /** Test framework to use */
  testFramework: 'vitest' | 'jest';
  /** Output directory for generated files */
  outputDir: string;
  /** Project name for generated code */
  projectName: string;
  /** Enable TypeScript strict mode */
  strictMode: boolean;
  /** Enable fault injection endpoints (/bugs/*) in generated apps for testing */
  enableFaultInjection: boolean;
  /** Storage mode for data persistence */
  storageMode: StorageMode;
  /** Persistence configuration */
  persistence?: PersistenceConfig;
}

export const DEFAULT_CODE_GENERATION_CONFIG: CodeGenerationConfig = {
  maxFixRetries: 3,
  requiredCoverage: 80,
  testFramework: 'vitest',
  outputDir: './generated',
  projectName: 'generated-app',
  strictMode: true,
  enableFaultInjection: false,
  storageMode: 'memory',
  persistence: DEFAULT_PERSISTENCE_CONFIG,
};

/**
 * Time budget for code fix operations
 * Used to prevent fix loops from consuming entire phase timeouts
 */
export interface TimeBudget {
  /** When the phase/operation started (Date.now()) */
  startTime: number;
  /** Total timeout for the phase in milliseconds */
  timeoutMs: number;
}

/**
 * Minimum time required to attempt a code fix iteration
 * Based on observed times: ~60-140 seconds per file
 */
export const MIN_TIME_FOR_FIX_ITERATION_MS = 140000; // 140 seconds

/**
 * Result of requirement analysis
 */
export interface RequirementAnalysisResult {
  success: boolean;
  requirement?: AnalyzedRequirement;
  error?: string;
  rawInput: string;
  processingTimeMs: number;
  /** AI reasoning signature for continuity across tasks */
  thoughtSignature?: string;
  /** Full AI thinking content for UI display */
  thoughtContent?: string;
}

/**
 * Result of architecture design
 */
export interface ArchitectureDesignResult {
  success: boolean;
  design?: ArchitectureDesign;
  error?: string;
  requirement: AnalyzedRequirement;
  processingTimeMs: number;
}

/**
 * Result of code generation
 */
export interface CodeGenerationResult {
  success: boolean;
  code?: GeneratedCode;
  error?: string;
  design: ArchitectureDesign;
  processingTimeMs: number;
  /** AI reasoning signature for continuity across tasks */
  thoughtSignature?: string;
}

/**
 * Result of code validation
 */
export interface CodeValidationPipelineResult {
  success: boolean;
  isValid: boolean;
  validationResult: CodeValidationResult;
  files: GeneratedFile[];
  processingTimeMs: number;
}

/**
 * Result of code fix attempt
 */
export interface CodeFixResult {
  success: boolean;
  fixedFiles?: GeneratedFile[];
  error?: string;
  iteration: number;
  processingTimeMs: number;
}

/**
 * Result of test generation
 */
export interface TestGenerationResult {
  success: boolean;
  tests?: GeneratedFile[];
  error?: string;
  coverage?: number;
  processingTimeMs: number;
}

/**
 * Result of test execution
 */
export interface TestExecutionResult {
  success: boolean;
  results?: TestResults;
  error?: string;
  processingTimeMs: number;
}

/**
 * Result of manifest generation
 */
export interface ManifestGenerationResult {
  success: boolean;
  manifests?: GeneratedFile[];
  error?: string;
  processingTimeMs: number;
}

/**
 * K8s manifest types
 */
export type ManifestType = 'deployment' | 'service' | 'configmap' | 'secret' | 'ingress';

/**
 * Prometheus monitoring configuration for generated apps
 */
export interface PrometheusConfig {
  /** Enable Prometheus scraping (default: true) */
  enabled: boolean;
  /** Metrics endpoint path (default: /metrics) */
  path: string;
  /** Metrics endpoint port (default: same as healthCheck port) */
  port: number;
}

/**
 * Manifest generation options
 */
export interface ManifestGenerationOptions {
  namespace: string;
  replicas: number;
  resources: {
    cpu: string;
    memory: string;
  };
  healthCheck: {
    path: string;
    port: number;
    initialDelaySeconds: number;
    periodSeconds: number;
  };
  environment?: Record<string, string>;
  secrets?: string[];
  exposedPorts?: number[];
  ingressHost?: string;
  /** Prometheus monitoring configuration for auto-discovery */
  prometheus?: PrometheusConfig;
  /** Database persistence configuration */
  persistence?: PersistenceConfig;
}

/**
 * File write operation result
 */
export interface FileWriteResult {
  success: boolean;
  path: string;
  error?: string;
}

/**
 * Batch file write result
 */
export interface BatchFileWriteResult {
  success: boolean;
  written: string[];
  failed: Array<{ path: string; error: string }>;
  totalFiles: number;
}

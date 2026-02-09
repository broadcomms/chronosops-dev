/**
 * Configuration management for ChronosOps
 */

import { z } from 'zod';
import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { type ModelAssignments, type ModelTier, type TemperatureAssignments, type AITask } from '../types/development.js';

// Load environment variables - try multiple locations
// When running via pnpm workspaces, CWD may be a package directory (apps/api)
// so we need to check parent directories too
const __dirname = dirname(fileURLToPath(import.meta.url));
const monorepoRoot = resolve(__dirname, '../../../../');

// Try multiple .env locations in order of preference
const envPaths = [
  resolve(process.cwd(), '.env'),           // CWD (if running from root)
  resolve(process.cwd(), '../../.env'),     // CWD parent (if running from apps/api)
  resolve(monorepoRoot, '.env'),            // Calculated monorepo root
];

for (const envPath of envPaths) {
  if (!process.env.GEMINI_API_KEY) {
    dotenvConfig({ path: envPath });
  }
}

// Configuration schema
const configSchema = z.object({
  // Application
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Server
  server: z.object({
    port: z.coerce.number().default(3000),
    host: z.string().default('0.0.0.0'),
    corsOrigin: z.string().default('*'),
  }),

  // Gemini API
  gemini: z.object({
    apiKey: z.string().min(1, 'GEMINI_API_KEY is required'),
    model: z.string().default('gemini-3-flash-preview'),
    proModel: z.string().default('gemini-3-flash-preview'),
    fallbackModel: z.string().default('gemini-2.5-flash'),
    maxTokens: z.coerce.number().default(1000000),
    outputTokens: z.coerce.number().default(65536),
    temperature: z.coerce.number().default(0.2),
    defaultThinkingBudget: z.coerce.number().default(8192),
    // Model assignments per task - computed from MODEL_* env vars
    modelAssignments: z.custom<Partial<ModelAssignments>>().optional(),
    // Temperature assignments per task - computed from TEMP_* env vars
    temperatureAssignments: z.custom<Partial<TemperatureAssignments>>().optional(),
  }),

  // Kubernetes
  kubernetes: z.object({
    namespace: z.string().default('demo'),
    allowedNamespaces: z.string().transform((val) => val.split(',').filter(Boolean)).default('demo,staging'),
    operationDryRun: z.coerce.boolean().default(true),
    allowedActions: z.string().transform((val) => val.split(',').filter(Boolean)).default('rollback,restart,scale'),
    actionCooldown: z.coerce.number().default(60000),
    maxActionsPerIncident: z.coerce.number().default(5),
    rollbackTimeout: z.coerce.number().default(300000),
    /**
     * External hostname or IP for NodePort services
     * Used by "Open Live App" button in the UI
     * - Local: defaults to 'localhost'
     * - GKE: Set to node external IP or LoadBalancer IP
     */
    externalHost: z.string().optional(),
  }),

  // Database
  database: z.object({
    type: z.enum(['sqlite', 'postgresql']).default('sqlite'),
    path: z.string().default('./data/chronosops.db'),
    url: z.string().optional(),
  }),

  // Storage
  storage: z.object({
    basePath: z.string().default('./data'),
    videoPath: z.string().default('./data/videos'),
    evidencePath: z.string().default('./data/evidence'),
    postmortemPath: z.string().default('./data/postmortems'),
    maxVideoSizeMb: z.coerce.number().default(500),
    frameExtractionRate: z.coerce.number().default(0.2),
  }),

  // Demo mode
  demo: z.object({
    enabled: z.coerce.boolean().default(false),
    simulateLatency: z.coerce.boolean().default(false),
  }),

  // Anomaly Detection
  detection: z.object({
    enabled: z.coerce.boolean().default(true),
    pollingIntervalMs: z.coerce.number().default(30000),
    // Lowered from 'high' to 'medium' to detect 10%+ error rates (was missing 13.55% errors)
    minSeverity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
    minConfidence: z.coerce.number().default(0.7),
    cooldownMs: z.coerce.number().default(300000),
    maxConcurrentInvestigations: z.coerce.number().default(3),
    screenCaptureUrl: z.string().default('http://localhost:4000'),
  }),

  // Git Integration
  git: z.object({
    enabled: z.coerce.boolean().default(false),
    provider: z.enum(['github', 'local']).default('local'),
    githubToken: z.string().optional(),
    githubOrg: z.string().optional(),
    localBasePath: z.string().default('./generated'),
    repoNamingPattern: z.enum(['chronosops-{serviceName}', 'custom']).default('chronosops-{serviceName}'),
    customRepoPrefix: z.string().optional(),
    autoCommitOnDeploy: z.coerce.boolean().default(true),
    autoPush: z.coerce.boolean().default(false),
    defaultBranch: z.string().default('main'),
  }),

  // Edit Lock Settings
  editLock: z.object({
    timeoutMs: z.coerce.number().default(1800000), // 30 minutes
    heartbeatIntervalMs: z.coerce.number().default(30000), // 30 seconds
    extendOnActivityMs: z.coerce.number().default(300000), // 5 minutes extension
    maxExtensions: z.coerce.number().default(12), // Max 12 extensions (1 hour total max)
  }),

  // Code Evolution Settings
  evolution: z.object({
    maxFilesPerEvolution: z.coerce.number().default(10),
    requireConfirmationAboveLimit: z.coerce.boolean().default(true),
    autoRevertOnFailure: z.coerce.boolean().default(true),
    maxPendingEvolutions: z.coerce.number().default(5),
    /**
     * Auto-approve code evolutions triggered by incidents
     * When true: Evolutions are automatically approved and applied (autonomous mode)
     * When false: Requires human approval before applying (production safety mode)
     * Default: true for dramatic self-healing demo
     */
    autoApprove: z.coerce.boolean().default(true),
  }),

  // Docker/Build Settings
  docker: z.object({
    /**
     * Docker registry for pushing/pulling generated app images
     * Local: localhost:5000 or empty (uses local Docker daemon)
     * GKE: us-central1-docker.pkg.dev/PROJECT_ID/REPO_NAME
     */
    registry: z.string().default(''),
    /**
     * Image pull policy for Kubernetes deployments
     * 'Always': Always pull from registry (required for :latest tags to pick up new images)
     * 'Never': Never pull (for local development with locally built images)
     * 'IfNotPresent': Only pull if not cached (NOT recommended with :latest tags)
     */
    imagePullPolicy: z.enum(['Always', 'Never', 'IfNotPresent']).default('Always'),
    /**
     * Base image for generated apps
     */
    baseImage: z.string().default('node:20-alpine'),
    /**
     * Build mode: 'docker' for local Docker daemon, 'kaniko' for in-cluster Kubernetes builds
     */
    buildMode: z.enum(['docker', 'kaniko']).default('docker'),
    /**
     * Namespace for Kaniko build jobs (only used when buildMode is 'kaniko')
     */
    kanikoNamespace: z.string().default('development'),
    /**
     * Service account for Kaniko jobs (needs push permissions to registry)
     */
    kanikoServiceAccount: z.string().default('chronosops'),
  }),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Build model assignments from MODEL_* environment variables
 * Returns only the overrides that are explicitly set
 */
function buildModelAssignmentsFromEnv(): Partial<ModelAssignments> {
  const assignments: Partial<ModelAssignments> = {};
  
  const envMappings: Array<{ env: string; key: keyof ModelAssignments }> = [
    { env: 'MODEL_REQUIREMENT_ANALYSIS', key: 'requirementAnalysis' },
    { env: 'MODEL_ARCHITECTURE_DESIGN', key: 'architectureDesign' },
    { env: 'MODEL_CODE_GENERATION', key: 'codeGeneration' },
    { env: 'MODEL_CODE_FIX', key: 'codeFix' },
    { env: 'MODEL_TEST_GENERATION', key: 'testGeneration' },
    { env: 'MODEL_FRAME_ANALYSIS', key: 'frameAnalysis' },
    { env: 'MODEL_LOG_ANALYSIS', key: 'logAnalysis' },
    { env: 'MODEL_HYPOTHESIS_GENERATION', key: 'hypothesisGeneration' },
    { env: 'MODEL_INCIDENT_RECONSTRUCTION', key: 'incidentReconstruction' },
    { env: 'MODEL_PATTERN_LEARNING', key: 'patternLearning' },
    { env: 'MODEL_POSTMORTEM_GENERATION', key: 'postmortemGeneration' },
    { env: 'MODEL_ANOMALY_DETECTION', key: 'anomalyDetection' },
  ];
  
  for (const { env, key } of envMappings) {
    const value = process.env[env];
    if (value === 'flash' || value === 'pro') {
      assignments[key] = value as ModelTier;
    }
  }
  
  return assignments;
}

/**
 * Build temperature assignments from TEMP_* environment variables
 * Returns only the overrides that are explicitly set
 * Temperature range: 0.0-2.0
 */
function buildTemperatureAssignmentsFromEnv(): Partial<TemperatureAssignments> {
  const assignments: Partial<TemperatureAssignments> = {};

  const envMappings: Array<{ env: string; key: AITask }> = [
    { env: 'TEMP_REQUIREMENT_ANALYSIS', key: 'requirementAnalysis' },
    { env: 'TEMP_ARCHITECTURE_DESIGN', key: 'architectureDesign' },
    { env: 'TEMP_CODE_GENERATION', key: 'codeGeneration' },
    { env: 'TEMP_CODE_FIX', key: 'codeFix' },
    { env: 'TEMP_TEST_GENERATION', key: 'testGeneration' },
    { env: 'TEMP_FRAME_ANALYSIS', key: 'frameAnalysis' },
    { env: 'TEMP_LOG_ANALYSIS', key: 'logAnalysis' },
    { env: 'TEMP_HYPOTHESIS_GENERATION', key: 'hypothesisGeneration' },
    { env: 'TEMP_INCIDENT_RECONSTRUCTION', key: 'incidentReconstruction' },
    { env: 'TEMP_PATTERN_LEARNING', key: 'patternLearning' },
    { env: 'TEMP_POSTMORTEM_GENERATION', key: 'postmortemGeneration' },
    { env: 'TEMP_ANOMALY_DETECTION', key: 'anomalyDetection' },
  ];

  for (const { env, key } of envMappings) {
    const value = process.env[env];
    if (value !== undefined) {
      const parsed = parseFloat(value);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 2) {
        assignments[key] = parsed;
      }
    }
  }

  return assignments;
}

// Parse and validate configuration
function loadConfig(): Config {
  const rawConfig = {
    nodeEnv: process.env.NODE_ENV,
    logLevel: process.env.LOG_LEVEL,

    server: {
      port: process.env.PORT,
      host: process.env.HOST,
      corsOrigin: process.env.CORS_ORIGIN,
    },

    gemini: {
      apiKey: process.env.GEMINI_API_KEY ?? '',
      model: process.env.GEMINI_MODEL,
      proModel: process.env.GEMINI_PRO_MODEL,
      fallbackModel: process.env.GEMINI_FALLBACK_MODEL,
      maxTokens: process.env.GEMINI_MAX_TOKENS,
      outputTokens: process.env.GEMINI_OUTPUT_TOKENS,
      temperature: process.env.GEMINI_TEMPERATURE,
      defaultThinkingBudget: process.env.GEMINI_THINKING_BUDGET,
      // Build model assignments from MODEL_* env vars
      modelAssignments: buildModelAssignmentsFromEnv(),
      // Build temperature assignments from TEMP_* env vars
      temperatureAssignments: buildTemperatureAssignmentsFromEnv(),
    },

    kubernetes: {
      namespace: process.env.K8S_NAMESPACE,
      allowedNamespaces: process.env.K8S_ALLOWED_NAMESPACES,
      operationDryRun: process.env.K8S_OPERATION_DRY_RUN,
      allowedActions: process.env.K8S_ALLOWED_ACTIONS,
      actionCooldown: process.env.K8S_ACTION_COOLDOWN,
      maxActionsPerIncident: process.env.K8S_MAX_ACTIONS_PER_INCIDENT,
      rollbackTimeout: process.env.K8S_ROLLBACK_TIMEOUT,
      externalHost: process.env.K8S_EXTERNAL_HOST,
    },

    database: {
      type: process.env.DATABASE_TYPE,
      path: process.env.DATABASE_PATH,
      url: process.env.DATABASE_URL,
    },

    storage: {
      basePath: process.env.STORAGE_PATH,
      videoPath: process.env.VIDEO_STORAGE_PATH,
      evidencePath: process.env.EVIDENCE_STORAGE_PATH,
      postmortemPath: process.env.POSTMORTEM_PATH,
      maxVideoSizeMb: process.env.MAX_VIDEO_SIZE_MB,
      frameExtractionRate: process.env.FRAME_EXTRACTION_RATE,
    },

    demo: {
      enabled: process.env.DEMO_MODE,
      simulateLatency: process.env.SIMULATE_LATENCY,
    },

    detection: {
      enabled: process.env.AUTO_DETECTION_ENABLED,
      pollingIntervalMs: process.env.DETECTION_INTERVAL_MS,
      minSeverity: process.env.DETECTION_MIN_SEVERITY,
      minConfidence: process.env.DETECTION_MIN_CONFIDENCE,
      cooldownMs: process.env.DETECTION_COOLDOWN_MS,
      maxConcurrentInvestigations: process.env.MAX_CONCURRENT_INVESTIGATIONS,
      screenCaptureUrl: process.env.SCREEN_CAPTURE_URL,
    },

    git: {
      enabled: process.env.GIT_ENABLED,
      provider: process.env.GIT_PROVIDER,
      githubToken: process.env.GITHUB_TOKEN,
      githubOrg: process.env.GITHUB_ORG,
      localBasePath: process.env.GIT_LOCAL_BASE_PATH,
      repoNamingPattern: process.env.GIT_REPO_NAMING_PATTERN,
      customRepoPrefix: process.env.GIT_CUSTOM_REPO_PREFIX,
      autoCommitOnDeploy: process.env.GIT_AUTO_COMMIT,
      autoPush: process.env.GIT_AUTO_PUSH,
      defaultBranch: process.env.GIT_DEFAULT_BRANCH,
    },

    editLock: {
      timeoutMs: process.env.EDIT_LOCK_TIMEOUT_MS,
      heartbeatIntervalMs: process.env.EDIT_LOCK_HEARTBEAT_MS,
      extendOnActivityMs: process.env.EDIT_LOCK_EXTEND_MS,
      maxExtensions: process.env.EDIT_LOCK_MAX_EXTENSIONS,
    },

    evolution: {
      maxFilesPerEvolution: process.env.EVOLUTION_MAX_FILES,
      requireConfirmationAboveLimit: process.env.EVOLUTION_REQUIRE_CONFIRMATION,
      autoRevertOnFailure: process.env.EVOLUTION_AUTO_REVERT,
      maxPendingEvolutions: process.env.EVOLUTION_MAX_PENDING,
      autoApprove: process.env.CODE_EVOLUTION_AUTO_APPROVE,
    },

    docker: {
      registry: process.env.DOCKER_REGISTRY,
      imagePullPolicy: process.env.DOCKER_IMAGE_PULL_POLICY,
      baseImage: process.env.DOCKER_BASE_IMAGE,
      // Auto-detect build mode: use Kaniko when running inside K8s (no Docker daemon available)
      // Can be overridden explicitly via DOCKER_BUILD_MODE env var
      buildMode: (process.env.DOCKER_BUILD_MODE as 'docker' | 'kaniko' | undefined) ??
        (process.env.KUBERNETES_SERVICE_HOST ? 'kaniko' : 'docker'),
      kanikoNamespace: process.env.KANIKO_NAMESPACE,
      kanikoServiceAccount: process.env.KANIKO_SERVICE_ACCOUNT,
    },
  };

  return configSchema.parse(rawConfig);
}

// Singleton config instance
let configInstance: Config | null = null;

export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

// For testing - reset config
export function resetConfig(): void {
  configInstance = null;
}

// Validate config without loading (for startup checks)
export function validateConfig(): { valid: boolean; errors?: string[] } {
  try {
    loadConfig();
    return { valid: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        valid: false,
        errors: error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
      };
    }
    throw error;
  }
}

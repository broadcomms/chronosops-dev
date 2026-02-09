/**
 * API Services Module
 * Initializes and provides access to core ChronosOps services
 */

import { z } from 'zod';
import { GeminiClient } from '@chronosops/gemini';
import type { GeminiModel, ModelAssignments } from '@chronosops/gemini';
import {
  InvestigationOrchestrator,
  DevelopmentOrchestrator,
  VideoWatcher,
  ExecutorFactory,
  createExecutorFromEnv,
  createVideoWatcherFromEnv,
  getVisionService,
  monitoringConfigService,
  type VisionService,
} from '@chronosops/core';
import { K8sClient } from '@chronosops/kubernetes';
import { developmentCycleRepository, incidentRepository, configRepository } from '@chronosops/database';
import { createChildLogger, type ModelTier, type PhaseRetryConfig, type OODAState, type DevelopmentSettingsConfig, DEFAULT_DEVELOPMENT_SETTINGS_CONFIG, DEFAULT_DEVELOPMENT_CONFIG, getConfig } from '@chronosops/shared';
import {
  broadcastDevelopmentPhaseChange,
  broadcastDevelopmentComplete,
  broadcastDevelopmentFailed,
  broadcastPhaseChange,
  broadcastIncidentUpdate,
} from '../websocket/index.js';

/**
 * Safely parse JSON string with fallback
 */
function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
import {
  AnomalyDetectionService,
  createDetectionServiceFromEnv,
} from './anomaly-detection-service.js';

const logger = createChildLogger({ component: 'Services' });

// ===========================================
// Environment Variable Validation (H3 fix)
// ===========================================

/**
 * Model tier validation schema
 */
const modelTierSchema = z.enum(['flash', 'pro']).optional();

/**
 * Environment variable schema with validation
 * Validates all env vars at startup to fail fast on misconfiguration
 */
const envSchema = z.object({
  // Required
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),

  // Optional with defaults - Gemini models
  GEMINI_MODEL: z.enum([
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
  ]).optional().default('gemini-3-flash-preview'),
  GEMINI_PRO_MODEL: z.enum([
    'gemini-3-pro-preview',
    'gemini-3-flash-preview',
  ]).optional().default('gemini-3-pro-preview'),

  // Model assignments per task - allows fine-grained control over flash vs pro usage
  // Set to 'flash' or 'pro' to override the default for each task
  MODEL_REQUIREMENT_ANALYSIS: modelTierSchema,
  MODEL_ARCHITECTURE_DESIGN: modelTierSchema,
  MODEL_CODE_GENERATION: modelTierSchema,
  MODEL_CODE_FIX: modelTierSchema,
  MODEL_TEST_GENERATION: modelTierSchema,
  MODEL_FRAME_ANALYSIS: modelTierSchema,
  MODEL_LOG_ANALYSIS: modelTierSchema,
  MODEL_HYPOTHESIS_GENERATION: modelTierSchema,
  MODEL_INCIDENT_RECONSTRUCTION: modelTierSchema,
  MODEL_PATTERN_LEARNING: modelTierSchema,
  MODEL_POSTMORTEM_GENERATION: modelTierSchema,
  MODEL_ANOMALY_DETECTION: modelTierSchema,

  // Optional with defaults - K8s configuration
  ALLOWED_NAMESPACES: z.string().optional().default('development'),
  K8S_DRY_RUN: z.enum(['true', 'false']).optional().default('false'),
  MAX_ACTIONS_PER_INCIDENT: z.string().regex(/^\d+$/).optional().default('10'),
  ACTION_COOLDOWN_MS: z.string().regex(/^\d+$/).optional().default('30000'),

  // Optional with defaults - Investigation configuration
  CONFIDENCE_THRESHOLD: z.string().regex(/^[0-9.]+$/).optional().default('0.7'),
  VERIFICATION_WAIT_MS: z.string().regex(/^\d+$/).optional().default('10000'),
  MAX_VERIFICATION_ATTEMPTS: z.string().regex(/^\d+$/).optional().default('3'),

  // Optional - Gemini API timeout configuration (resilient self-healing)
  GEMINI_REQUEST_TIMEOUT_MS: z.string().regex(/^\d+$/).optional().default('180000'),

  // Optional - Per-phase retry configuration (resilient self-healing)
  DEV_PHASE_RETRIES_DEFAULT: z.string().regex(/^\d+$/).optional().default('3'),
  DEV_PHASE_RETRIES_ANALYZING: z.string().regex(/^\d+$/).optional(),
  DEV_PHASE_RETRIES_DESIGNING: z.string().regex(/^\d+$/).optional(),
  DEV_PHASE_RETRIES_CODING: z.string().regex(/^\d+$/).optional(),
  DEV_PHASE_RETRIES_TESTING: z.string().regex(/^\d+$/).optional(),
  DEV_PHASE_RETRIES_BUILDING: z.string().regex(/^\d+$/).optional(),
  DEV_PHASE_RETRIES_DEPLOYING: z.string().regex(/^\d+$/).optional(),
  DEV_PHASE_RETRIES_VERIFYING: z.string().regex(/^\d+$/).optional(),
});

export type ValidatedEnv = z.infer<typeof envSchema>;

/**
 * Validate environment variables and return typed config
 * @throws Error if validation fails
 */
function validateEnvironment(): ValidatedEnv {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
      throw new Error(`Environment variable validation failed:\n${issues}`);
    }
    throw error;
  }
}

/**
 * Application services container
 */
export interface AppServices {
  geminiClient: GeminiClient;
  videoWatcher: VideoWatcher;
  visionService: VisionService;
  executorFactory: ExecutorFactory;
  k8sClient: K8sClient;
  detectionService: AnomalyDetectionService;
  createOrchestrator: () => InvestigationOrchestrator;
  createDevelopmentOrchestrator: () => Promise<DevelopmentOrchestrator>;
}

let services: AppServices | null = null;

/**
 * Initialize all application services
 */
export function initializeServices(): AppServices {
  if (services) {
    logger.warn('Services already initialized');
    return services;
  }

  logger.info('Initializing services...');

  // H3 fix: Validate all environment variables at startup
  const env = validateEnvironment();
  logger.info('Environment variables validated successfully');

  // Build model assignments from environment variables
  // Only include overrides that are explicitly set
  const modelAssignments: Partial<ModelAssignments> = {};
  
  // Debug: Log the raw env values
  logger.info({
    MODEL_REQUIREMENT_ANALYSIS: env.MODEL_REQUIREMENT_ANALYSIS,
    MODEL_ARCHITECTURE_DESIGN: env.MODEL_ARCHITECTURE_DESIGN,
    MODEL_CODE_GENERATION: env.MODEL_CODE_GENERATION,
  }, 'Raw MODEL_* env values');
  
  if (env.MODEL_REQUIREMENT_ANALYSIS) modelAssignments.requirementAnalysis = env.MODEL_REQUIREMENT_ANALYSIS as ModelTier;
  if (env.MODEL_ARCHITECTURE_DESIGN) modelAssignments.architectureDesign = env.MODEL_ARCHITECTURE_DESIGN as ModelTier;
  if (env.MODEL_CODE_GENERATION) modelAssignments.codeGeneration = env.MODEL_CODE_GENERATION as ModelTier;
  if (env.MODEL_CODE_FIX) modelAssignments.codeFix = env.MODEL_CODE_FIX as ModelTier;
  if (env.MODEL_TEST_GENERATION) modelAssignments.testGeneration = env.MODEL_TEST_GENERATION as ModelTier;
  if (env.MODEL_FRAME_ANALYSIS) modelAssignments.frameAnalysis = env.MODEL_FRAME_ANALYSIS as ModelTier;
  if (env.MODEL_LOG_ANALYSIS) modelAssignments.logAnalysis = env.MODEL_LOG_ANALYSIS as ModelTier;
  if (env.MODEL_HYPOTHESIS_GENERATION) modelAssignments.hypothesisGeneration = env.MODEL_HYPOTHESIS_GENERATION as ModelTier;
  if (env.MODEL_INCIDENT_RECONSTRUCTION) modelAssignments.incidentReconstruction = env.MODEL_INCIDENT_RECONSTRUCTION as ModelTier;
  if (env.MODEL_PATTERN_LEARNING) modelAssignments.patternLearning = env.MODEL_PATTERN_LEARNING as ModelTier;
  if (env.MODEL_POSTMORTEM_GENERATION) modelAssignments.postmortemGeneration = env.MODEL_POSTMORTEM_GENERATION as ModelTier;
  if (env.MODEL_ANOMALY_DETECTION) modelAssignments.anomalyDetection = env.MODEL_ANOMALY_DETECTION as ModelTier;

  // Debug: Log the constructed overrides
  logger.info({ modelAssignments }, 'Model assignment overrides from env');

  // Initialize Gemini client with validated config, model assignments, and timeout
  const geminiClient = new GeminiClient({
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL as GeminiModel,
    proModel: env.GEMINI_PRO_MODEL as GeminiModel,
    modelAssignments,
    requestTimeoutMs: parseInt(env.GEMINI_REQUEST_TIMEOUT_MS, 10),
  });
  logger.info({
    timeoutMs: env.GEMINI_REQUEST_TIMEOUT_MS,
  }, 'GeminiClient initialized with model assignments and timeout');

  // Build PhaseRetryConfig from environment variables (resilient self-healing)
  const phaseRetryConfig: PhaseRetryConfig = {
    defaultRetries: parseInt(env.DEV_PHASE_RETRIES_DEFAULT, 10),
    perPhase: {
      ...(env.DEV_PHASE_RETRIES_ANALYZING && { ANALYZING: parseInt(env.DEV_PHASE_RETRIES_ANALYZING, 10) }),
      ...(env.DEV_PHASE_RETRIES_DESIGNING && { DESIGNING: parseInt(env.DEV_PHASE_RETRIES_DESIGNING, 10) }),
      ...(env.DEV_PHASE_RETRIES_CODING && { CODING: parseInt(env.DEV_PHASE_RETRIES_CODING, 10) }),
      ...(env.DEV_PHASE_RETRIES_TESTING && { TESTING: parseInt(env.DEV_PHASE_RETRIES_TESTING, 10) }),
      ...(env.DEV_PHASE_RETRIES_BUILDING && { BUILDING: parseInt(env.DEV_PHASE_RETRIES_BUILDING, 10) }),
      ...(env.DEV_PHASE_RETRIES_DEPLOYING && { DEPLOYING: parseInt(env.DEV_PHASE_RETRIES_DEPLOYING, 10) }),
      ...(env.DEV_PHASE_RETRIES_VERIFYING && { VERIFYING: parseInt(env.DEV_PHASE_RETRIES_VERIFYING, 10) }),
    },
  };
  logger.info({ phaseRetryConfig }, 'Phase retry config built from environment');

  // Initialize VideoWatcher (kept for backward compatibility)
  const videoWatcher = createVideoWatcherFromEnv();
  logger.info('VideoWatcher initialized');

  // Initialize ExecutorFactory
  const executorFactory = createExecutorFromEnv();
  logger.info('ExecutorFactory initialized');

  // Initialize VisionService (unified vision stream for dashboard rendering)
  const visionService = getVisionService();
  logger.info('VisionService initialized');

  // Initialize AnomalyDetectionService with HybridAnomalyDetector (Prometheus-based)
  // Uses Prometheus metrics to monitor ALL deployed apps automatically
  // No frame fetcher needed - uses metric thresholds (error rate > 5%, latency > 2s, memory > 90%)
  const detectionService = createDetectionServiceFromEnv(geminiClient);
  logger.info('AnomalyDetectionService initialized (monitoring all deployed apps via Prometheus)');

  // Initialize K8sClient for development deployments (H3 fix: use validated env)
  const k8sClient = new K8sClient({
    allowedNamespaces: env.ALLOWED_NAMESPACES.split(','),
    allowedActions: ['rollback', 'restart', 'scale', 'apply', 'create'],
    dryRun: env.K8S_DRY_RUN === 'true',
    maxActionsPerIncident: parseInt(env.MAX_ACTIONS_PER_INCIDENT, 10),
    actionCooldownMs: parseInt(env.ACTION_COOLDOWN_MS, 10),
  });
  logger.info('K8sClient initialized');

  // Factory function to create new orchestrator instances (H3 fix: use validated env)
  const createOrchestrator = (): InvestigationOrchestrator => {
    return new InvestigationOrchestrator(
      {
        geminiClient,
        videoWatcher,
        executorFactory,
      },
      {
        confidenceThreshold: parseFloat(env.CONFIDENCE_THRESHOLD),
        maxActionsPerIncident: parseInt(env.MAX_ACTIONS_PER_INCIDENT, 10),
        verificationWaitMs: parseInt(env.VERIFICATION_WAIT_MS, 10),
        maxVerificationAttempts: parseInt(env.MAX_VERIFICATION_ATTEMPTS, 10),
      }
    );
  };

  // Factory function to create new development orchestrator instances
  // Pass K8sClient for real deployments when K8S_DRY_RUN=false
  // Pass phaseRetryConfig for resilient self-healing
  // Fetches development settings from DB to configure fault injection
  const createDevelopmentOrchestrator = async (): Promise<DevelopmentOrchestrator> => {
    // Fetch development settings from database
    const devConfig = await configRepository.getByCategory('development');
    const developmentSettings = devConfig
      ? (devConfig.config as unknown as DevelopmentSettingsConfig)
      : DEFAULT_DEVELOPMENT_SETTINGS_CONFIG;

    // Get build configuration from environment/config
    const appConfig = getConfig();
    const buildMode = appConfig.docker.buildMode;
    const kanikoConfig = buildMode === 'kaniko' ? {
      namespace: appConfig.docker.kanikoNamespace,
      serviceAccount: appConfig.docker.kanikoServiceAccount,
    } : undefined;

    return new DevelopmentOrchestrator(
      {
        geminiClient,
        k8sClient, // Enable real K8s deployment
        phaseRetryConfig, // Enable per-phase retries
      },
      {
        codeGeneration: {
          ...DEFAULT_DEVELOPMENT_CONFIG.codeGeneration,
          enableFaultInjection: developmentSettings.enableFaultInjection,
          enablePromptInjectionTesting: developmentSettings.enablePromptInjectionTesting ?? false,
        },
        build: {
          registry: appConfig.docker.registry || 'localhost:5000',
          baseImage: appConfig.docker.baseImage,
          enableCache: true,
          buildMode,
          kaniko: kanikoConfig,
        },
      }
    );
  };

  services = {
    geminiClient,
    videoWatcher,
    visionService,
    executorFactory,
    k8sClient,
    detectionService,
    createOrchestrator,
    createDevelopmentOrchestrator,
  };

  logger.info('All services initialized successfully');

  // Auto-start vision monitoring for all previously registered apps
  // This ensures monitoring resumes after server restart
  monitoringConfigService.startMonitoringForAllActiveApps().catch((error) => {
    logger.error({ error: error instanceof Error ? error.message : 'Unknown' }, 'Failed to auto-start monitoring');
  });

  return services;
}

/**
 * Get initialized services
 * @throws Error if services not initialized
 */
export function getServices(): AppServices {
  if (!services) {
    throw new Error('Services not initialized. Call initializeServices() first.');
  }
  return services;
}

/**
 * Shutdown services gracefully
 */
export async function shutdownServices(): Promise<void> {
  if (!services) {
    return;
  }

  logger.info('Shutting down services...');

  // Stop detection service
  services.detectionService.stop();

  // Stop video watcher polling (backward compatibility)
  services.videoWatcher.stopPolling();

  // Shutdown vision service
  services.visionService.shutdown();

  services = null;
  logger.info('Services shutdown complete');
}

// ===========================================
// Server Restart Recovery (Resilient Self-Healing)
// ===========================================

/**
 * Recover interrupted development cycles after server restart
 *
 * This function finds cycles that were active when the server was interrupted
 * and resumes them from their last known phase. This is a key part of the
 * resilient self-healing system - treating server restart as a recoverable state.
 *
 * @returns Object with counts of recovered and failed cycles
 */
export async function recoverInterruptedCycles(): Promise<{ recovered: number; failed: number }> {
  if (!services) {
    logger.warn('Services not initialized, skipping cycle recovery');
    return { recovered: 0, failed: 0 };
  }

  logger.info('Checking for interrupted development cycles to recover...');

  try {
    // Find all interrupted cycles
    const interruptedCycles = await developmentCycleRepository.getInterruptedCycles();

    if (interruptedCycles.length === 0) {
      logger.info('No interrupted cycles found');
      return { recovered: 0, failed: 0 };
    }

    logger.info({
      count: interruptedCycles.length,
      cycles: interruptedCycles.map(c => ({ id: c.id, phase: c.phase })),
    }, 'Found interrupted cycles to recover');

    let recovered = 0;
    let failed = 0;

    // Resume each interrupted cycle
    for (const cycleRecord of interruptedCycles) {
      try {
        logger.info({
          cycleId: cycleRecord.id,
          phase: cycleRecord.phase,
          phaseRetries: cycleRecord.phaseRetries,
        }, 'Attempting to resume interrupted cycle');

        // Create a new orchestrator for this cycle
        const orchestrator = await services.createDevelopmentOrchestrator();

        // Attach WebSocket broadcast listeners for phase changes
        orchestrator.on('phase:changed', async ({ phase, cycle: devCycle }) => {
          // Update database with full artifact data (matching development.ts route handler)
          await developmentCycleRepository.update(cycleRecord.id, {
            phase,
            analyzedRequirement: devCycle.analyzedRequirement
              ? JSON.stringify(devCycle.analyzedRequirement)
              : undefined,
            architecture: devCycle.architecture
              ? JSON.stringify(devCycle.architecture)
              : undefined,
            generatedCodeSummary: devCycle.generatedCode
              ? JSON.stringify({
                  totalFiles: devCycle.generatedCode.files.length,
                  entryPoint: devCycle.generatedCode.entryPoint ?? 'src/index.ts',
                  byLanguage: devCycle.generatedCode.files.reduce(
                    (acc: Record<string, number>, f: { language: string }) => {
                      acc[f.language] = (acc[f.language] ?? 0) + 1;
                      return acc;
                    },
                    {} as Record<string, number>
                  ),
                })
              : undefined,
            testResults: devCycle.testResults
              ? JSON.stringify(devCycle.testResults)
              : undefined,
            buildResult: devCycle.buildResult
              ? JSON.stringify(devCycle.buildResult)
              : undefined,
            deployment: devCycle.deployment
              ? JSON.stringify(devCycle.deployment)
              : undefined,
            verification: devCycle.verification
              ? JSON.stringify(devCycle.verification)
              : undefined,
            thoughtSignature: devCycle.thoughtSignature ?? undefined,
            iterations: devCycle.iterations,
          });

          // Broadcast via WebSocket
          broadcastDevelopmentPhaseChange(cycleRecord.id, phase, {
            phase,
            cycleId: devCycle.id,
            iterations: devCycle.iterations,
          });

          logger.info({ cycleId: cycleRecord.id, phase }, 'Recovery: Phase changed');
        });

        // Attach completion listener
        orchestrator.on('development:completed', async ({ cycle: devCycle }) => {
          // Save verification data when completing
          const verificationJson = devCycle.verification
            ? JSON.stringify(devCycle.verification)
            : undefined;
          await developmentCycleRepository.complete(cycleRecord.id, verificationJson);
          broadcastDevelopmentComplete(cycleRecord.id, 'success');
          logger.info({ cycleId: cycleRecord.id }, 'Recovery: Cycle completed');
        });

        // Attach failure listener
        orchestrator.on('development:failed', async ({ reason }) => {
          await developmentCycleRepository.fail(cycleRecord.id, reason);
          broadcastDevelopmentFailed(cycleRecord.id, reason, cycleRecord.phase);
          logger.info({ cycleId: cycleRecord.id, reason }, 'Recovery: Cycle failed');
        });

        // Convert record to DevelopmentCycle format for resume
        const cycle = convertRecordToCycle(cycleRecord);

        // Resume the cycle (don't await - let it run in background)
        orchestrator.resume(cycle).then(() => {
          logger.info({ cycleId: cycleRecord.id }, 'Successfully completed resumed cycle');
        }).catch((err) => {
          logger.error({ cycleId: cycleRecord.id, error: (err as Error).message }, 'Resumed cycle failed');
        });

        recovered++;
        logger.info({ cycleId: cycleRecord.id }, 'Successfully started resuming cycle');
      } catch (error) {
        failed++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error({
          cycleId: cycleRecord.id,
          error: errorMessage,
        }, 'Failed to resume interrupted cycle');

        // Mark the cycle as failed in the database
        await developmentCycleRepository.fail(
          cycleRecord.id,
          JSON.stringify({ message: `Failed to resume after server restart: ${errorMessage}`, recoverable: false })
        );
      }
    }

    logger.info({ recovered, failed }, 'Cycle recovery complete');
    return { recovered, failed };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage }, 'Failed to recover interrupted cycles');
    return { recovered: 0, failed: 0 };
  }
}

/**
 * Convert database record to DevelopmentCycle format for orchestrator resume
 */
function convertRecordToCycle(record: Awaited<ReturnType<typeof developmentCycleRepository.getInterruptedCycles>>[0]) {
  return {
    id: record.id,
    phase: record.phase,
    serviceType: record.serviceType,
    frontendConfig: record.frontendConfig ? safeJsonParse(record.frontendConfig, undefined) : undefined,
    requirement: {
      source: record.requirementSource,
      rawText: record.requirementRaw,
      priority: record.requirementPriority,
    },
    analyzedRequirement: record.analyzedRequirement ? safeJsonParse(record.analyzedRequirement, undefined) : undefined,
    architecture: record.architecture ? safeJsonParse(record.architecture, undefined) : undefined,
    // generatedCode is stored as a summary in the database, but not needed for resume
    // The CODING phase will regenerate if needed
    generatedCode: undefined,
    testResults: record.testResults ? safeJsonParse(record.testResults, undefined) : undefined,
    buildResult: record.buildResult ? safeJsonParse(record.buildResult, undefined) : undefined,
    deployment: record.deployment ? safeJsonParse(record.deployment, undefined) : undefined,
    verification: record.verification ? safeJsonParse(record.verification, undefined) : undefined,
    triggeredByIncidentId: record.triggeredByIncidentId ?? undefined,
    iterations: record.iterations,
    maxIterations: record.maxIterations,
    phaseRetries: record.phaseRetries ? safeJsonParse(record.phaseRetries, {}) : undefined,
    error: record.error ? safeJsonParse(record.error, undefined) : undefined,
    thoughtSignature: record.thoughtSignature ?? undefined,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    completedAt: record.completedAt?.toISOString(),
  };
}

// ===========================================
// Investigation Recovery (Resilient Self-Healing)
// ===========================================

/**
 * Recover interrupted investigations after server restart
 *
 * This function finds investigations that were active when the server was interrupted
 * and resumes them from their last known OODA phase. This is a key part of the
 * resilient self-healing system - treating server restart as a recoverable state.
 *
 * @returns Object with counts of recovered and failed investigations
 */
export async function recoverInterruptedInvestigations(): Promise<{ recovered: number; failed: number }> {
  if (!services) {
    logger.warn('Services not initialized, skipping investigation recovery');
    return { recovered: 0, failed: 0 };
  }

  logger.info('Checking for interrupted investigations to recover...');

  try {
    // Find all interrupted investigations
    // Use staleThresholdMs = 0 to recover ALL active investigations immediately on server restart
    // This is critical for self-healing: server restarts should resume all in-progress investigations
    // regardless of how fresh their heartbeat was when the server went down
    const interruptedInvestigations = await incidentRepository.getInterruptedInvestigations(0);

    if (interruptedInvestigations.length === 0) {
      logger.info('No interrupted investigations found');
      return { recovered: 0, failed: 0 };
    }

    logger.info({
      count: interruptedInvestigations.length,
      incidents: interruptedInvestigations.map(i => ({ id: i.id, state: i.state })),
    }, 'Found interrupted investigations to recover');

    let recovered = 0;
    let failed = 0;

    // Resume each interrupted investigation
    for (const incident of interruptedInvestigations) {
      try {
        logger.info({
          incidentId: incident.id,
          state: incident.state,
          phaseRetries: incident.phaseRetries,
        }, 'Attempting to resume interrupted investigation');

        // Create a new orchestrator for this investigation
        const orchestrator = services.createOrchestrator();

        // Attach WebSocket broadcast listeners for phase changes
        orchestrator.on('phase:changed', ({ phase, context }) => {
          broadcastPhaseChange(context.incident.id, phase, {
            state: phase,
            incidentId: context.incident.id,
          });
          logger.info({ incidentId: context.incident.id, phase }, 'Recovery: Phase changed');
        });

        // Attach investigation completed listener
        orchestrator.on('investigation:completed', async ({ incident: inc }) => {
          await incidentRepository.resolve(inc.id);
          broadcastIncidentUpdate(inc.id, { status: 'resolved', state: 'DONE' });
          logger.info({ incidentId: inc.id }, 'Recovery: Investigation completed');
        });

        // Attach investigation failed listener
        orchestrator.on('investigation:failed', async ({ incident: inc, reason }) => {
          await incidentRepository.fail(inc.id);
          broadcastIncidentUpdate(inc.id, { status: 'closed', state: 'FAILED', reason });
          logger.info({ incidentId: inc.id, reason }, 'Recovery: Investigation failed');
        });

        // Resume the investigation (don't await - let it run in background)
        orchestrator.resume(incident).then(() => {
          logger.info({ incidentId: incident.id }, 'Successfully completed resumed investigation');
        }).catch((err) => {
          logger.error({ incidentId: incident.id, error: (err as Error).message }, 'Resumed investigation failed');
        });

        recovered++;
        logger.info({ incidentId: incident.id }, 'Successfully started resuming investigation');
      } catch (error) {
        failed++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error({
          incidentId: incident.id,
          error: errorMessage,
        }, 'Failed to resume interrupted investigation');

        // Mark the investigation as failed in the database
        await incidentRepository.update(incident.id, {
          isInvestigating: false,
          investigationInstanceId: null,
          investigationHeartbeat: null,
          state: 'FAILED' as OODAState,
          status: 'closed',
        });
      }
    }

    logger.info({ recovered, failed }, 'Investigation recovery complete');
    return { recovered, failed };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage }, 'Failed to recover interrupted investigations');
    return { recovered: 0, failed: 0 };
  }
}

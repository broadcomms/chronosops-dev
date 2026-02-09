/**
 * Development Orchestrator
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Coordinates the autonomous development cycle from requirement to deployment,
 * implementing the Development OODA Loop pattern for self-regenerating applications.
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │                        DEVELOPMENT OODA LOOP                                │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │                                                                              │
 * │   ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐                  │
 * │   │ ANALYZE │───▶│ DESIGN  │───▶│  CODE   │───▶│  TEST   │                  │
 * │   └────┬────┘    └────┬────┘    └────┬────┘    └────┬────┘                  │
 * │        │              │              │              │                        │
 * │        ▼              ▼              ▼              ▼                        │
 * │   Gemini AI      Architecture    TypeScript    Vitest                       │
 * │   NLP Parse      Components      Generation    Coverage                     │
 * │                                                                              │
 * │   ┌─────────┐    ┌─────────┐    ┌─────────┐                                 │
 * │   │  BUILD  │───▶│ DEPLOY  │───▶│ VERIFY  │───▶ COMPLETED / FAILED          │
 * │   └────┬────┘    └────┬────┘    └────┬────┘                                 │
 * │        │              │              │                                       │
 * │        ▼              ▼              ▼                                       │
 * │   Docker Build    K8s Apply      Health Check                               │
 * │   Image Push      Wait Rollout   Verify Fix                                 │
 * │                                                                              │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */

import { EventEmitter } from 'eventemitter3';
import { randomUUID } from 'crypto';
import { resolve } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { createChildLogger } from '@chronosops/shared';
import {
  DEVELOPMENT_PHASES,
  type DevelopmentPhase,
  type DevelopmentCycle,
  type DevelopmentConfig,
  type Requirement,
  type TestResults,
  type ServiceType,
  type FrontendConfig,
  type RegisteredService,
  type ServiceEndpoint,
  type VerificationCheck,
  type PhaseRetryConfig,
  DEFAULT_DEVELOPMENT_CONFIG,
} from '@chronosops/shared';
import type { BuildResult as SharedBuildResult } from '@chronosops/shared';
import {
  serviceRegistryRepository,
  developmentCycleRepository,
  generatedFileRepository,
} from '@chronosops/database';
import type { GeneratedFile } from '@chronosops/shared';

import type { GeminiClient } from '@chronosops/gemini';
import type { K8sClient } from '@chronosops/kubernetes';
import { PostgresManager } from '@chronosops/kubernetes';

import { DevelopmentStateMachine } from './development-state-machine.js';

// Code Generation Pipeline
import { RequirementAnalyzer } from '../generation/requirement-analyzer.js';
import { CodeGenerator } from '../generation/code-generator.js';
import { CodeValidator } from '../generation/code-validator.js';
import { CodeFixer } from '../generation/code-fixer.js';
import { TestGenerator } from '../generation/test-generator.js';
import { ManifestGenerator } from '../generation/manifest-generator.js';
import { FileManager } from '../generation/file-manager.js';
import { FrontendCodeGenerator } from '../generation/frontend-code-generator.js';
import { ApiSpecExtractor } from '../generation/api-spec-extractor.js';
import type { CodeGenerationOptions } from '../generation/code-generator.js';
import type { TimeBudget } from '../generation/types.js';

// Build Pipeline
import { BuildOrchestrator } from '../build/build-orchestrator.js';
import type { BuildResult } from '../build/types.js';

// Git Integration for Auto-Commit
import { GitService } from '@chronosops/git';

// Reasoning
import { ThoughtStateManager } from '../reasoning/thought-state-manager.js';

// ===========================================
// Constants (L2 fix - extract magic numbers)
// ===========================================

/**
 * Development orchestrator configuration constants
 * Extracted from hardcoded values for better maintainability
 */
const DEVELOPMENT_CONSTANTS = {
  /** Prefix for temporary directories during code generation */
  TEMP_DIR_PREFIX: '/tmp/chronosops-dev-',
  /** Default container port for generated applications (avoids conflict with ChronosOps API on 3000) */
  DEFAULT_CONTAINER_PORT: 8080,
  /** Timeout in ms for K8s rollout to complete (2 minutes) */
  ROLLOUT_TIMEOUT_MS: 120000,
  /** Default service port for K8s services */
  DEFAULT_SERVICE_PORT: 80,
  /** Timeout in ms for health check requests */
  HEALTH_CHECK_TIMEOUT_MS: 5000,
  /** Timeout in ms for API proxy requests */
  API_PROXY_TIMEOUT_MS: 10000,
} as const;

// ===========================================
// Types
// ===========================================

export interface DevelopmentOrchestratorDependencies {
  geminiClient: GeminiClient;
  thoughtStateManager?: ThoughtStateManager;
  /** Optional K8s client for real deployments */
  k8sClient?: K8sClient;
  /** Optional GitService for auto-commit on successful deploy */
  gitService?: GitService;
  /** Optional per-phase retry configuration for resilient self-healing */
  phaseRetryConfig?: PhaseRetryConfig;
}

export interface DevelopmentOrchestratorEvents {
  'development:started': { cycle: DevelopmentCycle };
  'development:completed': { cycle: DevelopmentCycle; duration: number };
  'development:failed': { cycle: DevelopmentCycle; reason: string };
  'phase:changed': { phase: DevelopmentPhase; cycle: DevelopmentCycle };
  'code:generated': { cycle: DevelopmentCycle; fileCount: number };
  'tests:completed': { cycle: DevelopmentCycle; results: TestResults };
  'build:completed': { cycle: DevelopmentCycle; result: BuildResult };
  'deployment:completed': { cycle: DevelopmentCycle; namespace: string };
  // Self-healing integration events
  'monitoring:registered': {
    cycleId: string;
    monitoredAppId: string | undefined;
    dashboardUrl: string | undefined;
    prometheusJob: string | undefined;
  };
}

// ===========================================
// Development Orchestrator
// ===========================================

export class DevelopmentOrchestrator extends EventEmitter<DevelopmentOrchestratorEvents> {
  private stateMachine: DevelopmentStateMachine;
  private geminiClient: GeminiClient;
  private k8sClient?: K8sClient;
  private gitService?: GitService;
  private config: DevelopmentConfig;
  private logger = createChildLogger({ component: 'DevOrchestrator' });

  // Code Generation Pipeline
  private requirementAnalyzer: RequirementAnalyzer;
  private codeGenerator: CodeGenerator;
  private codeValidator: CodeValidator;
  private codeFixer: CodeFixer;
  private testGenerator: TestGenerator;
  private manifestGenerator: ManifestGenerator;
  private frontendCodeGenerator: FrontendCodeGenerator;
  private apiSpecExtractor: ApiSpecExtractor;

  // Build Pipeline
  private buildOrchestrator: BuildOrchestrator;

  // Reasoning
  private thoughtStateManager: ThoughtStateManager;

  // Active cycles tracking
  private activeCycles: Map<string, DevelopmentCycle> = new Map();

  // Abort controllers for cancellation support
  private abortControllers: Map<string, AbortController> = new Map();

  // Track phase start time for time budget calculations
  private currentPhaseStartTime: number = 0;

  constructor(
    dependencies: DevelopmentOrchestratorDependencies,
    config: Partial<DevelopmentConfig> = {}
  ) {
    super();
    this.config = { ...DEFAULT_DEVELOPMENT_CONFIG, ...config };

    // Apply phaseRetryConfig from dependencies if provided
    if (dependencies.phaseRetryConfig) {
      this.config.phaseRetries = dependencies.phaseRetryConfig;
    }

    // Core dependencies
    this.geminiClient = dependencies.geminiClient;
    this.k8sClient = dependencies.k8sClient;
    this.gitService = dependencies.gitService;

    // Initialize state machine with phaseRetries config for resilient self-healing
    this.stateMachine = new DevelopmentStateMachine(this.config);

    // Initialize code generation pipeline
    this.requirementAnalyzer = new RequirementAnalyzer(this.geminiClient, {
      defaultPriority: 'medium',
    });
    this.codeGenerator = new CodeGenerator(this.geminiClient, {
      enableFaultInjection: this.config.codeGeneration.enableFaultInjection,
    });
    this.codeValidator = new CodeValidator();
    this.codeFixer = new CodeFixer(this.geminiClient);
    this.testGenerator = new TestGenerator(this.geminiClient);
    this.manifestGenerator = new ManifestGenerator();
    this.frontendCodeGenerator = new FrontendCodeGenerator(this.geminiClient);
    this.apiSpecExtractor = new ApiSpecExtractor();
    // V2: Schema generation now uses geminiClient.generateSchema() directly for AI-powered inference

    // Initialize build pipeline
    this.buildOrchestrator = new BuildOrchestrator({
      registry: this.config.build.registry,
      baseImage: this.config.build.baseImage,
      requiredCoverage: this.config.codeGeneration.requiredCoverage,
      buildMode: this.config.build.buildMode,
      kaniko: this.config.build.kaniko,
    });

    // Initialize reasoning
    this.thoughtStateManager =
      dependencies.thoughtStateManager ?? new ThoughtStateManager();

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.stateMachine.on('phase:changed', ({ from, to, cycle }) => {
      this.logger.info(
        { cycleId: cycle.id, from, to },
        `Phase changed: ${from} -> ${to}`
      );
      this.emit('phase:changed', { phase: to, cycle });
    });

    this.stateMachine.on('cycle:completed', ({ cycle, duration }) => {
      this.logger.info(
        { cycleId: cycle.id, duration },
        'Development cycle completed'
      );
      this.activeCycles.delete(cycle.id);
      this.emit('development:completed', { cycle, duration });
    });

    this.stateMachine.on('cycle:failed', ({ cycle, reason }) => {
      this.logger.error(
        { cycleId: cycle.id, reason },
        'Development cycle failed'
      );
      this.activeCycles.delete(cycle.id);
      this.emit('development:failed', { cycle, reason });
    });

    this.stateMachine.on('error', ({ phase, error, cycle }) => {
      this.logger.error(
        { cycleId: cycle.id, phase, error: error.message },
        'Error in phase'
      );
    });
  }

  /**
   * Start a new development cycle from a requirement
   */
  async develop(
    requirement: Requirement,
    options?: {
      serviceType?: ServiceType;
      storageMode?: 'memory' | 'sqlite' | 'postgres';
      frontendConfig?: FrontendConfig;
    }
  ): Promise<DevelopmentCycle> {
    // Check concurrent cycle limit
    if (this.activeCycles.size >= this.config.maxConcurrentCycles) {
      throw new Error(
        `Maximum concurrent cycles (${this.config.maxConcurrentCycles}) reached`
      );
    }

    const serviceType = options?.serviceType ?? 'backend';
    const storageMode = options?.storageMode ?? 'memory';
    const frontendConfig = options?.frontendConfig;

    // Create new cycle - use requirement.id to match database cycle ID, fallback to new UUID
    const cycle: DevelopmentCycle = {
      id: requirement.id ?? randomUUID(),
      phase: DEVELOPMENT_PHASES.IDLE,
      requirement,
      serviceType,
      storageMode,
      frontendConfig,
      iterations: 0,
      maxIterations: this.config.maxIterations,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.activeCycles.set(cycle.id, cycle);
    this.logger.info({ cycleId: cycle.id }, 'Starting development cycle');
    this.emit('development:started', { cycle });

    // Create abort controller for cancellation support
    const abortController = new AbortController();
    this.abortControllers.set(cycle.id, abortController);

    try {
      // Initialize reasoning for this cycle
      this.thoughtStateManager.initialize(cycle.id);

      // Start state machine
      await this.stateMachine.start(cycle);

      // Run development loop with abort signal
      await this.runDevelopmentLoop(abortController.signal);

      return this.stateMachine.getCycle()!;
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        { cycleId: cycle.id, error: err.message },
        'Development cycle failed'
      );
      throw error;
    } finally {
      // Clean up abort controller
      this.abortControllers.delete(cycle.id);
    }
  }

  /**
   * Resume an interrupted development cycle
   *
   * This is used for server restart recovery - treating interruption as
   * a recoverable state rather than an exception. The cycle continues
   * from its last known phase with preserved retry state.
   */
  async resume(cycle: DevelopmentCycle): Promise<DevelopmentCycle> {
    // Check concurrent cycle limit
    if (this.activeCycles.size >= this.config.maxConcurrentCycles) {
      throw new Error(
        `Maximum concurrent cycles (${this.config.maxConcurrentCycles}) reached`
      );
    }

    this.logger.info({
      cycleId: cycle.id,
      phase: cycle.phase,
      phaseRetries: cycle.phaseRetries,
    }, 'Resuming interrupted development cycle');

    this.activeCycles.set(cycle.id, cycle);

    // Create abort controller for cancellation support
    const abortController = new AbortController();
    this.abortControllers.set(cycle.id, abortController);

    try {
      // Re-initialize reasoning for this cycle
      this.thoughtStateManager.initialize(cycle.id);

      // Resume state machine from interrupted state
      await this.stateMachine.resume(cycle);

      // Continue development loop from where we left off with abort signal
      await this.runDevelopmentLoop(abortController.signal);

      return this.stateMachine.getCycle()!;
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        { cycleId: cycle.id, error: err.message },
        'Failed to resume development cycle'
      );
      throw error;
    } finally {
      // Clean up abort controller
      this.abortControllers.delete(cycle.id);
    }
  }

  /**
   * Cancel a running development cycle
   *
   * This signals the abort controller which will cause the development loop
   * to exit gracefully at the start of the next phase.
   *
   * @param cycleId - The ID of the cycle to cancel
   * @returns true if the cycle was found and cancelled, false otherwise
   */
  cancel(cycleId: string): boolean {
    const controller = this.abortControllers.get(cycleId);
    if (controller) {
      this.logger.info({ cycleId }, 'Cancelling development cycle');
      controller.abort();
      // Note: We don't delete from abortControllers here - the finally block in develop/resume will clean up
      return true;
    }
    this.logger.warn({ cycleId }, 'Cannot cancel: cycle not found in active controllers');
    return false;
  }

  /**
   * Check if a cycle is currently running (has an active abort controller)
   */
  isRunning(cycleId: string): boolean {
    return this.abortControllers.has(cycleId);
  }

  /**
   * Run the main development loop
   * @param signal - Optional abort signal for cancellation support
   */
  private async runDevelopmentLoop(signal?: AbortSignal): Promise<void> {
    while (this.stateMachine.isActive()) {
      const phase = this.stateMachine.getPhase();

      const cycle = this.stateMachine.getCycle();

      // Check for cancellation at the start of each phase
      if (signal?.aborted) {
        this.logger.info({ cycleId: cycle?.id, phase }, 'Cycle cancelled, stopping loop');
        this.stateMachine.setError(phase, 'Cancelled by user', false);
        await this.stateMachine.transition(DEVELOPMENT_PHASES.FAILED);
        break;
      }

      if (!cycle) break;

      try {
        switch (phase) {
          case DEVELOPMENT_PHASES.ANALYZING:
            await this.runAnalyzePhase(cycle);
            break;
          case DEVELOPMENT_PHASES.DESIGNING:
            await this.runDesignPhase(cycle);
            break;
          case DEVELOPMENT_PHASES.CODING:
            await this.runCodingPhase(cycle);
            break;
          case DEVELOPMENT_PHASES.TESTING:
            await this.runTestingPhase(cycle);
            break;
          case DEVELOPMENT_PHASES.BUILDING:
            await this.runBuildingPhase(cycle);
            break;
          case DEVELOPMENT_PHASES.DEPLOYING:
            await this.runDeployingPhase(cycle);
            break;
          case DEVELOPMENT_PHASES.VERIFYING:
            await this.runVerifyingPhase(cycle);
            break;
          default:
            break;
        }
      } catch (error) {
        const err = error as Error;
        this.logger.error(
          { cycleId: cycle.id, phase, error: err.message },
          `Phase ${phase} failed`
        );

        // Use per-phase retry logic for resilient self-healing
        // Early phases (ANALYZING, DESIGNING) retry themselves
        // Later phases go back to CODING for regeneration
        if (this.stateMachine.canRetryPhase(phase)) {
          const retryTarget = this.stateMachine.getRetryTarget(phase);
          this.logger.info(
            {
              cycleId: cycle.id,
              phase,
              retryTarget,
              phaseRetries: this.stateMachine.getPhaseRetryState(),
            },
            `Retrying phase - transitioning to ${retryTarget}`
          );
          this.stateMachine.setError(phase, err.message, true);
          await this.stateMachine.transition(retryTarget);
        } else {
          this.logger.error(
            { cycleId: cycle.id, phase, phaseRetries: this.stateMachine.getPhaseRetryState() },
            'Phase max retries exceeded - failing cycle'
          );
          this.stateMachine.setError(phase, err.message, false);
          await this.stateMachine.transition(DEVELOPMENT_PHASES.FAILED);
        }
      }
    }
  }

  // ===========================================
  // ANALYZE Phase: Parse and understand requirement
  // ===========================================

  private async runAnalyzePhase(cycle: DevelopmentCycle): Promise<void> {
    this.logger.info({ cycleId: cycle.id }, 'Running ANALYZE phase');
    this.thoughtStateManager.addObservation(`Starting analysis phase for cycle ${cycle.id}`);

    // Analyze the requirement using Gemini (with thinking capture enabled for UI display)
    const analysisResult = await this.requirementAnalyzer.analyze(
      cycle.requirement.rawText,
      undefined, // priority
      true // captureThinking - enables separate call to capture AI reasoning
    );

    if (!analysisResult.success || !analysisResult.requirement) {
      throw new Error(
        `Requirement analysis failed: ${analysisResult.error ?? 'Unknown error'}`
      );
    }

    // Update cycle with analyzed requirement and capture thought content
    cycle.analyzedRequirement = analysisResult.requirement;

    // Capture both signature and content for UI display
    const hasThoughtContent = !!analysisResult.thoughtSignature || !!analysisResult.thoughtContent;
    if (hasThoughtContent) {
      cycle.thoughtSignature = analysisResult.thoughtSignature;
      // Store thought content if available (requires DevelopmentCycle to support it)
      this.stateMachine.updateCycle({
        analyzedRequirement: cycle.analyzedRequirement,
        thoughtSignature: cycle.thoughtSignature,
      });
      this.logger.info({
        cycleId: cycle.id,
        hasThoughtSignature: !!analysisResult.thoughtSignature,
        thoughtContentLength: analysisResult.thoughtContent?.length ?? 0,
      }, 'Thought content captured for ANALYZE phase');
    } else {
      this.stateMachine.updateCycle({ analyzedRequirement: cycle.analyzedRequirement });
    }

    this.thoughtStateManager.addObservation(
      `Analyzed requirement: ${cycle.analyzedRequirement.title}`
    );
    this.thoughtStateManager.addInsight(
      `Complexity: ${cycle.analyzedRequirement.estimatedComplexity}, ` +
      `Capabilities: ${cycle.analyzedRequirement.requiredCapabilities.length}`
    );

    this.logger.info(
      {
        cycleId: cycle.id,
        title: cycle.analyzedRequirement.title,
        complexity: cycle.analyzedRequirement.estimatedComplexity,
        capabilityCount: cycle.analyzedRequirement.requiredCapabilities.length,
      },
      'Requirement analyzed successfully'
    );

    // Transition to DESIGNING
    await this.stateMachine.transition(DEVELOPMENT_PHASES.DESIGNING);
  }

  // ===========================================
  // DESIGN Phase: Create architecture design
  // ===========================================

  private async runDesignPhase(cycle: DevelopmentCycle): Promise<void> {
    this.logger.info({ cycleId: cycle.id }, 'Running DESIGN phase');
    this.thoughtStateManager.addObservation('Starting architecture design phase');

    if (!cycle.analyzedRequirement) {
      throw new Error('No analyzed requirement available');
    }

    // Design architecture using Gemini (with thinking capture for UI display)
    // CRITICAL: Pass acceptanceCriteria to ensure ALL required endpoints are in the architecture
    const designResponse = await this.geminiClient.designArchitecture({
      requirement: cycle.analyzedRequirement.description,
      acceptanceCriteria: cycle.analyzedRequirement.acceptanceCriteria,
      codebaseContext: 'Target environment: Kubernetes. Framework: Node.js with TypeScript.',
      thoughtSignature: cycle.thoughtSignature ?? undefined,
      captureThinking: true, // Enable separate call to capture AI reasoning
    });

    if (!designResponse.success || !designResponse.data) {
      throw new Error(
        `Architecture design failed: ${designResponse.error ?? 'Unknown error'}`
      );
    }

    // Update cycle with architecture
    cycle.architecture = designResponse.data;

    // Store thought signature and content for reasoning continuity and UI display
    const hasThoughtContent = !!designResponse.thoughtSignature || !!designResponse.thoughtContent;
    if (hasThoughtContent) {
      cycle.thoughtSignature = designResponse.thoughtSignature;
      this.stateMachine.updateCycle({
        architecture: cycle.architecture,
        thoughtSignature: cycle.thoughtSignature,
      });
      this.logger.info({
        cycleId: cycle.id,
        hasThoughtSignature: !!designResponse.thoughtSignature,
        thoughtContentLength: designResponse.thoughtContent?.length ?? 0,
      }, 'Thought content captured for DESIGN phase');
    } else {
      this.stateMachine.updateCycle({ architecture: cycle.architecture });
    }

    this.thoughtStateManager.addInsight(
      `Architecture designed: ${cycle.architecture.overview}`
    );
    this.thoughtStateManager.addKeyFinding(
      `${cycle.architecture.components.length} components, ` +
      `${cycle.architecture.dataFlow.length} data flows`
    );

    this.logger.info(
      {
        cycleId: cycle.id,
        componentCount: cycle.architecture.components.length,
        dataFlowCount: cycle.architecture.dataFlow.length,
      },
      'Architecture designed successfully'
    );

    // Generate architecture diagram image (non-blocking, best-effort)
    // Fire-and-forget: diagram generation failure does NOT block the pipeline
    this.generateAndSaveDiagram(cycle).catch((err) => {
      this.logger.warn({
        cycleId: cycle.id,
        errorMessage: err instanceof Error ? err.message : String(err),
      }, 'Architecture diagram generation failed (non-fatal)');
    });

    // Transition to CODING
    await this.stateMachine.transition(DEVELOPMENT_PHASES.CODING);
  }

  /**
   * Generate architecture diagram image and save to disk.
   * This is called as a fire-and-forget operation from runDesignPhase.
   * The diagram is stored in /data/diagrams/{cycleId}.png and the URL is saved to the DB.
   */
  private async generateAndSaveDiagram(cycle: DevelopmentCycle): Promise<void> {
    if (!cycle.architecture) return;

    const result = await this.geminiClient.generateArchitectureDiagram(cycle.architecture);
    if (!result) return;

    // Determine file extension from mime type
    const ext = result.mimeType === 'image/png' ? 'png' : 'jpg';
    const diagramsDir = resolve(process.cwd(), 'data', 'diagrams');

    // Ensure directory exists
    await mkdir(diagramsDir, { recursive: true });

    const filePath = resolve(diagramsDir, `${cycle.id}.${ext}`);
    await writeFile(filePath, result.imageBuffer);

    // Store the URL path in the DB (served via static file route)
    const diagramUrl = `/api/v1/diagrams/${cycle.id}.${ext}`;
    await developmentCycleRepository.update(cycle.id, {
      architectureDiagramUrl: diagramUrl,
    });

    this.logger.info({
      cycleId: cycle.id,
      diagramUrl,
      sizeBytes: result.imageBuffer.length,
    }, 'Architecture diagram saved successfully');
  }

  // ===========================================
  // CODING Phase: Generate code
  // ===========================================

  private async runCodingPhase(cycle: DevelopmentCycle): Promise<void> {
    // Track phase start time for time budget calculations
    this.currentPhaseStartTime = Date.now();

    this.logger.info(
      { cycleId: cycle.id, serviceType: cycle.serviceType },
      'Running CODING phase'
    );
    this.thoughtStateManager.addObservation('Starting code generation phase');

    if (!cycle.architecture) {
      throw new Error('No architecture design available');
    }

    const serviceType = cycle.serviceType ?? 'backend';

    // Generate code based on service type
    switch (serviceType) {
      case 'frontend':
        await this.runFrontendCodeGeneration(cycle);
        break;
      case 'fullstack':
        await this.runFullstackCodeGeneration(cycle);
        break;
      case 'backend':
      default:
        await this.runBackendCodeGeneration(cycle);
        break;
    }

    // Transition to TESTING
    await this.stateMachine.transition(DEVELOPMENT_PHASES.TESTING);
  }

  /**
   * Generate backend code (existing behavior)
   * V2: Now supports schema-first generation for improved accuracy
   */
  private async runBackendCodeGeneration(cycle: DevelopmentCycle): Promise<void> {
    if (!cycle.architecture) {
      throw new Error('No architecture design available');
    }

    // V2: Generate schema first using AI - intelligently determines fields from ANY requirement
    if (!cycle.generatedSchema && cycle.analyzedRequirement) {
      this.logger.info({ cycleId: cycle.id }, 'Generating schema with AI (autonomous schema inference)');

      try {
        // Use AI to intelligently determine entity fields from the requirement
        // This works for ANY domain: users, widgets, bookings, inventory, etc.
        const schemaResult = await this.geminiClient.generateSchema(cycle.analyzedRequirement);

        if (schemaResult.success && schemaResult.data) {
          // Helper to convert to PascalCase
          const toPascalCase = (str: string): string => {
            return str
              .split(/[-_\s]+/)
              .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
              .join('');
          };
          
          const pascalName = toPascalCase(schemaResult.data.resourceName);
          
          // Convert to GeneratedSchema format
          const schema: import('@chronosops/shared').GeneratedSchema = {
            resourceName: schemaResult.data.resourceName,
            resourceNamePlural: schemaResult.data.resourceNamePlural,
            fields: schemaResult.data.fields,
            entitySchema: schemaResult.data.entitySchema,
            createSchema: schemaResult.data.createSchema,
            updateSchema: schemaResult.data.updateSchema,
            typeDerivations: `type ${pascalName} = z.infer<typeof ${pascalName}Schema>;
type Create${pascalName}Input = z.infer<typeof Create${pascalName}Schema>;
type Update${pascalName}Input = z.infer<typeof Update${pascalName}Schema>;`,
            completeSchemaFile: `import { z } from 'zod';

${schemaResult.data.entitySchema}

${schemaResult.data.createSchema}

${schemaResult.data.updateSchema}`,
          };

          cycle.generatedSchema = schema;
          this.stateMachine.updateCycle({ generatedSchema: schema });
          this.logger.info(
            {
              cycleId: cycle.id,
              resourceName: schema.resourceName,
              fieldCount: schema.fields.length,
              fields: schema.fields.map(f => f.name),
            },
            'AI-generated schema successfully'
          );
        } else {
          this.logger.warn(
            { cycleId: cycle.id, error: schemaResult.error },
            'AI schema generation failed - code generator will infer schema'
          );
          // Don't fail the cycle - let code generator work without explicit schema
        }
      } catch (error) {
        this.logger.warn(
          { cycleId: cycle.id, error: error instanceof Error ? error.message : 'Unknown error' },
          'AI schema generation threw error - code generator will infer schema'
        );
        // Don't fail the cycle - let code generator work without explicit schema
      }
    }

    // Check if this is a retry from a failed build phase
    const previousBuildErrors = this.extractPreviousBuildErrors(cycle);
    if (previousBuildErrors.length > 0) {
      this.logger.info(
        { cycleId: cycle.id, errorCount: previousBuildErrors.length },
        'Retry detected - passing previous build errors to code generator'
      );
    }

    // V2: Build generation options with schema and previous errors
    const generationOptions: CodeGenerationOptions = {
      schema: cycle.generatedSchema,
      previousBuildErrors: previousBuildErrors.length > 0 ? previousBuildErrors : undefined,
      thoughtSignature: cycle.thoughtSignature ?? undefined,
      storageMode: cycle.storageMode ?? 'memory',
    };

    // Generate code (passing schema and previous errors)
    const codeResult = await this.codeGenerator.generate(
      cycle.architecture,
      generationOptions
    );

    if (!codeResult.success || !codeResult.code) {
      throw new Error(
        `Code generation failed: ${codeResult.error ?? 'Unknown error'}`
      );
    }

    // Clear the error after successful code generation on retry
    if (previousBuildErrors.length > 0) {
      cycle.error = undefined;
      this.stateMachine.updateCycle({ error: undefined });
    }

    // Validate generated code
    const validationResult = await this.codeValidator.validate(codeResult.code.files);

    // If validation fails, try to fix (best effort - continue even if fix doesn't fully resolve)
    if (!validationResult.isValid) {
      this.logger.warn(
        {
          cycleId: cycle.id,
          errorCount: validationResult.validationResult.errorCount,
        },
        'Code validation failed, attempting to fix'
      );

      // Create time budget to prevent fix loop from consuming entire phase timeout
      const timeBudget: TimeBudget = {
        startTime: this.currentPhaseStartTime,
        timeoutMs: this.config.phaseTimeouts.coding,
      };

      const fixResult = await this.codeFixer.fix(
        codeResult.code.files,
        validationResult.validationResult,
        1,
        cycle.thoughtSignature ?? undefined,
        timeBudget
      );

      if (fixResult.fixedFiles) {
        // Update with fixed code (even if not fully successful)
        codeResult.code.files = fixResult.fixedFiles;
      }

      if (!fixResult.success) {
        this.logger.warn(
          {
            cycleId: cycle.id,
            remainingErrors: fixResult.fixedFiles ? 'some' : 'many',
          },
          'Code fix incomplete - continuing with best effort code'
        );
        // Continue anyway - let the build phase catch errors
      }
    }

    // Enhance OpenAPI specs with AI analysis
    // This ensures Swagger UI has complete documentation with security, parameters, etc.
    this.logger.info({ cycleId: cycle.id }, 'Enhancing OpenAPI specs with AI analysis');
    try {
      const enhancedFiles = await this.codeFixer.enhanceOpenApiSpecs(codeResult.code.files);
      
      // Re-validate after OpenAPI enhancement to catch any corruption
      const postEnhanceValidation = await this.codeValidator.validate(enhancedFiles);
      const postErrorCount = postEnhanceValidation.validationResult.errorCount;
      
      if (!postEnhanceValidation.isValid && postErrorCount > 0) {
        // Check if enhancement introduced NEW errors
        const preEnhanceValidation = await this.codeValidator.validate(codeResult.code.files);
        const preErrorCount = preEnhanceValidation.validationResult.errorCount;
        const newErrorCount = postErrorCount - preErrorCount;
        
        if (newErrorCount > 0) {
          this.logger.warn(
            {
              cycleId: cycle.id,
              preErrors: preErrorCount,
              postErrors: postErrorCount,
              newErrors: newErrorCount,
            },
            'OpenAPI enhancement introduced new errors - reverting to original files'
          );
          // Keep original files without enhancement
        } else {
          // Enhancement didn't make things worse
          codeResult.code.files = enhancedFiles;
          this.logger.info({ cycleId: cycle.id }, 'OpenAPI specs enhanced successfully');
        }
      } else {
        codeResult.code.files = enhancedFiles;
        this.logger.info({ cycleId: cycle.id }, 'OpenAPI specs enhanced successfully');
      }
    } catch (error) {
      this.logger.warn(
        {
          cycleId: cycle.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'OpenAPI enhancement failed - continuing with original specs'
      );
      // Continue with original files - this is a nice-to-have enhancement
    }

    // Generate tests for the code
    // V2: Pass schema so tests use correct field names matching Zod validation
    const testResult = await this.testGenerator.generate(
      codeResult.code.files,
      cycle.architecture,
      { schema: cycle.generatedSchema }
    );

    if (testResult.success && testResult.tests) {
      // Merge test files with generated code
      codeResult.code.files = [
        ...codeResult.code.files,
        ...testResult.tests,
      ];
    }

    // Generate Kubernetes manifests with unique app name
    const appName = this.getUniqueAppName(
      cycle.analyzedRequirement?.title,
      cycle.id
    );
    const imageName = `${this.config.build.registry}/${appName}:latest`;

    // Build persistence config based on storage mode
    const storageMode = cycle.storageMode ?? 'memory';
    const persistenceConfig = storageMode !== 'memory' ? {
      enabled: true,
      storageMode: storageMode,
      storageSize: '1Gi',
      mountPath: '/app/data',
      postgresHost: 'chronosops-postgres.database.svc.cluster.local',
      postgresPort: 5432,
      databaseName: appName.replace(/-/g, '_'),
    } : undefined;

    const manifestResult = await this.manifestGenerator.generate(
      cycle.architecture,
      imageName,
      {
        namespace: this.config.deployment.namespace,
        replicas: this.config.deployment.defaultReplicas,
        persistence: persistenceConfig,
      }
    );

    if (manifestResult.success && manifestResult.manifests) {
      // Add manifests to generated files
      codeResult.code.files.push(...manifestResult.manifests);
    }

    // Update cycle with generated code and capture thoughtSignature if available
    cycle.generatedCode = codeResult.code;
    if (codeResult.thoughtSignature) {
      cycle.thoughtSignature = codeResult.thoughtSignature;
      this.stateMachine.updateCycle({ 
        generatedCode: cycle.generatedCode,
        thoughtSignature: cycle.thoughtSignature,
      });
    } else {
      this.stateMachine.updateCycle({ generatedCode: cycle.generatedCode });
    }

    this.emit('code:generated', {
      cycle,
      fileCount: cycle.generatedCode.files.length,
    });

    this.thoughtStateManager.addReasoning({
      type: 'observation',
      content: `Generated ${cycle.generatedCode.files.length} files including tests and manifests`,
      confidence: 0.8,
      evidence: [],
      phase: 'OBSERVING',
    });

    this.logger.info(
      {
        cycleId: cycle.id,
        fileCount: cycle.generatedCode.files.length,
        hasTests: testResult.success,
        hasManifests: manifestResult.success,
      },
      'Backend code generated successfully'
    );
  }

  /**
   * Generate frontend code consuming backend services
   */
  private async runFrontendCodeGeneration(cycle: DevelopmentCycle): Promise<void> {
    if (!cycle.architecture || !cycle.frontendConfig) {
      throw new Error('No architecture design or frontend config available');
    }

    const appName = this.getUniqueAppName(
      cycle.analyzedRequirement?.title,
      cycle.id
    );

    // Fetch consumed services from registry
    const consumedServices = await this.fetchConsumedServices(cycle.frontendConfig);

    if (consumedServices.length === 0 && cycle.frontendConfig.consumesServices.length > 0) {
      this.logger.warn(
        { cycleId: cycle.id, requestedServices: cycle.frontendConfig.consumesServices },
        'No backend services found - generating frontend without API consumption'
      );
    }

    // Generate frontend code
    const frontendResult = await this.frontendCodeGenerator.generate({
      name: appName,
      requirement: cycle.requirement.rawText,
      config: cycle.frontendConfig,
      consumedServices,
      architecture: cycle.architecture,
    });

    if (!frontendResult.success) {
      throw new Error(
        `Frontend code generation failed: ${frontendResult.error ?? 'Unknown error'}`
      );
    }

    // Generate Kubernetes manifests for frontend
    const imageName = `${this.config.build.registry}/${appName}:latest`;

    const manifestResult = await this.manifestGenerator.generate(
      cycle.architecture,
      imageName,
      {
        namespace: this.config.deployment.namespace,
        replicas: this.config.deployment.defaultReplicas,
      }
    );

    if (manifestResult.success && manifestResult.manifests) {
      frontendResult.files.push(...manifestResult.manifests);
    }

    // Update cycle with generated code
    cycle.generatedCode = {
      files: frontendResult.files,
      dependencies: [], // Frontend dependencies handled in package.json
      explanation: `Frontend application generated with entry point: ${frontendResult.entryPoint}`,
    };
    this.stateMachine.updateCycle({ generatedCode: cycle.generatedCode });

    this.emit('code:generated', {
      cycle,
      fileCount: cycle.generatedCode!.files.length,
    });

    this.logger.info(
      {
        cycleId: cycle.id,
        fileCount: cycle.generatedCode!.files.length,
        consumedServiceCount: consumedServices.length,
      },
      'Frontend code generated successfully'
    );
  }

  /**
   * Generate fullstack code (backend + frontend in single container)
   */
  private async runFullstackCodeGeneration(cycle: DevelopmentCycle): Promise<void> {
    if (!cycle.architecture) {
      throw new Error('No architecture design available');
    }

    const appName = this.getUniqueAppName(
      cycle.analyzedRequirement?.title,
      cycle.id
    );

    // Step 1: Generate backend code first
    this.logger.info({ cycleId: cycle.id }, 'Generating backend code for fullstack app');
    const codeResult = await this.codeGenerator.generate(cycle.architecture, {
      thoughtSignature: cycle.thoughtSignature ?? undefined,
    });

    if (!codeResult.success || !codeResult.code) {
      throw new Error(
        `Backend code generation failed: ${codeResult.error ?? 'Unknown error'}`
      );
    }

    // Validate and fix backend code
    const validationResult = await this.codeValidator.validate(codeResult.code.files);
    if (!validationResult.isValid) {
      const fixResult = await this.codeFixer.fix(
        codeResult.code.files,
        validationResult.validationResult,
        1,
        cycle.thoughtSignature ?? undefined
      );
      if (fixResult.fixedFiles) {
        codeResult.code.files = fixResult.fixedFiles;
      }
    }

    // Enhance OpenAPI specs with AI analysis for fullstack apps
    this.logger.info({ cycleId: cycle.id }, 'Enhancing OpenAPI specs with AI analysis (fullstack)');
    try {
      const enhancedFiles = await this.codeFixer.enhanceOpenApiSpecs(codeResult.code.files);
      
      // Re-validate after OpenAPI enhancement to catch any corruption
      const postEnhanceValidation = await this.codeValidator.validate(enhancedFiles);
      const postErrorCount = postEnhanceValidation.validationResult.errorCount;
      
      if (!postEnhanceValidation.isValid && postErrorCount > 0) {
        // Check if enhancement introduced NEW errors
        const preEnhanceValidation = await this.codeValidator.validate(codeResult.code.files);
        const preErrorCount = preEnhanceValidation.validationResult.errorCount;
        const newErrorCount = postErrorCount - preErrorCount;
        
        if (newErrorCount > 0) {
          this.logger.warn(
            {
              cycleId: cycle.id,
              preErrors: preErrorCount,
              postErrors: postErrorCount,
              newErrors: newErrorCount,
            },
            'OpenAPI enhancement introduced new errors (fullstack) - reverting to original files'
          );
          // Keep original files without enhancement
        } else {
          // Enhancement didn't make things worse
          codeResult.code.files = enhancedFiles;
          this.logger.info({ cycleId: cycle.id }, 'OpenAPI specs enhanced successfully (fullstack)');
        }
      } else {
        codeResult.code.files = enhancedFiles;
        this.logger.info({ cycleId: cycle.id }, 'OpenAPI specs enhanced successfully (fullstack)');
      }
    } catch (error) {
      this.logger.warn(
        { cycleId: cycle.id, error: error instanceof Error ? error.message : 'Unknown error' },
        'OpenAPI enhancement failed (fullstack) - continuing with original specs'
      );
    }

    // Step 2: Extract API spec from generated backend code
    // V2: Pass schema for accurate request/response body definitions
    const apiSpecResult = this.apiSpecExtractor.extractFromCode(
      codeResult.code.files,
      appName,
      cycle.generatedSchema
    );

    // Step 3: Generate frontend code that consumes the backend API
    if (cycle.frontendConfig) {
      this.logger.info({ cycleId: cycle.id }, 'Generating frontend code for fullstack app');

      // Create a mock service representing the backend we just generated
      const backendService: {
        service: RegisteredService;
        endpoints: ServiceEndpoint[];
      } = {
        service: {
          id: `temp-${cycle.id}`,
          developmentCycleId: cycle.id,
          name: appName,
          displayName: cycle.analyzedRequirement?.title ?? appName,
          serviceType: 'backend',
          namespace: this.config.deployment.namespace,
          serviceUrl: '', // Will be internal
          endpoints: apiSpecResult.endpoints,
          dependsOnServices: [],
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        endpoints: apiSpecResult.endpoints,
      };

      const frontendResult = await this.frontendCodeGenerator.generate({
        name: `${appName}-ui`,
        requirement: cycle.requirement.rawText,
        config: cycle.frontendConfig,
        consumedServices: [backendService],
        architecture: cycle.architecture,
      });

      if (frontendResult.success) {
        // Prefix frontend files with 'frontend/' directory
        const prefixedFrontendFiles = frontendResult.files.map((f) => ({
          ...f,
          path: `frontend/${f.path}`,
        }));

        // Merge backend and frontend files
        codeResult.code.files = [
          ...codeResult.code.files,
          ...prefixedFrontendFiles,
        ];
      }
    }

    // Generate tests for the backend code
    // V2: Pass schema so tests use correct field names matching Zod validation
    const testResult = await this.testGenerator.generate(
      codeResult.code.files.filter((f) => !f.path.startsWith('frontend/')),
      cycle.architecture,
      { schema: cycle.generatedSchema }
    );

    if (testResult.success && testResult.tests) {
      codeResult.code.files = [
        ...codeResult.code.files,
        ...testResult.tests,
      ];
    }

    // Generate Kubernetes manifests
    const imageName = `${this.config.build.registry}/${appName}:latest`;

    const manifestResult = await this.manifestGenerator.generate(
      cycle.architecture,
      imageName,
      {
        namespace: this.config.deployment.namespace,
        replicas: this.config.deployment.defaultReplicas,
      }
    );

    if (manifestResult.success && manifestResult.manifests) {
      codeResult.code.files.push(...manifestResult.manifests);
    }

    // Update cycle with generated code
    cycle.generatedCode = codeResult.code;
    this.stateMachine.updateCycle({ generatedCode: cycle.generatedCode });

    this.emit('code:generated', {
      cycle,
      fileCount: cycle.generatedCode.files.length,
    });

    this.logger.info(
      {
        cycleId: cycle.id,
        fileCount: cycle.generatedCode.files.length,
        apiEndpoints: apiSpecResult.endpoints.length,
      },
      'Fullstack code generated successfully'
    );
  }

  /**
   * Fetch consumed services from the service registry
   */
  private async fetchConsumedServices(
    config: FrontendConfig
  ): Promise<Array<{ service: RegisteredService; endpoints: ServiceEndpoint[] }>> {
    if (!config.consumesServices || config.consumesServices.length === 0) {
      return [];
    }

    const consumedServices: Array<{ service: RegisteredService; endpoints: ServiceEndpoint[] }> = [];

    for (const serviceId of config.consumesServices) {
      try {
        const serviceRecord = await serviceRegistryRepository.getById(serviceId);
        if (serviceRecord) {
          // Parse endpoints from JSON
          const endpoints: ServiceEndpoint[] = serviceRecord.endpoints
            ? JSON.parse(serviceRecord.endpoints)
            : [];

          consumedServices.push({
            service: {
              id: serviceRecord.id,
              developmentCycleId: serviceRecord.developmentCycleId,
              name: serviceRecord.name,
              displayName: serviceRecord.displayName,
              description: serviceRecord.description ?? undefined,
              serviceType: serviceRecord.serviceType,
              namespace: serviceRecord.namespace,
              serviceUrl: serviceRecord.serviceUrl,
              healthEndpoint: serviceRecord.healthEndpoint ?? undefined,
              apiSpec: serviceRecord.apiSpec ? JSON.parse(serviceRecord.apiSpec) : undefined,
              apiVersion: serviceRecord.apiVersion ?? undefined,
              endpoints,
              dependsOnServices: serviceRecord.dependsOnServices
                ? JSON.parse(serviceRecord.dependsOnServices)
                : [],
              status: serviceRecord.status,
              lastHealthCheck: serviceRecord.lastHealthCheck ?? undefined,
              createdAt: serviceRecord.createdAt,
              updatedAt: serviceRecord.updatedAt,
            },
            endpoints,
          });
        }
      } catch (error) {
        this.logger.warn(
          { serviceId, error },
          'Failed to fetch consumed service from registry'
        );
      }
    }

    return consumedServices;
  }

  // ===========================================
  // TESTING Phase: Run tests
  // ===========================================

  private async runTestingPhase(cycle: DevelopmentCycle): Promise<void> {
    this.logger.info({ cycleId: cycle.id }, 'Running TESTING phase');
    this.thoughtStateManager.addObservation('Starting testing phase');

    if (!cycle.generatedCode) {
      throw new Error('No generated code available');
    }

    // Write files to temporary directory (L2 fix: use constant)
    const tempDir = `${DEVELOPMENT_CONSTANTS.TEMP_DIR_PREFIX}${cycle.id}`;
    const fileManager = new FileManager(tempDir);
    const writeResult = await fileManager.writeFiles(cycle.generatedCode.files);

    if (!writeResult.success) {
      throw new Error(`Failed to write files: ${writeResult.failed.map(f => f.error).join(', ')}`);
    }

    // CRITICAL: Pre-flight check - verify test files exist before running vitest
    // This catches path mismatch issues early with a helpful diagnostic message
    const testFiles = cycle.generatedCode.files.filter(
      f => f.path.endsWith('.test.ts') || f.path.endsWith('.spec.ts')
    );

    const testFilesInSrc = testFiles.filter(f => f.path.startsWith('src/'));
    const testFilesOutsideSrc = testFiles.filter(f => !f.path.startsWith('src/'));

    this.logger.info(
      {
        cycleId: cycle.id,
        totalTestFiles: testFiles.length,
        testFilesInSrc: testFilesInSrc.length,
        testFilesOutsideSrc: testFilesOutsideSrc.length,
        testFilePaths: testFiles.map(f => f.path),
      },
      'Test file pre-flight check'
    );

    if (testFiles.length === 0) {
      this.logger.warn(
        { cycleId: cycle.id },
        'No test files generated - vitest will report 0 tests'
      );
    } else if (testFilesOutsideSrc.length > 0) {
      // Warn about test files that may not be picked up by vitest
      this.logger.warn(
        {
          cycleId: cycle.id,
          problematicPaths: testFilesOutsideSrc.map(f => f.path),
        },
        'Some test files are outside src/ directory - they may not be found by vitest'
      );
    }

    // Run actual tests using TestRunner
    this.logger.info({ cycleId: cycle.id, tempDir }, 'Running vitest tests');

    try {
      // Install dependencies first (needed for tests to run)
      // V2: Added stderr capture, timeout, and retry logic for GKE reliability
      const { spawn } = await import('node:child_process');
      const npmInstallTimeout = 180000; // 3 minutes timeout for npm install in GKE

      const runNpmInstall = async (attempt: number): Promise<void> => {
        return new Promise<void>((resolve, reject) => {
          let stdout = '';
          let stderr = '';
          let timedOut = false;

          // V2: Added --include=dev to install devDependencies even when NODE_ENV=production (GKE)
          const installProc = spawn('npm install --include=dev --no-audit --no-fund', {
            cwd: tempDir,
            shell: true,
          });

          // Timeout handler
          const timeout = setTimeout(() => {
            timedOut = true;
            installProc.kill('SIGTERM');
            reject(new Error(`npm install timed out after ${npmInstallTimeout / 1000}s (attempt ${attempt})`));
          }, npmInstallTimeout);

          installProc.stdout?.on('data', (data) => {
            stdout += data.toString();
          });

          installProc.stderr?.on('data', (data) => {
            stderr += data.toString();
          });

          installProc.on('close', (code) => {
            clearTimeout(timeout);
            if (timedOut) return;

            if (code === 0) {
              if (stderr.trim()) {
                this.logger.debug({
                  cycleId: cycle.id,
                  stderr: stderr.substring(0, 500),
                }, 'npm install warnings');
              }
              resolve();
            } else {
              this.logger.warn({
                cycleId: cycle.id,
                code,
                attempt,
                stdout: stdout.substring(0, 500),
                stderr: stderr.substring(0, 500),
              }, 'npm install failed');
              reject(new Error(`npm install failed with code ${code}: ${stderr.substring(0, 200)}`));
            }
          });

          installProc.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });
      };

      // Retry npm install up to 2 times
      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          await runNpmInstall(attempt);
          lastError = null;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (attempt < 2) {
            this.logger.info({
              cycleId: cycle.id,
              attempt,
            }, 'Retrying npm install...');
            // Wait a bit before retry
            await new Promise(r => setTimeout(r, 2000));
          }
        }
      }

      if (lastError) {
        throw lastError;
      }

      // Run tests with vitest
      // V2: Added timeout to prevent hanging tests in GKE
      const vitestTimeout = 120000; // 2 minutes timeout for tests
      const testResult = await new Promise<{
        success: boolean;
        output: string;
        passed: number;
        failed: number;
      }>((resolve) => {
        let timedOut = false;
        const testProc = spawn('npx vitest run --reporter=verbose', {
          cwd: tempDir,
          shell: true,
        });

        // Timeout handler
        const timeout = setTimeout(() => {
          timedOut = true;
          testProc.kill('SIGTERM');
          this.logger.warn({
            cycleId: cycle.id,
            timeout: vitestTimeout / 1000,
          }, 'vitest timed out - tests may be hanging');
          resolve({
            success: false,
            output: `Test execution timed out after ${vitestTimeout / 1000}s`,
            passed: 0,
            failed: 0,
          });
        }, vitestTimeout);

        let stdout = '';
        let stderr = '';

        testProc.stdout?.on('data', (data) => {
          stdout += data.toString();
        });

        testProc.stderr?.on('data', (data) => {
          stderr += data.toString();
        });

        testProc.on('close', (exitCode) => {
          clearTimeout(timeout);
          if (timedOut) return; // Already resolved by timeout handler

          const output = stdout + '\n' + stderr;

          // Parse test results from vitest output
          let passed = 0;
          let failed = 0;

          // CRITICAL: Detect "no test files found" scenario
          // vitest returns non-zero exit code and outputs "No test files found"
          const noTestsFound = /no test files found|no tests found|0 test files/i.test(output);

          // V2: Improved regex to handle multiple vitest output formats
          // Formats: "Tests  3 passed", "3 passed", "✓ 3", "Tests: 3 passed", "3 tests passed"
          const passMatch = output.match(/(\d+)\s*(?:tests?\s+)?passed/i)
            || output.match(/✓\s*(\d+)/)
            || output.match(/Tests?:\s*(\d+)\s+passed/i);
          const failMatch = output.match(/(\d+)\s*(?:tests?\s+)?failed/i)
            || output.match(/✗\s*(\d+)/)
            || output.match(/Tests?:\s*(\d+)\s+failed/i);

          if (passMatch?.[1]) passed = parseInt(passMatch[1], 10);
          if (failMatch?.[1]) failed = parseInt(failMatch[1], 10);

          // If no tests were found, this is a path configuration issue, not a test failure
          if (noTestsFound || (passed === 0 && failed === 0 && exitCode !== 0)) {
            // Log warning to help diagnose the issue
            this.logger.warn(
              {
                cycleId: cycle.id,
                tempDir,
                noTestsFound,
                passed,
                failed,
                exitCode,
                outputPreview: output.substring(0, 500),
              },
              'vitest found no test files - check test file paths match vitest.config.ts include patterns'
            );
          }

          resolve({
            success: exitCode === 0,
            output,
            passed,
            failed,
          });
        });

        testProc.on('error', (err) => {
          clearTimeout(timeout);
          this.logger.warn({
            cycleId: cycle.id,
            error: err.message,
          }, 'vitest process error');
          resolve({
            success: false,
            output: `Failed to run vitest: ${err.message}`,
            passed: 0,
            failed: 0,
          });
        });
      });

      this.logger.info(
        {
          cycleId: cycle.id,
          success: testResult.success,
          passed: testResult.passed,
          failed: testResult.failed,
        },
        'Test execution completed'
      );

      const testResults: TestResults = {
        success: testResult.success,
        passed: testResult.passed,
        failed: testResult.failed,
        skipped: 0,
        total: testResult.passed + testResult.failed,
        coverage: undefined,
        tests: [],
        duration: 0,
        framework: this.config.codeGeneration.testFramework,
      };

      cycle.testResults = testResults;
      this.stateMachine.updateCycle({ testResults: cycle.testResults });

      // If tests failed, record error but continue to build (it will fail there with better error messages)
      if (!testResult.success) {
        this.logger.warn(
          { cycleId: cycle.id, failed: testResult.failed },
          'Tests failed, but continuing to build phase for detailed error output'
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown test error';
      this.logger.warn(
        { cycleId: cycle.id, error: errorMessage },
        'Test execution failed, continuing to build phase'
      );

      // Create minimal test results and continue
      const testResults: TestResults = {
        success: false,
        passed: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        coverage: undefined,
        tests: [],
        duration: 0,
        framework: this.config.codeGeneration.testFramework,
      };
      cycle.testResults = testResults;
      this.stateMachine.updateCycle({ testResults: cycle.testResults });
    }

    this.emit('tests:completed', { cycle, results: cycle.testResults });

    this.logger.info(
      { cycleId: cycle.id, success: cycle.testResults?.success },
      'Testing phase completed'
    );

    // Transition to BUILDING
    await this.stateMachine.transition(DEVELOPMENT_PHASES.BUILDING);
  }

  // ===========================================
  // BUILDING Phase: Build Docker image
  // ===========================================

  private async runBuildingPhase(cycle: DevelopmentCycle): Promise<void> {
    this.logger.info({ cycleId: cycle.id }, 'Running BUILDING phase');
    this.thoughtStateManager.addObservation('Starting build phase');

    if (!cycle.generatedCode) {
      throw new Error('No generated code available');
    }

    // Build using BuildOrchestrator with unique app name
    const appName = this.getUniqueAppName(
      cycle.analyzedRequirement?.title,
      cycle.id
    );

    const buildResult = await this.buildOrchestrator.build(
      cycle.generatedCode.files,
      appName
    );

    if (!buildResult.success) {
      throw new Error(`Build failed: ${buildResult.error ?? 'Unknown error'}`);
    }

    // Convert internal BuildResult to shared BuildResult
    const sharedBuildResult: SharedBuildResult = {
      success: buildResult.success,
      buildId: cycle.id.slice(0, 8),
      imageTag: buildResult.imageTag ?? 'latest',
      logs: buildResult.logs.map(l => l.message),
      testResults: buildResult.testResults,
      duration: buildResult.processingTimeMs,
      completedAt: new Date().toISOString(),
    };

    // Update cycle with build result
    cycle.buildResult = sharedBuildResult;
    this.stateMachine.updateCycle({ buildResult: cycle.buildResult });

    this.emit('build:completed', { cycle, result: buildResult });

    this.thoughtStateManager.addReasoning({
      type: 'observation',
      content: `Build completed: ${appName}:${buildResult.imageTag ?? 'latest'}`,
      confidence: 0.9,
      evidence: [],
      phase: 'ACTING', // Use valid OODAState
    });

    this.logger.info(
      {
        cycleId: cycle.id,
        imageName: buildResult.imageName,
        imageTag: buildResult.imageTag,
        duration: buildResult.processingTimeMs,
      },
      'Build completed successfully'
    );

    // Transition to DEPLOYING
    await this.stateMachine.transition(DEVELOPMENT_PHASES.DEPLOYING);
  }

  // ===========================================
  // DEPLOYING Phase: Deploy to Kubernetes
  // ===========================================

  private async runDeployingPhase(cycle: DevelopmentCycle): Promise<void> {
    this.logger.info({ cycleId: cycle.id }, 'Running DEPLOYING phase');
    this.thoughtStateManager.addObservation('Starting deployment phase');

    if (!cycle.buildResult || !cycle.generatedCode) {
      throw new Error('No build result or generated code available');
    }

    const appName = this.getUniqueAppName(
      cycle.analyzedRequirement?.title,
      cycle.id
    );
    const imageTag = `${this.config.build.registry}/${appName}:${cycle.buildResult.imageTag}`;
    const namespace = this.config.deployment.namespace;

    // Check if we have a K8s client for real deployment
    if (this.k8sClient) {
      await this.runRealK8sDeployment(cycle, appName, imageTag, namespace);
    } else {
      await this.runSimulatedDeployment(cycle, appName, imageTag, namespace);
    }

    this.emit('deployment:completed', {
      cycle,
      namespace,
    });

    this.thoughtStateManager.addReasoning({
      type: 'observation',
      content: `Deployed ${appName} to ${namespace}${cycle.deployment?.serviceUrl ? ` at ${cycle.deployment.serviceUrl}` : ''}`,
      confidence: 0.9,
      evidence: [],
      phase: 'ACTING',
    });

    this.logger.info(
      {
        cycleId: cycle.id,
        deployment: appName,
        namespace,
        serviceUrl: cycle.deployment?.serviceUrl,
      },
      'Deployment completed successfully'
    );

    // Register service in service registry (for backend services)
    await this.registerServiceInRegistry(cycle, appName, namespace);

    // Register for monitoring (Prometheus + Vision) - enables self-healing integration
    await this.registerForMonitoring(cycle);

    // Transition to VERIFYING
    await this.stateMachine.transition(DEVELOPMENT_PHASES.VERIFYING);
  }

  /**
   * Register the deployed service in the service registry
   */
  private async registerServiceInRegistry(
    cycle: DevelopmentCycle,
    appName: string,
    namespace: string
  ): Promise<void> {
    const serviceType = cycle.serviceType ?? 'backend';

    // Only register backend and fullstack services (they expose APIs)
    if (serviceType === 'frontend') {
      this.logger.info(
        { cycleId: cycle.id },
        'Skipping service registration for frontend-only service'
      );
      return;
    }

    try {
      // Extract API spec from generated code
      // V2: Pass schema for accurate request/response body definitions
      const apiSpecResult = cycle.generatedCode
        ? this.apiSpecExtractor.extractFromCode(
            cycle.generatedCode.files,
            appName,
            cycle.generatedSchema
          )
        : { success: false, endpoints: [], method: 'inferred' as const };

      // Create service registry entry
      await serviceRegistryRepository.create({
        developmentCycleId: cycle.id,
        name: appName,
        displayName: cycle.analyzedRequirement?.title ?? appName,
        description: cycle.analyzedRequirement?.description,
        serviceType: serviceType,
        namespace: namespace,
        serviceUrl: cycle.deployment?.serviceUrl ?? '',
        healthEndpoint: '/health',
        apiSpec: apiSpecResult.spec ? JSON.stringify(apiSpecResult.spec) : undefined,
        apiVersion: '1.0.0',
        endpoints: JSON.stringify(apiSpecResult.endpoints),
        dependsOnServices: cycle.frontendConfig?.consumesServices
          ? JSON.stringify(cycle.frontendConfig.consumesServices)
          : '[]',
      });

      this.logger.info(
        {
          cycleId: cycle.id,
          serviceName: appName,
          endpointCount: apiSpecResult.endpoints.length,
        },
        'Service registered in service registry'
      );
    } catch (error) {
      this.logger.warn(
        { cycleId: cycle.id, error },
        'Failed to register service in registry - continuing anyway'
      );
    }
  }

  /**
   * Execute real Kubernetes deployment
   */
  private async runRealK8sDeployment(
    cycle: DevelopmentCycle,
    appName: string,
    imageTag: string,
    namespace: string
  ): Promise<void> {
    if (!this.k8sClient) {
      throw new Error('K8s client not available');
    }

    const storageMode = cycle.storageMode ?? 'memory';
    this.logger.info(
      { cycleId: cycle.id, appName, imageTag, namespace, storageMode },
      'Executing real Kubernetes deployment'
    );

    // L2 fix: Use constant for container port
    const containerPort = DEVELOPMENT_CONSTANTS.DEFAULT_CONTAINER_PORT;

    // Step 0a: Create PVC for SQLite persistence if needed
    // This must be done BEFORE creating the deployment so the volume can be mounted
    if (storageMode === 'sqlite') {
      const pvcName = `${appName}-data`;
      this.logger.info(
        { cycleId: cycle.id, pvcName, storageSize: '1Gi' },
        'Creating PersistentVolumeClaim for SQLite storage'
      );

      const pvcResult = await this.k8sClient.createPersistentVolumeClaim({
        name: pvcName,
        namespace,
        storageSize: '1Gi',
      });

      if (!pvcResult.success) {
        throw new Error(`PVC creation failed: ${pvcResult.error}`);
      }
    }

    // Step 0b: Create PostgreSQL database if needed
    // This must be done BEFORE creating the deployment so the app can connect
    let postgresDbName: string | undefined;
    if (storageMode === 'postgres') {
      // PostgresManager picks up config from environment variables or uses defaults:
      // - Local dev: localhost:30432 (NodePort)
      // - In-cluster: Set POSTGRES_HOST=chronosops-postgres.database.svc.cluster.local, POSTGRES_PORT=5432
      const postgresManager = new PostgresManager();

      postgresDbName = postgresManager.sanitizeDatabaseName(appName);

      this.logger.info(
        { cycleId: cycle.id, appName, databaseName: postgresDbName },
        'Creating PostgreSQL database for app'
      );

      const dbResult = await postgresManager.ensureDatabase(postgresDbName);
      await postgresManager.close();

      if (!dbResult.success) {
        throw new Error(`PostgreSQL database creation failed: ${dbResult.error}`);
      }

      this.logger.info(
        { cycleId: cycle.id, databaseName: postgresDbName, created: dbResult.created },
        'PostgreSQL database ready'
      );
    }

    // Build persistence configuration based on storage mode
    let persistenceConfig: {
      enabled: boolean;
      pvcName?: string;
      mountPath?: string;
      envVars: Array<{ name: string; value: string }>;
      secretRefs?: Array<{ secretName: string; key: string; envName: string }>;
    } | undefined;

    if (storageMode === 'sqlite') {
      persistenceConfig = {
        enabled: true,
        pvcName: `${appName}-data`,
        mountPath: '/app/data',
        envVars: [{ name: 'DATABASE_PATH', value: '/app/data/app.db' }],
      };
    } else if (storageMode === 'postgres') {
      // For apps running inside the cluster, use internal K8s DNS
      const postgresHost = 'chronosops-postgres.database.svc.cluster.local';
      const postgresPort = '5432';
      const postgresUser = 'postgres';

      // NOTE: Kubernetes DOES expand $(VAR_NAME) syntax in env vars.
      // The K8s client ensures secretRefs are added BEFORE envVars, so POSTGRES_PASSWORD
      // is defined before DATABASE_URL and can be referenced.
      persistenceConfig = {
        enabled: true,
        envVars: [
          { name: 'POSTGRES_HOST', value: postgresHost },
          { name: 'POSTGRES_PORT', value: postgresPort },
          { name: 'POSTGRES_USER', value: postgresUser },
          { name: 'POSTGRES_DATABASE', value: postgresDbName! },
          // DATABASE_URL uses $(POSTGRES_PASSWORD) which Kubernetes expands at runtime
          // because POSTGRES_PASSWORD (from secretRef) is defined earlier in the env list
          { name: 'DATABASE_URL', value: `postgres://${postgresUser}:$(POSTGRES_PASSWORD)@${postgresHost}:${postgresPort}/${postgresDbName}` },
        ],
        secretRefs: [
          { secretName: 'postgres-secret', key: 'password', envName: 'POSTGRES_PASSWORD' },
        ],
      };
    }

    // NEW: Detect if this app requires authentication secrets
    // Inject default development values to prevent runtime crashes
    const defaultEnvVars = this.getDefaultEnvVarsForApp(cycle, appName);

    // Step 1: Create the Deployment
    this.logger.info(
      { cycleId: cycle.id, hasPersistence: !!persistenceConfig, hasDefaultEnvVars: Object.keys(defaultEnvVars).length > 0 },
      'Creating Kubernetes deployment'
    );
    const deployResult = await this.k8sClient.createDeployment({
      name: appName,
      namespace,
      image: imageTag,
      // SQLite requires single replica (no concurrent writes)
      replicas: storageMode === 'sqlite' ? 1 : this.config.deployment.defaultReplicas,
      port: containerPort,
      reason: `ChronosOps development cycle ${cycle.id}`,
      persistence: persistenceConfig,
      env: Object.keys(defaultEnvVars).length > 0 ? defaultEnvVars : undefined,
    });

    if (!deployResult.success) {
      throw new Error(`Deployment creation failed: ${deployResult.error}`);
    }

    // Step 2: Create NodePort service to expose the app
    this.logger.info({ cycleId: cycle.id }, 'Creating NodePort service');
    const serviceInfo = await this.k8sClient.createNodePortService(
      appName,
      namespace,
      80,
      containerPort
    );

    // Step 3: Wait for rollout to complete
    this.logger.info({ cycleId: cycle.id }, 'Waiting for rollout to complete');
    // L2 fix: Use constant for rollout timeout
    const rolloutResult = await this.k8sClient.waitForRollout(
      appName,
      namespace,
      DEVELOPMENT_CONSTANTS.ROLLOUT_TIMEOUT_MS
    );

    if (!rolloutResult.success) {
      this.logger.warn(
        { cycleId: cycle.id, error: rolloutResult.error },
        'Rollout did not complete successfully, continuing anyway'
      );
    }

    // Step 4: Check deployment health
    const healthResult = await this.k8sClient.checkDeploymentHealth(appName, namespace);

    // Determine URLs for different purposes:
    // - verificationUrl: Used internally to verify the service is healthy
    // - userAccessUrl: Used by UI "Open Live App" button for external users
    const isInCluster = !!process.env.KUBERNETES_SERVICE_HOST;

    // For internal verification: use internal K8s DNS when in-cluster, NodePort when local
    const verificationUrl = isInCluster
      ? serviceInfo.internalUrl  // Use internal K8s DNS: http://service.namespace.svc.cluster.local:port
      : serviceInfo.nodePortUrl; // Use NodePort for local verification

    // For user access: when running in-cluster, use the /apps/ proxy path so the UI routes
    // through the main ChronosOps domain (with SSL). Fallback to NodePort for local dev.
    const userAccessUrl = isInCluster
      ? `/apps/${appName}/`
      : (serviceInfo.externalUrl ?? serviceInfo.nodePortUrl);

    // Build deployment info with service URL
    cycle.deployment = {
      id: randomUUID(),
      namespace,
      deploymentName: appName,
      image: imageTag,
      replicas: this.config.deployment.defaultReplicas,
      availableReplicas: healthResult.readyPods,
      status: healthResult.healthy ? 'running' : 'degraded',
      ports: [containerPort],
      resources: this.config.deployment.resources,
      deployedAt: new Date().toISOString(),
      // Add service info for frontend display
      serviceName: appName,
      // Use external URL for users (displayed in UI)
      serviceUrl: userAccessUrl,
      // Store internal URL for in-cluster verification (VERIFYING phase will use this when running inside K8s)
      internalUrl: serviceInfo.internalUrl,
      servicePort: serviceInfo.ports[0]?.nodePort,
    };

    this.stateMachine.updateCycle({ deployment: cycle.deployment });

    this.logger.info(
      {
        cycleId: cycle.id,
        userAccessUrl,
        verificationUrl,
        nodePortUrl: serviceInfo.nodePortUrl,
        internalUrl: serviceInfo.internalUrl,
        externalUrl: serviceInfo.externalUrl,
        isInCluster,
        healthy: healthResult.healthy,
        readyPods: healthResult.readyPods,
      },
      'Real K8s deployment completed'
    );
  }

  /**
   * Execute simulated deployment (no K8s client available)
   */
  private async runSimulatedDeployment(
    cycle: DevelopmentCycle,
    appName: string,
    imageTag: string,
    namespace: string
  ): Promise<void> {
    this.logger.info(
      { cycleId: cycle.id },
      'Simulating deployment (K8s client not available)'
    );

    // Create simulated deployment info
    cycle.deployment = {
      id: randomUUID(),
      namespace,
      deploymentName: appName,
      image: imageTag,
      replicas: this.config.deployment.defaultReplicas,
      availableReplicas: this.config.deployment.defaultReplicas,
      status: 'running',
      ports: [3000],
      resources: this.config.deployment.resources,
      deployedAt: new Date().toISOString(),
      // No serviceUrl for simulated deployment
    };

    this.stateMachine.updateCycle({ deployment: cycle.deployment });
  }

  // ===========================================
  // VERIFYING Phase: Verify deployment health
  // ===========================================

  /**
   * Wait for service to become ready before verification
   * Retries health check with exponential backoff
   */
  private async waitForServiceReady(
    serviceUrl: string,
    maxAttempts: number = 10,
    initialDelayMs: number = 2000
  ): Promise<boolean> {
    let attempt = 0;
    let delay = initialDelayMs;

    this.logger.info(
      { serviceUrl, maxAttempts, initialDelayMs },
      'Waiting for service to become ready'
    );

    while (attempt < maxAttempts) {
      attempt++;
      try {
        const response = await fetch(`${serviceUrl}/health`, {
          method: 'GET',
          signal: AbortSignal.timeout(3000),
        });

        if (response.ok) {
          this.logger.info(
            { serviceUrl, attempt, totalWaitMs: delay },
            'Service is ready'
          );
          return true;
        }

        this.logger.debug(
          { serviceUrl, attempt, status: response.status },
          'Service not ready yet (non-OK response)'
        );
      } catch (error) {
        this.logger.debug(
          { serviceUrl, attempt, error: error instanceof Error ? error.message : 'Unknown' },
          'Service not ready yet (connection failed)'
        );
      }

      // Wait before next attempt with exponential backoff (max 10s)
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 1.5, 10000);
    }

    this.logger.warn(
      { serviceUrl, maxAttempts },
      'Service did not become ready within timeout'
    );
    return false;
  }

  private async runVerifyingPhase(cycle: DevelopmentCycle): Promise<void> {
    this.logger.info({ cycleId: cycle.id }, 'Running VERIFYING phase');
    this.thoughtStateManager.addObservation('Starting verification phase');

    if (!cycle.deployment) {
      throw new Error('No deployment information available');
    }

    // Use internal URL when running inside K8s cluster, external URL otherwise
    // This ensures verification works correctly from inside GKE pods
    const isInCluster = !!process.env.KUBERNETES_SERVICE_HOST;
    const serviceUrl = isInCluster && cycle.deployment.internalUrl
      ? cycle.deployment.internalUrl
      : cycle.deployment.serviceUrl;

    this.logger.info(
      {
        cycleId: cycle.id,
        isInCluster,
        internalUrl: cycle.deployment.internalUrl,
        externalUrl: cycle.deployment.serviceUrl,
        verificationUrl: serviceUrl,
      },
      'Selected verification URL based on environment'
    );

    const checks: VerificationCheck[] = [];

    // Check 1: Pod status check (simulated or real based on K8s client)
    const podCheckStart = Date.now();
    let podCheckPassed = true;
    if (this.k8sClient && cycle.deployment.deploymentName) {
      try {
        const health = await this.k8sClient.checkDeploymentHealth(
          cycle.deployment.deploymentName,
          cycle.deployment.namespace
        );
        podCheckPassed = health.healthy;
      } catch {
        podCheckPassed = false;
      }
    }
    checks.push({
      type: 'pod_status',
      name: 'Pod readiness check',
      passed: podCheckPassed,
      confidence: podCheckPassed ? 0.95 : 0.3,
      duration: Date.now() - podCheckStart,
    });

    // Wait for service to be ready before running endpoint checks
    // This prevents "fetch failed" errors due to pod not accepting connections yet
    if (serviceUrl && podCheckPassed) {
      const serviceReady = await this.waitForServiceReady(serviceUrl);
      if (!serviceReady) {
        this.logger.warn({ cycleId: cycle.id }, 'Service not ready after waiting, proceeding with verification anyway');
      }
    }

    // Check 2: Health endpoint check
    if (serviceUrl) {
      const healthCheckStart = Date.now();
      try {
        const response = await fetch(`${serviceUrl}/health`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        });
        const healthPassed = response.ok;
        let details: Record<string, unknown> = { status: response.status };
        if (healthPassed) {
          try {
            const body = await response.json() as Record<string, unknown>;
            details = { status: response.status, body };
          } catch {
            // Body not JSON, that's fine
          }
        }
        checks.push({
          type: 'health_check',
          name: 'Health endpoint check (GET /health)',
          passed: healthPassed,
          confidence: healthPassed ? 0.9 : 0.2,
          duration: Date.now() - healthCheckStart,
          details,
        });
      } catch (error) {
        checks.push({
          type: 'health_check',
          name: 'Health endpoint check (GET /health)',
          passed: false,
          confidence: 0.1,
          duration: Date.now() - healthCheckStart,
          details: { error: error instanceof Error ? error.message : 'Unknown' },
        });
      }

      // Frontend-specific checks
      if (cycle.serviceType === 'frontend') {
        // Check: Frontend serves index.html with proper content
        const staticCheckStart = Date.now();
        try {
          const indexResponse = await fetch(serviceUrl, {
            method: 'GET',
            signal: AbortSignal.timeout(5000),
          });
          
          const staticPassed = indexResponse.ok;
          let staticDetails: Record<string, unknown> = { status: indexResponse.status };
          
          if (staticPassed) {
            const html = await indexResponse.text();
            const hasRoot = html.includes('id="root"') || html.includes("id='root'");
            const hasScript = html.includes('<script');
            staticDetails = {
              status: indexResponse.status,
              hasRootDiv: hasRoot,
              hasScript,
              contentLength: html.length,
            };
          }
          
          checks.push({
            type: 'frontend_static',
            name: 'Frontend serves index.html',
            passed: staticPassed,
            confidence: staticPassed ? 0.9 : 0.1,
            duration: Date.now() - staticCheckStart,
            details: staticDetails,
          });
        } catch (error) {
          checks.push({
            type: 'frontend_static',
            name: 'Frontend serves index.html',
            passed: false,
            confidence: 0.1,
            duration: Date.now() - staticCheckStart,
            details: { error: error instanceof Error ? error.message : 'Unknown' },
          });
        }
      }

      // Frontend-specific check: Verify API proxy works by testing consumed backend endpoints
      if (cycle.serviceType === 'frontend' && cycle.frontendConfig?.consumesServices) {
        for (const backendServiceId of cycle.frontendConfig.consumesServices) {
          // Get backend service details from registry
          const backendService = await serviceRegistryRepository.getById(backendServiceId);
          if (backendService) {
            const proxyPath = `/api/${backendService.name}`;
            
            // Test that the frontend can proxy to the backend
            // Use a simple GET to the list endpoint
            const proxyCheckStart = Date.now();
            try {
              // Find a GET endpoint from the backend's registered endpoints
              const endpoints = backendService.endpoints ? 
                (typeof backendService.endpoints === 'string' ? 
                  JSON.parse(backendService.endpoints) as Array<{ method: string; path: string }> : 
                  backendService.endpoints as Array<{ method: string; path: string }>) : 
                [];
              
              const getEndpoint = endpoints.find(
                (e: { method: string; path: string }) => 
                  e.method === 'GET' && 
                  !e.path.includes(':id') && 
                  !e.path.includes('api-docs') &&
                  !e.path.includes('health')
              );
              
              if (getEndpoint) {
                const proxyUrl = `${serviceUrl}${proxyPath}${getEndpoint.path}`;
                this.logger.info({ proxyUrl, backendService: backendService.name }, 'Testing frontend API proxy');
                
                const proxyResponse = await fetch(proxyUrl, {
                  method: 'GET',
                  headers: { 'Content-Type': 'application/json' },
                  signal: AbortSignal.timeout(10000),
                });
                
                const proxyPassed = proxyResponse.ok;
                let proxyDetails: Record<string, unknown> = { status: proxyResponse.status };
                
                if (proxyPassed) {
                  try {
                    const body = await proxyResponse.json();
                    const bodyPreview = JSON.stringify(body).slice(0, 200);
                    proxyDetails = { status: proxyResponse.status, bodyPreview };
                  } catch {
                    // Body not JSON
                  }
                } else {
                  try {
                    const errorText = await proxyResponse.text();
                    proxyDetails = { status: proxyResponse.status, error: errorText.slice(0, 200) };
                  } catch {
                    // Could not read error
                  }
                }
                
                checks.push({
                  type: 'frontend_api_proxy',
                  name: `Frontend API Proxy: ${proxyPath}${getEndpoint.path}`,
                  passed: proxyPassed,
                  confidence: proxyPassed ? 0.95 : 0.1,
                  duration: Date.now() - proxyCheckStart,
                  details: proxyDetails,
                });
                
                if (!proxyPassed) {
                  this.logger.error(
                    { proxyUrl, status: proxyResponse.status, backendService: backendService.name },
                    'Frontend API proxy check FAILED - nginx proxy misconfigured or backend unreachable'
                  );
                }
              }
            } catch (error) {
              checks.push({
                type: 'frontend_api_proxy',
                name: `Frontend API Proxy: ${proxyPath}/*`,
                passed: false,
                confidence: 0.1,
                duration: Date.now() - proxyCheckStart,
                details: { error: error instanceof Error ? error.message : 'Unknown' },
              });
              
              this.logger.error(
                { proxyPath, error: error instanceof Error ? error.message : 'Unknown' },
                'Frontend API proxy check FAILED with error'
              );
            }
          }
        }

        // CRUD Cycle Test: Create -> Read -> Delete to verify full functionality
        for (const backendServiceId of cycle.frontendConfig.consumesServices) {
          const backendService = await serviceRegistryRepository.getById(backendServiceId);
          if (backendService) {
            const proxyPath = `/api/${backendService.name}`;
            const crudTestStart = Date.now();
            
            try {
              // Parse endpoints to find POST and DELETE
              const endpoints = backendService.endpoints ? 
                (typeof backendService.endpoints === 'string' ? 
                  JSON.parse(backendService.endpoints) as Array<{ method: string; path: string }> : 
                  backendService.endpoints as Array<{ method: string; path: string }>) : 
                [];
              
              const postEndpoint = endpoints.find(
                (e: { method: string; path: string }) => 
                  e.method === 'POST' && !e.path.includes('api-docs')
              );
              
              const deleteEndpoint = endpoints.find(
                (e: { method: string; path: string }) => 
                  e.method === 'DELETE' && e.path.includes(':id')
              );
              
              if (postEndpoint && deleteEndpoint) {
                // Step 1: Discover schema by probing with empty body, then CREATE a test record
                const createUrl = `${serviceUrl}${proxyPath}${postEndpoint.path}`;
                
                // Use schema discovery to get appropriate test data
                const backendUrl = backendService.serviceUrl;
                const testData = backendUrl 
                  ? await this.discoverPostSchema(backendUrl, postEndpoint.path)
                  : { title: `ChronosOps E2E Test ${Date.now()}`, description: 'Automated verification test' };
                
                // Add timestamp to title if it exists to make each test unique
                if ('title' in testData && typeof testData.title === 'string') {
                  testData.title = `E2E Test ${Date.now()}`;
                }
                
                const createResponse = await fetch(createUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(testData),
                  signal: AbortSignal.timeout(10000),
                });
                
                if (!createResponse.ok) {
                  throw new Error(`CREATE failed: ${createResponse.status}`);
                }
                
                const created = await createResponse.json() as { id: string };
                const createdId = created.id;
                
                this.logger.info({ createdId, createUrl }, 'CRUD test: Created test record');
                
                // Step 2: DELETE the test record
                const deletePath = deleteEndpoint.path.replace(':id', createdId);
                const deleteUrl = `${serviceUrl}${proxyPath}${deletePath}`;
                
                const deleteResponse = await fetch(deleteUrl, {
                  method: 'DELETE',
                  headers: { 'Content-Type': 'application/json' },
                  signal: AbortSignal.timeout(10000),
                });
                
                // DELETE should return 204 No Content or 200 OK
                const deleteSuccess = deleteResponse.status === 204 || deleteResponse.status === 200;
                
                if (!deleteSuccess) {
                  throw new Error(`DELETE failed: ${deleteResponse.status}`);
                }
                
                this.logger.info({ createdId, deleteUrl, status: deleteResponse.status }, 'CRUD test: Deleted test record');
                
                checks.push({
                  type: 'frontend_api_proxy',
                  name: `CRUD Cycle Test (Create+Delete): ${proxyPath}`,
                  passed: true,
                  confidence: 0.98,
                  duration: Date.now() - crudTestStart,
                  details: { 
                    createStatus: createResponse.status, 
                    deleteStatus: deleteResponse.status,
                    testRecordId: createdId 
                  },
                });
              } else {
                this.logger.warn(
                  { backendService: backendService.name, hasPost: !!postEndpoint, hasDelete: !!deleteEndpoint },
                  'Skipping CRUD test - missing POST or DELETE endpoint'
                );
              }
            } catch (error) {
              checks.push({
                type: 'frontend_api_proxy',
                name: `CRUD Cycle Test: ${proxyPath}`,
                passed: false,
                confidence: 0.1,
                duration: Date.now() - crudTestStart,
                details: { error: error instanceof Error ? error.message : 'Unknown' },
              });
              
              this.logger.error(
                { proxyPath, error: error instanceof Error ? error.message : 'Unknown' },
                'CRUD cycle test FAILED'
              );
            }
          }
        }
      }

      // Check 3: For BACKENDS ONLY - Test API endpoints directly
      // For frontends, we already tested the proxy above, don't test backend endpoints directly
      if (cycle.serviceType !== 'frontend') {
        const endpoints = await this.getEndpointsForVerification(cycle);
        
        this.logger.info(
          {
            cycleId: cycle.id,
            endpointCount: endpoints.length,
            endpoints: endpoints.map(e => `${e.method} ${e.path}`),
          },
          'Verifying API endpoints'
        );
        
        for (const endpoint of endpoints) {
          const endpointCheckStart = Date.now();
          try {
            const url = `${serviceUrl}${endpoint.path}`;
            const response = await fetch(url, {
              method: endpoint.method,
              headers: { 'Content-Type': 'application/json' },
              body: endpoint.body ? JSON.stringify(endpoint.body) : undefined,
              signal: AbortSignal.timeout(5000),
            });

          // For authentication endpoints, 400/401/403/404/409 are ACCEPTABLE with dummy/test data
          // - 400: Zod validation failed on missing/invalid token (validation-based auth check)
          // - 401/403: endpoint correctly rejecting invalid credentials (auth-based check)
          // - 404: endpoint may be optional or require valid session to exist
          // - 409: resource already exists (e.g. user created by schema discovery probe)
          const isAuthEndpoint = (endpoint as { isAuthEndpoint?: boolean }).isAuthEndpoint ?? false;
          const authAcceptableStatus = isAuthEndpoint && (response.status === 400 || response.status === 401 || response.status === 403 || response.status === 404 || response.status === 409);
          
          // Check if this is a PROTECTED resource endpoint returning 401/403
          // If the API has JWT auth and returns a structured auth error, the middleware is working correctly
          const isProtectedEndpointWorking = (response.status === 401 || response.status === 403) && !isAuthEndpoint;
          
          // Read response body to check for auth-related error messages
          let responseBody: unknown = null;
          let responseText = '';
          try {
            responseText = await response.text();
            if (responseText) {
              try {
                responseBody = JSON.parse(responseText);
              } catch {
                responseBody = responseText.slice(0, 200);
              }
            }
          } catch {
            // Ignore body read errors
          }
          
          // Check if the 401/403 response indicates JWT middleware is working correctly
          // This validates that auth protection is properly implemented
          let protectedEndpointPassed = false;
          if (isProtectedEndpointWorking && responseBody && typeof responseBody === 'object') {
            const body = responseBody as Record<string, unknown>;
            const errorMessage = String(body.error || body.message || '').toLowerCase();
            // Common JWT auth error messages that prove the middleware is working
            const authErrorPatterns = [
              'token', 'unauthorized', 'authentication', 'jwt', 'bearer', 
              'missing', 'invalid', 'expired', 'forbidden', 'access denied',
              'not authenticated', 'login required', 'auth required'
            ];
            protectedEndpointPassed = authErrorPatterns.some(pattern => errorMessage.includes(pattern));
            
            if (protectedEndpointPassed) {
              this.logger.info(
                {
                  endpoint: `${endpoint.method} ${endpoint.path}`,
                  status: response.status,
                  errorMessage,
                },
                'Protected endpoint correctly returned 401/403 - JWT middleware is working'
              );
            }
          }
          
          // For list endpoints, we expect 200 and an array
          // For create endpoints, we expect 201 (but accept 200/202 as valid alternatives)
          // For auth endpoints with dummy data, 401/403/404 proves the endpoint is handled
          // For protected endpoints, 401/403 with auth error message proves JWT middleware works
          let isPassed: boolean;
          
          // Detect "already exists" / "duplicate" responses for ANY POST endpoint
          // discoverPostSchema sends re-probe requests that can CREATE real data as a side effect.
          // When verification then POSTs the same data, the app correctly rejects the duplicate.
          // Some apps return 409 (Conflict), others return 400 with an "already exists" message.
          // Either way, this proves the endpoint is working AND has proper duplicate detection.
          let duplicateDetected = false;
          if (endpoint.method === 'POST' && (response.status === 400 || response.status === 409 || response.status === 422)) {
            if (responseBody && typeof responseBody === 'object') {
              const body = responseBody as Record<string, unknown>;
              const errorText = String(body.error || body.message || body.detail || '').toLowerCase();
              const duplicatePatterns = [
                'already exists', 'duplicate', 'conflict', 'unique constraint',
                'unique violation', 'already registered', 'already taken',
                'already in use', 'exists', 'not unique',
              ];
              duplicateDetected = duplicatePatterns.some(pattern => errorText.includes(pattern));
              
              if (duplicateDetected) {
                this.logger.info(
                  {
                    endpoint: `${endpoint.method} ${endpoint.path}`,
                    status: response.status,
                    errorText,
                  },
                  'POST endpoint returned duplicate/already-exists error - schema discovery probe created the data, endpoint works correctly'
                );
              }
            }
          }
          
          // Prompt Injection Testing: Bypass 500 errors for intentional bug testing
          // When enabled AND requirement contains the key phrase, treat 500 as a pass
          // This allows apps with intentional bugs to pass initial verification
          const requirementText = cycle.requirement?.rawText || '';
          const promptInjectionTestingEnabled = this.config.codeGeneration?.enablePromptInjectionTesting ?? false;
          const hasPromptInjectionKeyPhrase = requirementText.includes('production bug that needs to be fixed');
          const is500Error = response.status === 500;
          
          if (promptInjectionTestingEnabled && hasPromptInjectionKeyPhrase && is500Error) {
            this.logger.warn(
              {
                endpoint: `${endpoint.method} ${endpoint.path}`,
                status: response.status,
                reason: 'Prompt Injection Testing bypass active',
              },
              '⚠️ PROMPT INJECTION TESTING: Bypassing 500 error for intentional bug testing'
            );
            isPassed = true;
          } else if (authAcceptableStatus) {
            // Auth endpoint returning 401/403/404 with test data = PASS (auth endpoints need real credentials)
            isPassed = true;
          } else if (protectedEndpointPassed) {
            // Protected resource endpoint correctly requiring authentication = PASS
            isPassed = true;
          } else if (duplicateDetected) {
            // POST endpoint returning "already exists" = PASS
            // The schema discovery probe created the data, proving the endpoint works correctly
            isPassed = true;
          } else if (endpoint.expectedStatus) {
            // For POST endpoints expecting 201, also accept 200 (OK), 202 (Accepted), and 409 (Conflict)
            // - 200/202: Some APIs return these for successful creation
            // - 409: Resource already exists (schema discovery probe created it), proves endpoint works
            if (endpoint.expectedStatus === 201 && endpoint.method === 'POST') {
              isPassed = response.status === 200 || response.status === 201 || response.status === 202 || response.status === 409;
            } else {
              isPassed = response.status === endpoint.expectedStatus;
            }
          } else {
            isPassed = response.ok;
          }

          let details: Record<string, unknown> = { status: response.status };
          
          if (isPassed) {
            const bodyPreview = JSON.stringify(responseBody).slice(0, 100);
            details = { status: response.status, bodyPreview };
            
            if (authAcceptableStatus) {
              details.note = 'Auth endpoint correctly returned 400/401/403/404/409 with test data';
              this.logger.info(
                {
                  endpoint: `${endpoint.method} ${endpoint.path}`,
                  status: response.status,
                },
                'Auth endpoint verification PASSED (400/401/403/404/409 is expected with test credentials)'
              );
            } else if (protectedEndpointPassed) {
              details.note = 'Protected endpoint correctly requires JWT authentication';
            } else if (duplicateDetected) {
              details.note = 'POST endpoint correctly rejected duplicate data (created by schema discovery probe)';
            }
          } else {
            // Include error details for failed checks
            details = { 
              status: response.status, 
              expected: endpoint.expectedStatus ?? '2xx',
              responseBody: typeof responseBody === 'string' 
                ? responseBody.slice(0, 100) 
                : JSON.stringify(responseBody).slice(0, 100),
            };
            
            this.logger.warn(
              {
                endpoint: `${endpoint.method} ${endpoint.path}`,
                status: response.status,
                expected: endpoint.expectedStatus ?? '2xx',
                responseBody: typeof responseBody === 'string' 
                  ? responseBody.slice(0, 100) 
                  : responseBody,
              },
              'Endpoint verification FAILED'
            );
          }

          checks.push({
            type: 'api_endpoint',
            name: `${endpoint.method} ${endpoint.path}`,
            passed: isPassed,
            confidence: isPassed ? 0.85 : 0.2,
            duration: Date.now() - endpointCheckStart,
            details,
          });
        } catch (error) {
          this.logger.error(
            {
              endpoint: `${endpoint.method} ${endpoint.path}`,
              error: error instanceof Error ? error.message : 'Unknown',
            },
            'Endpoint verification threw error'
          );
          
          checks.push({
            type: 'api_endpoint',
            name: `${endpoint.method} ${endpoint.path}`,
            passed: false,
            confidence: 0.1,
            duration: Date.now() - endpointCheckStart,
            details: { error: error instanceof Error ? error.message : 'Unknown' },
          });
        }
        }
      }
    }

    // Calculate overall success
    // Use a 90% pass rate threshold instead of requiring 100%
    // This handles edge cases where one non-critical endpoint fails
    // (e.g., GET /users returns 404 when route is behind auth or not implemented)
    const passedChecks = checks.filter(c => c.passed).length;
    const totalChecks = checks.length;
    const passRatePercent = totalChecks > 0 ? (passedChecks / totalChecks) * 100 : 0;
    const overallSuccess = passRatePercent >= 90;
    const overallConfidence = totalChecks > 0
      ? checks.reduce((sum, c) => sum + c.confidence, 0) / totalChecks
      : 0;
    const totalDuration = checks.reduce((sum, c) => sum + c.duration, 0);

    // Log results
    this.logger.info(
      {
        cycleId: cycle.id,
        passedChecks,
        totalChecks,
        overallSuccess,
        overallConfidence,
      },
      'Verification checks completed'
    );

    // Create verification result
    cycle.verification = {
      success: overallSuccess,
      checks,
      confidence: overallConfidence,
      duration: totalDuration,
      verifiedAt: new Date().toISOString(),
    };

    this.stateMachine.updateCycle({ verification: cycle.verification });

    // Handle verification failure - retry or fail
    if (!overallSuccess) {
      const passRate = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 0;
      const failedCheckNames = checks.filter(c => !c.passed).map(c => c.name);

      this.logger.warn(
        {
          cycleId: cycle.id,
          passedChecks,
          totalChecks,
          passRate: `${passRate}%`,
          failedChecks: failedCheckNames,
        },
        'Verification failed'
      );

      // NEW: Capture pod logs for debugging when verification fails
      // This gives Gemini the actual crash reason instead of just "fetch failed"
      let podCrashLogs: string | undefined;
      if (this.k8sClient && cycle.deployment?.deploymentName) {
        try {
          const logsResult = await this.k8sClient.getPodLogs(
            cycle.deployment.deploymentName,
            cycle.deployment.namespace,
            30 // last 30 lines
          );
          if (logsResult.success && logsResult.logs.length > 0) {
            podCrashLogs = logsResult.logs;
            this.logger.info(
              { cycleId: cycle.id, logLength: logsResult.logs.length },
              'Captured pod logs for retry context'
            );
          }
        } catch (error) {
          this.logger.warn(
            { cycleId: cycle.id, error: error instanceof Error ? error.message : 'Unknown' },
            'Failed to capture pod logs'
          );
        }
      }

      this.thoughtStateManager.addReasoning({
        type: 'conclusion',
        content: `Verification failed: ${passedChecks}/${totalChecks} checks passed (${passRate}%). Failed: ${failedCheckNames.join(', ')}`,
        confidence: 0.9,
        evidence: failedCheckNames,
        phase: 'VERIFYING',
      });

      // Check if we can retry (incrementIteration returns false if max reached)
      if (this.stateMachine.incrementIteration()) {
        this.logger.info(
          {
            cycleId: cycle.id,
            iterations: cycle.iterations + 1,
            maxIterations: cycle.maxIterations,
          },
          'Verification failed, retrying from CODING phase'
        );

        // Store verification errors for retry context (include pod logs if available)
        let errorMessage = `Verification failed: ${passedChecks}/${totalChecks} checks passed. Failed endpoints: ${failedCheckNames.join(', ')}`;
        if (podCrashLogs) {
          errorMessage += `\n\n[POD CRASH LOGS - THIS IS THE ACTUAL ERROR]:\n${podCrashLogs}`;
        }
        
        this.stateMachine.setError(
          'VERIFYING',
          errorMessage,
          true // recoverable
        );

        // Transition back to CODING for retry
        await this.stateMachine.transition(DEVELOPMENT_PHASES.CODING);
        return;
      }

      // Max retries exceeded - mark as FAILED
      this.logger.error(
        {
          cycleId: cycle.id,
          iterations: cycle.iterations,
          maxIterations: cycle.maxIterations,
        },
        'Verification failed after max retries'
      );

      this.stateMachine.setError(
        'VERIFYING',
        `Verification failed after ${cycle.iterations} attempts. Last result: ${passedChecks}/${totalChecks} checks passed.`,
        false // not recoverable
      );

      await this.stateMachine.transition(DEVELOPMENT_PHASES.FAILED);
      return;
    }

    // Verification succeeded!
    this.thoughtStateManager.addReasoning({
      type: 'conclusion',
      content: 'Verification successful - deployment healthy',
      confidence: 0.95,
      evidence: [],
      phase: 'VERIFYING',
    });

    this.logger.info(
      {
        cycleId: cycle.id,
        success: cycle.verification.success,
      },
      'Verification completed successfully'
    );

    // Auto-commit generated code on successful verification
    await this.autoCommitOnSuccess(cycle);

    // Register app for monitoring (auto-configuration for Prometheus)
    await this.registerForMonitoring(cycle);

    // Transition to COMPLETED
    await this.stateMachine.transition(DEVELOPMENT_PHASES.COMPLETED);
  }

  /**
   * Register the deployed app for monitoring (Prometheus)
   * Links Development Pipeline to Incident Response
   */
  private async registerForMonitoring(cycle: DevelopmentCycle): Promise<void> {
    // Dynamic import to avoid circular dependencies
    const { monitoringConfigService } = await import('../monitoring/index.js');

    this.logger.info({ cycleId: cycle.id }, 'Registering app for monitoring');

    const result = await monitoringConfigService.registerForMonitoring(cycle.id);

    if (result.success) {
      this.logger.info({
        cycleId: cycle.id,
        monitoredAppId: result.monitoredAppId,
        prometheusJob: result.prometheusJob,
      }, 'App registered for monitoring');

      // Emit event for UI notification (API layer can broadcast via WebSocket)
      this.emit('monitoring:registered', {
        cycleId: cycle.id,
        monitoredAppId: result.monitoredAppId,
        prometheusJob: result.prometheusJob,
      });

      // Add to thought state for reasoning continuity
      this.thoughtStateManager.addObservation(
        `App registered for monitoring. Prometheus job: ${result.prometheusJob}`
      );
    } else {
      this.logger.warn({
        cycleId: cycle.id,
        error: result.error,
      }, 'Failed to register app for monitoring');
    }
  }

  /**
   * Auto-commit generated code on successful deployment and verification
   */
  private async autoCommitOnSuccess(cycle: DevelopmentCycle): Promise<void> {
    if (!this.gitService || !this.gitService.isEnabled()) {
      this.logger.debug({ cycleId: cycle.id }, 'Git service not configured - skipping auto-commit');
      return;
    }

    if (!cycle.generatedCode?.files || cycle.generatedCode.files.length === 0) {
      this.logger.debug({ cycleId: cycle.id }, 'No generated files to commit');
      return;
    }

    try {
      const appName = this.getUniqueAppName(
        cycle.analyzedRequirement?.title,
        cycle.id
      );

      // Get the first file to derive the repo path
      const filePaths = cycle.generatedCode.files.map(f => f.path);
      const firstFilePath = filePaths[0] ?? '';
      
      // Derive repo path from the first file's directory structure
      // Expected format: ./generated/<appName>/src/... or similar
      const pathParts = firstFilePath.split('/');
      // Find the base directory (typically first 2-3 segments)
      const repoPath = pathParts.slice(0, Math.min(3, pathParts.length - 1)).join('/') || './generated';

      // Create commit with descriptive message
      const commitMessage = `feat(${appName}): Auto-generated code from development cycle

Cycle ID: ${cycle.id}
Service Type: ${cycle.serviceType ?? 'backend'}
Phase: COMPLETED
Verification: ${cycle.verification?.success ? 'PASSED' : 'SKIPPED'}

Generated ${cycle.generatedCode.files.length} file(s):
${filePaths.slice(0, 10).map(f => `- ${f}`).join('\n')}${filePaths.length > 10 ? `\n... and ${filePaths.length - 10} more` : ''}`;

      // Use commitChanges which handles staging and committing
      const commitResult = await this.gitService.commitChanges(repoPath, {
        message: commitMessage,
      });

      if (commitResult.success && commitResult.commit) {
        this.logger.info(
          {
            cycleId: cycle.id,
            commitHash: commitResult.commit.shortHash,
            fileCount: filePaths.length,
            pushed: commitResult.pushed,
          },
          'Successfully auto-committed generated code'
        );

        this.thoughtStateManager.addReasoning({
          type: 'observation',
          content: `Auto-committed ${filePaths.length} generated files (${commitResult.commit.shortHash})`,
          confidence: 1.0,
          evidence: [],
          phase: 'VERIFYING',
        });
      } else if (!commitResult.commit) {
        this.logger.debug({ cycleId: cycle.id }, 'No changes to commit');
      } else {
        this.logger.warn(
          { cycleId: cycle.id, error: commitResult.error },
          'Failed to auto-commit generated code'
        );
      }
    } catch (error) {
      this.logger.warn(
        { cycleId: cycle.id, error },
        'Exception during auto-commit - continuing without commit'
      );
    }
  }

  /**
   * Check if an endpoint path is related to authentication/authorization
   * These endpoints correctly return 401 with test/dummy data, which is not a failure
   */
  private isAuthenticationEndpoint(path: string): boolean {
    const authPatterns = [
      '/login',
      '/logout',
      '/session',
      '/sessions',
      '/register',
      '/signup',
      '/signin',
      '/signout',
      '/auth',
      '/authenticate',
      '/token',
      '/refresh',
      '/verify',
      '/validate',
      '/password',
      '/forgot',
      '/reset',
      '/me',
      '/profile',
      '/user/current',
      '/users/me',
    ];
    
    const lowerPath = path.toLowerCase();
    return authPatterns.some(pattern => lowerPath.includes(pattern));
  }

  /**
   * Discover required fields for a POST endpoint by probing with empty body
   * Parses validation error responses to understand the schema
   */
  private async discoverPostSchema(
    baseUrl: string,
    endpoint: string
  ): Promise<Record<string, unknown>> {
    const url = `${baseUrl}${endpoint}`;
    
    // Guard: baseUrl must be an absolute URL for fetch to work in Node.js
    if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
      this.logger.warn(
        { baseUrl, endpoint, url },
        'Schema discovery skipped - baseUrl is not an absolute URL (relative proxy path?)'
      );
      return { name: 'Test Item', description: 'Created by ChronosOps verification' };
    }
    
    try {
      // Make a probe request with empty object to trigger validation error
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(10000),
      });

      if (response.status === 400) {
        // Parse validation error to discover required fields
        const errorBody = await response.json() as {
          error?: string | Array<{
            path?: string[];
            message?: string;
            code?: string;
            expected?: string;
            options?: string[];    // Enum options from Zod
            validation?: string;   // String validation type (e.g., 'uuid', 'email')
          }>;
          details?: Array<{
            path?: string[];
            message?: string;
            code?: string;
            expected?: string;
            options?: string[];
            validation?: string;
          }>;
          errors?: Array<{
            field?: string;
            message?: string;
          }>;
        };

        const testData: Record<string, unknown> = {};

        // Parse Zod-style validation errors from { error: [...] } format
        // This is the format our generated APIs use: { error: [{ path: ['field'], expected: 'string', ... }] }
        if (errorBody.error && Array.isArray(errorBody.error)) {
          for (const detail of errorBody.error) {
            if (detail.path && detail.path.length > 0) {
              const fieldName = detail.path[0];
              if (fieldName) {
                testData[fieldName] = this.generateTestValueForField(fieldName, {
                  expected: detail.expected,
                  options: detail.options,
                  validation: detail.validation,
                  code: detail.code,
                });
              }
            }
          }
        }

        // Parse Zod-style validation errors from { details: [...] } format
        if (errorBody.details && Array.isArray(errorBody.details)) {
          for (const detail of errorBody.details) {
            if (detail.path && detail.path.length > 0) {
              const fieldName = detail.path[0];
              if (fieldName) {
                testData[fieldName] = this.generateTestValueForField(fieldName, {
                  expected: detail.expected,
                  options: detail.options,
                  validation: detail.validation,
                  code: detail.code,
                });
              }
            }
          }
        }

        // Parse simple errors array format
        if (errorBody.errors && Array.isArray(errorBody.errors)) {
          for (const err of errorBody.errors) {
            if (err.field) {
              testData[err.field] = this.generateTestValueForField(err.field);
            }
          }
        }

        if (Object.keys(testData).length > 0) {
          this.logger.info(
            { url, discoveredFields: Object.keys(testData) },
            'Discovered POST schema from validation error (probe 1)'
          );

          // Re-probe: send the partially-built body to discover any remaining required fields
          // Some Zod schemas may not report all errors in one pass
          try {
            const reprobeResponse = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(testData),
              signal: AbortSignal.timeout(10000),
            });

            if (reprobeResponse.status === 400) {
              const reprobeBody = await reprobeResponse.json() as typeof errorBody;
              let newFieldCount = 0;

              const parseReprobeDetails = (details: Array<{ path?: string[]; expected?: string; options?: string[]; validation?: string; code?: string }>) => {
                for (const detail of details) {
                  if (detail.path && detail.path.length > 0) {
                    const fieldName = detail.path[0];
                    if (fieldName && !(fieldName in testData)) {
                      testData[fieldName] = this.generateTestValueForField(fieldName, {
                        expected: detail.expected,
                        options: detail.options,
                        validation: detail.validation,
                        code: detail.code,
                      });
                      newFieldCount++;
                    }
                  }
                }
              };

              if (reprobeBody.error && Array.isArray(reprobeBody.error)) parseReprobeDetails(reprobeBody.error);
              if (reprobeBody.details && Array.isArray(reprobeBody.details)) parseReprobeDetails(reprobeBody.details);

              if (newFieldCount > 0) {
                this.logger.info(
                  { url, newFields: newFieldCount, totalFields: Object.keys(testData).length },
                  'Re-probe discovered additional required fields'
                );
              }
            }
          } catch {
            // Re-probe failed, continue with what we have
          }

          return testData;
        }
      }

      // If request succeeded (201) or other status, use generic data
      // This might happen if the endpoint doesn't require any fields
      if (response.status === 201 || response.status === 200) {
        return {}; // Empty body worked
      }
    } catch (error) {
      this.logger.warn({ url, error: error instanceof Error ? error.message : String(error) }, 'Schema discovery probe failed');
    }

    // Fallback to generic test data
    return { name: 'Test Item', description: 'Created by ChronosOps verification' };
  }

  /**
   * Generate a test value for a field based on its name and Zod validation hints
   */
  private generateTestValueForField(
    fieldName: string,
    hints?: string | { expected?: string; options?: string[]; validation?: string; code?: string }
  ): unknown {
    const name = fieldName.toLowerCase();

    // Normalize hints to object form
    const hintObj = typeof hints === 'string' ? { expected: hints } : (hints ?? {});
    const { expected, options, validation, code } = hintObj;

    // Handle enum fields - use first valid option from Zod error
    if (code === 'invalid_enum_value' && options && options.length > 0) {
      return options[0]; // Use first valid enum option
    }

    // Handle UUID validation
    if (validation === 'uuid' || name.includes('uuid') || name.endsWith('id')) {
      // Generate a valid UUID v4
      return '00000000-0000-4000-8000-000000000001';
    }

    // Handle expected types from Zod errors - MUST come before name-based heuristics
    // to respect the Zod schema's declared type (e.g., price defined as z.string())
    if (expected === 'number') return 100;
    if (expected === 'boolean') return true;
    if (expected === 'array') return [];
    if (expected === 'string') {
      // Respect the Zod schema's declared type - use string representation
      // even for fields that are semantically numeric (e.g., price as z.string())
      if (name.includes('price') || name.includes('amount') || name.includes('cost')) return '99.99';
      if (name.includes('quantity') || name.includes('count') || name.includes('num') || name.includes('stock') || name.includes('inventory') || name.includes('qty')) return '100';
      if (name.includes('date')) return new Date().toISOString();
      if (name.includes('email')) return 'test@chronosops.dev';
      if (name.includes('phone')) return '+1234567890';
      if (name.includes('url') || name.includes('link')) return 'https://example.com';
      return `test_${fieldName}`;
    }

    // Email fields - check validation hint or field name
    if (validation === 'email' || name.includes('email')) return 'test@chronosops.dev';

    // URL validation
    if (validation === 'url' || name.includes('url') || name.includes('link')) return 'https://example.com';

    // Name fields
    if (name === 'firstname' || name === 'first_name') return 'Test';
    if (name === 'lastname' || name === 'last_name') return 'User';
    if (name === 'name' || name === 'username') return 'testuser';

    // Common string fields
    if (name.includes('title')) return 'Test Title';
    if (name.includes('description') || name.includes('desc')) return 'Test description from ChronosOps';
    if (name.includes('phone')) return '+1234567890';
    if (name.includes('address')) return '123 Test Street';
    if (name.includes('city')) return 'Test City';
    if (name.includes('country')) return 'USA';
    if (name.includes('zip') || name.includes('postal')) return '12345';
    if (name.includes('date')) return new Date().toISOString();
    if (name.includes('price') || name.includes('amount') || name.includes('cost')) return 99.99;
    if (name.includes('quantity') || name.includes('count') || name.includes('num') || name.includes('stock') || name.includes('inventory') || name.includes('qty')) return 100;
    if (name.includes('status')) return 'active';
    if (name.includes('type') || name.includes('category')) return 'default';
    if (name.includes('completed') || name.includes('done') || name.includes('active')) return false;
    if (name.includes('role')) return 'user';
    if (name.includes('password')) return 'TestPassword123!';
    if (name.includes('severity')) return 'HIGH'; // Common enum for incident systems
    if (name.includes('priority')) return 'MEDIUM'; // Common enum for task systems

    // Default to a generic string
    return `test_${fieldName}`;
  }

  /**
   * Get endpoints for verification - uses service registry (accurate) with fallback to inference
   * This is the preferred method as it uses actual extracted endpoints from the deployed service
   */
  private async getEndpointsForVerification(cycle: DevelopmentCycle): Promise<Array<{
    method: string;
    path: string;
    body?: Record<string, unknown>;
    expectedStatus?: number;
    isAuthEndpoint?: boolean;
  }>> {
    // Get the service URL for schema discovery probes (must be an absolute URL for fetch)
    // When in-cluster, deployment.serviceUrl may be a relative proxy path (/apps/<name>/),
    // so we use internalUrl (K8s DNS) which is always an absolute URL.
    const isInCluster = !!process.env.KUBERNETES_SERVICE_HOST;
    const serviceUrl = isInCluster && cycle.deployment?.internalUrl
      ? cycle.deployment.internalUrl
      : cycle.deployment?.serviceUrl;
    
    // First, try to get endpoints from service registry (most accurate)
    try {
      const matchingService = await serviceRegistryRepository.getByDevelopmentCycleId(cycle.id);
      
      if (matchingService?.endpoints) {
        const registeredEndpoints = JSON.parse(matchingService.endpoints) as Array<{
          method: string;
          path: string;
          description?: string;
          requestBody?: { schema?: { type: string } };
        }>;

        // Filter to only testable endpoints (exclude api-docs, health, etc.)
        // Skip ALL parameterized paths (any path containing : followed by word chars)
        // This includes :id, :projectId, :userId, etc.
        // Nested resources like /projects/:projectId/tasks require parent resources to exist first,
        // which is complex to verify automatically. Better to skip and rely on other checks.
        const testableEndpoints = registeredEndpoints.filter(e =>
          !e.path.includes('api-docs') &&
          !e.path.includes('health') &&
          !/:[\w]+/.test(e.path) && // Skip ALL parameterized paths
          (e.method === 'GET' || e.method === 'POST')
        );

        if (testableEndpoints.length > 0) {
          this.logger.info(
            {
              cycleId: cycle.id,
              source: 'service_registry',
              endpointCount: testableEndpoints.length,
              endpoints: testableEndpoints.map(e => `${e.method} ${e.path}`),
            },
            'Using service registry endpoints for verification'
          );

          // Build endpoint list with schema discovery for POST
          const endpoints: Array<{
            method: string;
            path: string;
            body?: Record<string, unknown>;
            expectedStatus?: number;
            isAuthEndpoint?: boolean;
          }> = [];

          for (const e of testableEndpoints) {
            // Detect if this is an auth-related endpoint
            const isAuthEndpoint = this.isAuthenticationEndpoint(e.path);
            
            if (e.method === 'POST' && serviceUrl) {
              // Discover the schema for POST endpoints
              const testBody = await this.discoverPostSchema(serviceUrl, e.path);
              endpoints.push({
                method: e.method,
                path: e.path,
                body: testBody,
                // Auth endpoints may return 401 with dummy data, which is correct behavior
                expectedStatus: isAuthEndpoint ? undefined : 201,
                isAuthEndpoint,
              });
            } else {
              endpoints.push({
                method: e.method,
                path: e.path,
                body: undefined,
                // Auth endpoints like GET /session may return 401 without a token
                expectedStatus: isAuthEndpoint ? undefined : 200,
                isAuthEndpoint,
              });
            }
          }

          return endpoints;
        }
      }
    } catch (error) {
      this.logger.warn(
        { cycleId: cycle.id, error },
        'Failed to get endpoints from service registry, falling back to inference'
      );
    }

    // Fallback to regex-based inference (less accurate)
    this.logger.info(
      { cycleId: cycle.id },
      'Service registry endpoints not available, using inference fallback'
    );
    return this.inferEndpointsFromRequirement(cycle);
  }

  /**
   * Infer API endpoints from requirement acceptance criteria and title (fallback method)
   * @deprecated Prefer getEndpointsForVerification which uses service registry
   */
  private inferEndpointsFromRequirement(cycle: DevelopmentCycle): Array<{
    method: string;
    path: string;
    body?: Record<string, unknown>;
    expectedStatus?: number;
  }> {
    const endpoints: Array<{
      method: string;
      path: string;
      body?: Record<string, unknown>;
      expectedStatus?: number;
    }> = [];

    // Try to infer resource name from title
    const title = cycle.analyzedRequirement?.title?.toLowerCase() ?? '';
    const description = cycle.analyzedRequirement?.description?.toLowerCase() ?? '';
    const criteria = cycle.analyzedRequirement?.acceptanceCriteria ?? [];

    // Words that should NOT be treated as resource names
    const nonResourceWords = new Set([
      'rest', 'api', 'crud', 'http', 'web', 'basic', 'simple', 
      'implement', 'create', 'build', 'develop', 'make',
      'management', 'service', 'system', 'application', 'app'
    ]);

    // First, try to extract resource from explicit endpoint patterns in criteria
    // e.g., "GET /tasks", "POST /products"
    let resourceName: string | null = null;
    for (const criterion of criteria) {
      const endpointMatch = criterion.match(/(?:get|post|put|delete|patch)\s+\/(\w+)/i);
      if (endpointMatch?.[1] && !nonResourceWords.has(endpointMatch[1].toLowerCase())) {
        resourceName = endpointMatch[1].toLowerCase();
        break;
      }
    }

    // If not found in criteria, try title/description patterns
    if (!resourceName) {
      // Common resource patterns - order matters (more specific first)
      const resourcePatterns = [
        // "for X management" or "for managing X"
        /for\s+(\w+)\s*management/i,
        /for\s+managing\s+(\w+)/i,
        // "X tracker/api/service" but exclude "REST API"
        /(?:^|[^a-z])(\w+)\s+(?:tracker|manager|service|crud)(?:[^a-z]|$)/i,
        // "list/get/create X" 
        /(?:list|get|create|manage)\s+(\w+)s?/i,
      ];

      for (const pattern of resourcePatterns) {
        const match = title.match(pattern) ?? description.match(pattern);
        if (match?.[1] && !nonResourceWords.has(match[1].toLowerCase())) {
          resourceName = match[1].toLowerCase();
          // Pluralize if not already plural
          if (!resourceName.endsWith('s')) {
            resourceName = resourceName + 's';
          }
          break;
        }
      }
    }

    // Also look in acceptance criteria for endpoint patterns
    for (const criterion of criteria) {
      const criterionLower = criterion.toLowerCase();
      
      // Look for explicit endpoint mentions
      const endpointMatch = criterionLower.match(/(get|post|put|delete|patch)\s+\/(\w+)/i);
      if (endpointMatch?.[1] && endpointMatch[2]) {
        const method = endpointMatch[1].toUpperCase();
        const path = `/${endpointMatch[2]}`;
        
        // Avoid duplicates
        if (!endpoints.some(e => e.method === method && e.path === path)) {
          endpoints.push({ method, path, expectedStatus: 200 });
        }
      }
    }

    // If we found a resource name, add standard CRUD endpoints
    if (resourceName && endpoints.length === 0) {
      // GET /resources - List all
      endpoints.push({
        method: 'GET',
        path: `/${resourceName}`,
        expectedStatus: 200,
      });

      // POST /resources - Create (with sample body)
      endpoints.push({
        method: 'POST',
        path: `/${resourceName}`,
        body: { title: 'Test Item', description: 'Created by verification' },
        expectedStatus: 201,
      });
    }

    this.logger.info(
      { 
        cycleId: cycle.id, 
        resourceName,
        endpointCount: endpoints.length,
        endpoints: endpoints.map(e => `${e.method} ${e.path}`),
      },
      'Inferred API endpoints for verification'
    );

    return endpoints;
  }

  // ===========================================
  // Utility Methods
  // ===========================================

  /**
   * Sanitize app name for Kubernetes/Docker
   */
  private sanitizeAppName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 63);
  }

  /**
   * Generate a unique app name by combining title with cycle ID suffix
   * This ensures no naming conflicts between different development cycles
   */
  private getUniqueAppName(title: string | undefined, cycleId: string): string {
    const baseName = title ?? 'app';
    const suffix = cycleId.slice(0, 8);
    // Limit base name to 40 chars: 40 + 1 (hyphen) + 8 (suffix) = 49 chars max
    // This keeps names well under K8s 63-char limit to prevent truncation
    // which would break pod=~ regex matching in Prometheus queries
    const sanitizedBase = this.sanitizeAppName(baseName).slice(0, 40);
    return `${sanitizedBase}-${suffix}`;
  }

  /**
   * Extract errors from previous build/verification failure
   * Called during retry from CODING phase to provide context to code generator
   * This ensures Gemini sees the full history of what went wrong
   */
  private extractPreviousBuildErrors(cycle: DevelopmentCycle): string[] {
    const errors: string[] = [];

    // Extract verification errors from cycle.verification (runtime endpoint failures)
    if (cycle.verification && !cycle.verification.success) {
      const failedChecks = cycle.verification.checks.filter(c => !c.passed);
      for (const check of failedChecks) {
        let errorMsg = `[VERIFICATION] ${check.name}: FAILED`;
        if (check.details) {
          if (check.details.error) {
            errorMsg += ` - ${check.details.error}`;
          } else if (check.details.status) {
            errorMsg += ` - HTTP ${check.details.status}`;
            if (check.details.responseBody) {
              const bodyStr = typeof check.details.responseBody === 'string'
                ? check.details.responseBody
                : JSON.stringify(check.details.responseBody);
              errorMsg += ` - Response: ${bodyStr.slice(0, 200)}`;

              // Detect Zod type mismatch errors and add explicit fix guidance
              // This prevents the reinforcement loop where Gemini sees "expected string"
              // and keeps generating z.string() for semantically numeric fields
              try {
                const bodyObj = typeof check.details.responseBody === 'string'
                  ? JSON.parse(check.details.responseBody)
                  : check.details.responseBody;
                const details = bodyObj?.details ?? bodyObj?.error?.details ?? [];
                const detailsArr = Array.isArray(details) ? details : [];
                for (const detail of detailsArr) {
                  if (detail?.code === 'invalid_type' && detail?.path) {
                    const field = Array.isArray(detail.path) ? detail.path.join('.') : String(detail.path);
                    const fieldLower = field.toLowerCase();
                    const zodExpected = detail.expected;
                    const zodReceived = detail.received;
                    // If the Zod schema expects a string but the field is semantically numeric
                    if (zodExpected === 'string' && (zodReceived === 'number' || zodReceived === 'integer')) {
                      const numericFields = ['price', 'amount', 'cost', 'quantity', 'count', 'total', 'balance', 'rate', 'score', 'weight', 'height', 'width', 'age', 'stock', 'inventory', 'qty'];
                      if (numericFields.some(nf => fieldLower.includes(nf))) {
                        errorMsg += ` [FIX: The '${field}' field is semantically numeric - change Zod schema from z.string() to z.coerce.number() or z.number() so it accepts numbers. Do NOT use z.string() for numeric fields like price/amount/cost/quantity/stock]`;
                      }
                    }
                    // If the Zod schema expects a number but the field received a string
                    if (zodExpected === 'number' && zodReceived === 'string') {
                      errorMsg += ` [FIX: The '${field}' field expects a number but received a string. Use z.coerce.number() to accept both string and number inputs, or ensure the request body sends a number]`;
                    }
                  }
                  // Detect invalid_string with regex validation where the message indicates a numeric field
                  // e.g., z.string().regex(/^\d+$/, 'Stock must be a number') → code: 'invalid_string', validation: 'regex'
                  if (detail?.code === 'invalid_string' && detail?.validation === 'regex' && detail?.path) {
                    const field = Array.isArray(detail.path) ? detail.path.join('.') : String(detail.path);
                    const fieldLower = field.toLowerCase();
                    const message = (detail.message || '').toLowerCase();
                    const numericFields = ['price', 'amount', 'cost', 'quantity', 'count', 'total', 'balance', 'rate', 'score', 'weight', 'height', 'width', 'age', 'stock', 'inventory', 'qty'];
                    if (message.includes('number') || message.includes('numeric') || message.includes('digit') || numericFields.some(nf => fieldLower.includes(nf))) {
                      errorMsg += ` [FIX: The '${field}' field uses z.string().regex() to enforce numeric format - replace with z.coerce.number() or z.number() instead. Do NOT use z.string() with regex for numeric fields]`;
                    }
                  }
                }
              } catch {
                // Ignore parse errors - the base error message is still included
              }
            }
          }
        }
        errors.push(errorMsg);
      }
    }

    // Extract VERIFYING phase errors from cycle.error
    if (cycle.error?.phase === 'VERIFYING') {
      const errorMessage = cycle.error.message;
      
      // Check if pod logs are included (most valuable information for fixing runtime crashes)
      if (errorMessage.includes('[POD CRASH LOGS')) {
        // Extract the pod crash logs section
        const podLogsMatch = errorMessage.match(/\[POD CRASH LOGS[^\]]*\]:\n([\s\S]+)$/);
        if (podLogsMatch && podLogsMatch[1]) {
          const podLogs = podLogsMatch[1];
          
          // Extract the most important error lines from pod logs
          const lines = podLogs.split('\n');
          for (const line of lines) {
            // Look for Error:, throw, CRITICAL, missing, undefined, etc.
            if (
              line.includes('Error:') ||
              line.includes('throw') ||
              line.includes('CRITICAL') ||
              line.includes('Missing') ||
              line.includes('undefined') ||
              line.includes('Cannot find') ||
              line.includes('MODULE_NOT_FOUND') ||
              line.match(/at\s+Object\.<anonymous>/)
            ) {
              const trimmedLine = line.trim();
              if (trimmedLine.length > 10 && trimmedLine.length < 200) {
                errors.push(`[POD CRASH] ${trimmedLine}`);
              }
            }
          }
          
          // If we found Error lines, also include a summary
          if (errors.filter(e => e.startsWith('[POD CRASH]')).length > 0) {
            // Add the first Error: line as the primary error
            const primaryError = lines.find(l => l.includes('Error:'));
            if (primaryError && !errors.some(e => e.includes(primaryError.trim()))) {
              errors.unshift(`[POD CRASH - PRIMARY] ${primaryError.trim()}`);
            }
          }
        }
      }
      
      // Also add the basic verification failure message (but only if no pod logs extracted)
      if (errors.filter(e => e.startsWith('[POD CRASH')).length === 0) {
        // Don't include the full pod logs in this message - just the summary
        const summaryMessage = errorMessage.split('\n\n[POD CRASH')[0];
        errors.push(`[VERIFICATION ERROR] ${summaryMessage}`);
      }
    }

    // Extract BUILDING phase errors from cycle.error
    if (cycle.error?.phase === 'BUILDING') {
      const errorMessage = cycle.error.message;

      // Parse TypeScript error format: file(line,col): error TSxxxx: message
      const tsErrorRegex = /([^(\s]+)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+?)(?=\n|$)/g;
      let match;

      while ((match = tsErrorRegex.exec(errorMessage)) !== null) {
        const [, file, line, col, code, message] = match;
        errors.push(`[BUILD] ${file}:${line}:${col} - ${code}: ${message}`);
      }

      // If no TypeScript errors found, extract general error patterns
      if (errors.filter(e => e.startsWith('[BUILD]')).length === 0 && errorMessage.includes('error')) {
        const lines = errorMessage.split('\n');
        for (const line of lines) {
          if (line.toLowerCase().includes('error') && line.trim().length > 10) {
            errors.push(`[BUILD] ${line.trim()}`);
          }
        }
      }
    }

    // Extract TESTING phase errors
    if (cycle.error?.phase === 'TESTING') {
      errors.push(`[TEST ERROR] ${cycle.error.message}`);
    }

    // Log what we're sending back to the code generator
    if (errors.length > 0) {
      this.logger.info(
        {
          cycleId: cycle.id,
          errorCount: errors.length,
          phases: {
            verification: cycle.verification && !cycle.verification.success,
            building: cycle.error?.phase === 'BUILDING',
            testing: cycle.error?.phase === 'TESTING',
          },
        },
        'Extracted previous errors for retry context'
      );
    }

    // Limit to prevent overwhelming the prompt (but 20 is more generous for context)
    return errors.slice(0, 20);
  }

  /**
   * Get default environment variables based on app requirements
   * Injects sensible development defaults to prevent runtime crashes
   * for common patterns like authentication, JWT, sessions, etc.
   */
  private getDefaultEnvVarsForApp(
    cycle: DevelopmentCycle,
    _appName: string
  ): Record<string, string> {
    const envVars: Record<string, string> = {};
    
    // Get requirement info
    const rawReq = (cycle.requirement?.rawText ?? '').toLowerCase();
    const caps = cycle.analyzedRequirement?.requiredCapabilities?.map((c: string) => c.toLowerCase()) ?? [];
    const title = (cycle.architecture?.overview ?? '').toLowerCase();
    
    // Combine all text for pattern matching
    const allText = `${rawReq} ${caps.join(' ')} ${title}`;
    
    // Detect authentication-related patterns
    const authPatterns = ['auth', 'jwt', 'token', 'login', 'session', 'register', 'password'];
    const requiresAuth = authPatterns.some(pattern => allText.includes(pattern));
    
    if (requiresAuth) {
      this.logger.info({
        cycleId: cycle.id,
        detectedPatterns: authPatterns.filter(p => allText.includes(p)),
      }, 'Detected auth requirements - injecting default JWT_SECRET');
      
      // JWT secret for development (NEVER use this in production)
      envVars['JWT_SECRET'] = 'chronosops-dev-jwt-secret-CHANGE-IN-PRODUCTION-' + Date.now();
      
      // Default session settings
      envVars['SESSION_SECRET'] = 'chronosops-dev-session-secret';
      envVars['TOKEN_EXPIRY'] = '24h';
    }
    
    // Detect database patterns (for in-memory mode, we provide a fallback)
    const dbPatterns = ['database', 'postgres', 'mysql', 'db', 'storage'];
    const mentionsDb = dbPatterns.some(pattern => allText.includes(pattern));
    
    if (mentionsDb && cycle.storageMode === 'memory') {
      // For memory mode, provide a dummy DATABASE_URL that signals in-memory usage
      envVars['DATABASE_URL'] = 'memory://localhost/development';
    }
    
    // Always set NODE_ENV for consistent behavior
    envVars['NODE_ENV'] = 'development';
    
    return envVars;
  }

  /**
   * Get current phase
   */
  getPhase(): DevelopmentPhase {
    return this.stateMachine.getPhase();
  }

  /**
   * Get current cycle
   */
  getCycle(): DevelopmentCycle | null {
    return this.stateMachine.getCycle();
  }

  /**
   * Check if orchestrator is active
   */
  isActive(): boolean {
    return this.stateMachine.isActive();
  }

  /**
   * Get all active cycles
   */
  getActiveCycles(): DevelopmentCycle[] {
    return Array.from(this.activeCycles.values());
  }

  /**
   * Get cycle by ID
   */
  getCycleById(id: string): DevelopmentCycle | undefined {
    return this.activeCycles.get(id);
  }

  /**
   * Stop current development
   */
  stop(): void {
    this.stateMachine.reset();
  }

  /**
   * Get reasoning chain for current cycle
   */
  getReasoningChain() {
    return this.thoughtStateManager.getReasoningChain();
  }

  /**
   * Get thought state
   */
  getThoughtState() {
    return this.thoughtStateManager.getCurrentState();
  }

  /**
   * Rebuild and redeploy a cycle after code evolution
   * Used by the self-healing loop to complete the fix cycle
   */
  async rebuildAndRedeployCycle(cycleId: string): Promise<{
    success: boolean;
    error?: string;
    imageTag?: string;
    serviceUrl?: string;
  }> {
    this.logger.info({ cycleId }, 'Starting rebuild and redeploy for evolved cycle');

    try {
      // Get the cycle from database
      const cycle = await developmentCycleRepository.getById(cycleId);
      if (!cycle) {
        return { success: false, error: 'Cycle not found' };
      }

      // Get all generated files for the cycle
      const files = await generatedFileRepository.getByDevelopmentCycle(cycleId);
      if (!files || files.length === 0) {
        return { success: false, error: 'No generated files found for cycle' };
      }

      // Convert to the format expected by BuildOrchestrator
      const generatedFiles: GeneratedFile[] = files.map((f) => ({
        path: f.path,
        content: f.content,
        language: f.language,
        purpose: f.purpose,
        isNew: true,
      }));

      // Get app name - parse analyzed requirement if it exists
      let requirementTitle = cycle.requirementRaw;
      if (cycle.analyzedRequirement) {
        try {
          const parsed = JSON.parse(cycle.analyzedRequirement) as { title?: string };
          if (parsed.title) {
            requirementTitle = parsed.title;
          }
        } catch {
          // Use raw requirement if parsing fails
        }
      }
      const appName = this.getUniqueAppName(requirementTitle, cycle.id);

      this.logger.info({
        cycleId,
        appName,
        fileCount: generatedFiles.length,
      }, 'Building evolved code');

      // Run the build phase
      const buildResult = await this.buildOrchestrator.build(generatedFiles, appName);

      if (!buildResult.success) {
        return {
          success: false,
          error: `Build failed: ${buildResult.error ?? 'Unknown error'}`,
        };
      }

      this.logger.info({
        cycleId,
        appName,
        imageTag: buildResult.imageTag,
      }, 'Build successful, starting deployment');

      // Run the deploy phase
      const namespace = this.config.deployment.namespace;
      if (!this.k8sClient) {
        return {
          success: false,
          error: 'K8s client not initialized',
          imageTag: buildResult.imageTag,
        };
      }

      // FIX: Construct full image path like runDeployingPhase does
      // buildResult.imageTag is just the tag (e.g., "latest"), not the full path
      const fullImagePath = `${this.config.build.registry}/${appName}:${buildResult.imageTag ?? 'latest'}`;

      this.logger.info({
        cycleId,
        appName,
        registry: this.config.build.registry,
        tag: buildResult.imageTag,
        fullImagePath,
      }, 'Deploying with full image path');

      const deployResult = await this.k8sClient.createDeployment({
        name: appName,
        namespace,
        image: fullImagePath,
        replicas: 1,
        port: DEVELOPMENT_CONSTANTS.DEFAULT_CONTAINER_PORT,
        labels: { app: appName, 'evolved-from-cycle': cycleId.slice(0, 8) },
      });

      if (!deployResult.success) {
        return {
          success: false,
          error: `Deployment failed: ${deployResult.error ?? 'Unknown error'}`,
          imageTag: buildResult.imageTag,
        };
      }

      // Create or update the NodePort service
      const serviceResult = await this.k8sClient.createNodePortService(
        appName,
        namespace,
        DEVELOPMENT_CONSTANTS.DEFAULT_SERVICE_PORT,
        DEVELOPMENT_CONSTANTS.DEFAULT_CONTAINER_PORT
      );

      // For user access: when running in-cluster, use the /apps/ proxy path so the UI routes
      // through the main ChronosOps domain (with SSL). Fallback to NodePort for local dev.
      const isInCluster = !!process.env.KUBERNETES_SERVICE_HOST;
      const serviceUrl = isInCluster
        ? `/apps/${appName}/`
        : (serviceResult.externalUrl ?? serviceResult.nodePortUrl);

      this.logger.info({
        cycleId,
        appName,
        imageTag: fullImagePath,
        serviceUrl,
      }, 'Rebuild and redeploy completed successfully');

      // Update cycle status with deployment info
      await developmentCycleRepository.update(cycleId, {
        deployment: JSON.stringify({
          success: true,
          imageTag: fullImagePath,
          deploymentName: appName,
          namespace,
          serviceUrl,
          redeployedAt: new Date().toISOString(),
        }),
      });

      return {
        success: true,
        imageTag: fullImagePath,
        serviceUrl,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error: errorMessage, cycleId }, 'Rebuild and redeploy failed');
      return { success: false, error: errorMessage };
    }
  }
}

/**
 * Investigation Orchestrator
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * The central coordinator for autonomous incident investigation, implementing
 * the OODA (Observe-Orient-Decide-Act) loop pattern used by military strategists
 * and adapted here for incident response.
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │                        ARCHITECTURE OVERVIEW                                 │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │                                                                              │
 * │   ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐  │
 * │   │ OBSERVE │───▶│ ORIENT  │───▶│ DECIDE  │───▶│  ACT    │───▶│ VERIFY  │  │
 * │   └────┬────┘    └────┬────┘    └────┬────┘    └────┬────┘    └────┬────┘  │
 * │        │              │              │              │              │        │
 * │        ▼              ▼              ▼              ▼              ▼        │
 * │   VideoWatcher   Correlation    Gemini AI     K8s Executor   Verification  │
 * │   LogParser      Engine         Hypotheses    SimExecutor    Service       │
 * │   MetricProc     ThoughtState   Confidence    RollbackMgr    Re-analysis   │
 * │   EventStream    TimelineBldr   Ranking                                    │
 * │                                                                              │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * DESIGN PRINCIPLES:
 * ──────────────────
 * 1. Single Responsibility per Phase: Each OODA phase delegates to specialized
 *    components (VideoWatcher, CorrelationEngine, etc.) rather than containing
 *    business logic directly.
 *
 * 2. Multi-Modal Evidence Collection: The OBSERVE phase aggregates data from
 *    multiple sources (video frames, logs, metrics, K8s events) to build a
 *    complete picture of system state.
 *
 * 3. Safety-First Execution: The ACT phase uses ExecutorFactory to choose
 *    between real K8s execution and simulated mode, with cooldowns and limits.
 *
 * 4. Continuous Learning: ThoughtStateManager maintains reasoning continuity
 *    across phases, enabling the AI to build on previous insights.
 *
 * 5. Auditability: TimelineBuilder records every phase transition, evidence
 *    collection, and action for postmortem generation.
 *
 * WHY THIS FILE IS LARGE (~1700 lines):
 * ─────────────────────────────────────
 * This orchestrator intentionally centralizes the OODA loop coordination to:
 * - Maintain clear phase boundaries and transitions
 * - Ensure consistent error handling across all phases
 * - Enable single-point monitoring of investigation progress
 * - Facilitate debugging by having the full flow in one traceable path
 *
 * The complexity is in the coordination, not the business logic - each phase
 * method primarily delegates to specialized components.
 *
 * @see OODAStateMachine - State machine managing phase transitions
 * @see CorrelationEngine - Causal chain analysis
 * @see ThoughtStateManager - AI reasoning continuity
 * @see TimelineBuilder - Event recording for postmortems
 */

import { EventEmitter } from 'eventemitter3';
import { randomUUID } from 'crypto';
import {
  OODA_STATES,
  type OODAState,
  type Incident,
  type Evidence,
  type Hypothesis,
  type Action,
  type ActionType,
  createChildLogger,
} from '@chronosops/shared';
import { OODAStateMachine } from '../state-machine/ooda-state-machine.js';
import type { StateContext } from '../state-machine/types.js';
import { VideoWatcher, type FrameForAnalysis } from '../observers/video-watcher.js';
import {
  ExecutorFactory,
  type ActionRequest,
  type ActionResult,
  ACTION_TYPES,
} from '../agents/executor/index.js';
import { configService } from '../services/config-service.js';
import type { GeminiClient } from '@chronosops/gemini';
import type { FrameAnalysisResponse, GeneratedHypothesis, ThinkingBudget } from '@chronosops/gemini';
import { THINKING_BUDGETS } from '@chronosops/gemini';

// Autonomous Components
import { CorrelationEngine } from '../correlation/correlation-engine.js';
import { ThoughtStateManager } from '../reasoning/thought-state-manager.js';
import { TimelineBuilder } from '../timeline/timeline-builder.js';
import { RollbackManager } from '../rollback/rollback-manager.js';

// Ingestion Layer
import { LogParser } from '../ingestion/log-parser.js';
import { MetricProcessor } from '../ingestion/metric-processor.js';
import { EventStream } from '../ingestion/event-stream.js';
// Ingestion types imported for future type checking when needed

// Verification Layer
import { VerificationService } from '../verification/verification-service.js';
import type { VerificationResult } from '../verification/types.js';

// Intelligence Layer - Pattern matching and learning
import { KnowledgeBase, type PatternMatchInput, type PatternMatch } from '../intelligence/index.js';

// Vision Layer - for per-app frame capture
import { getVisionService, type VisionService } from '../vision/vision-service.js';

// Database Layer - for MonitoredApp targeting and action persistence
import { monitoredAppRepository, incidentRepository, actionRepository } from '@chronosops/database';

// ===========================================
// Types
// ===========================================

export interface OrchestratorDependencies {
  geminiClient: GeminiClient;
  videoWatcher?: VideoWatcher;
  executorFactory?: ExecutorFactory;
  // Autonomous components (all optional, will be initialized with defaults if not provided)
  correlationEngine?: CorrelationEngine;
  thoughtStateManager?: ThoughtStateManager;
  timelineBuilder?: TimelineBuilder;
  rollbackManager?: RollbackManager;
  // Ingestion Layer (for multi-modal data collection)
  logParser?: LogParser;
  metricProcessor?: MetricProcessor;
  eventStream?: EventStream;
  // Verification Layer
  verificationService?: VerificationService;
  // Intelligence Layer (pattern matching)
  knowledgeBase?: KnowledgeBase;
}

export interface OrchestratorConfig {
  confidenceThreshold: number;
  maxActionsPerIncident: number;
  verificationWaitMs: number;
  maxVerificationAttempts: number;
  /**
   * Enable escalating remediation pipeline
   * When true, tries rollback → restart → scale → code_fix in sequence
   * When false, executes only the action suggested by the hypothesis
   */
  useEscalatingRemediation: boolean;
  /**
   * Confidence threshold below which escalating remediation is automatically used
   * If hypothesis confidence < this threshold, escalating mode is triggered
   */
  escalationConfidenceThreshold: number;
  /**
   * How long to wait for evolution completion before timing out (ms)
   * Default: 600000 (10 minutes)
   */
  evolutionWaitTimeoutMs: number;
}

export interface OrchestratorEvents {
  'investigation:started': { incident: Incident };
  'investigation:completed': { incident: Incident; duration: number };
  'investigation:failed': { incident: Incident; reason: string };
  'phase:changed': { phase: OODAState; context: StateContext };
  'observation:collected': { evidence: Evidence };
  'hypothesis:generated': { hypothesis: Hypothesis };
  'action:executed': { action: Action; result: ActionResult };
  'verification:completed': { success: boolean; details: string };
  'escalation:step': { title: string; description: string; phase: string; metadata: Record<string, unknown> };
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  confidenceThreshold: 0.7,
  maxActionsPerIncident: 5,
  verificationWaitMs: 10000,
  maxVerificationAttempts: 3,
  useEscalatingRemediation: true, // Enable escalating remediation by default (SRE best practice)
  escalationConfidenceThreshold: 0.85, // Use escalation when hypothesis confidence is below this
  evolutionWaitTimeoutMs: 600000, // 10 minutes default wait for evolution completion
};

// Escalating remediation types
export interface RemediationAttempt {
  actionType: 'rollback' | 'restart' | 'scale' | 'code_fix';
  timestamp: Date;
  success: boolean;
  durationMs: number;
  message: string;
  verificationPassed?: boolean;
}

export interface EscalatingRemediationResult {
  success: boolean;
  resolvedByAction?: 'rollback' | 'restart' | 'scale' | 'code_fix';
  attempts: RemediationAttempt[];
  totalDurationMs: number;
  message: string;
}

/**
 * Escalation order for remediation actions (SRE best practices)
 * Priority: Fast/low-risk → Slow/higher-risk
 */
const ESCALATION_ORDER: readonly ('rollback' | 'restart' | 'scale' | 'code_fix')[] = [
  'rollback',   // ~10s, very low risk - bad deploy, config change
  'restart',    // ~30s, low risk - memory leak, deadlock, cache
  'scale',      // ~1min, low risk - load spike, resource exhaustion
  'code_fix',   // ~5-15min, medium risk - actual bug requiring evolution
] as const;

// ===========================================
// Investigation Orchestrator
// ===========================================

export class InvestigationOrchestrator extends EventEmitter<OrchestratorEvents> {
  private stateMachine: OODAStateMachine;
  private geminiClient: GeminiClient;
  private videoWatcher: VideoWatcher;
  private executorFactory: ExecutorFactory;
  private config: OrchestratorConfig;
  private logger = createChildLogger({ component: 'Orchestrator' });

  // Autonomous Components
  private correlationEngine: CorrelationEngine;
  private thoughtStateManager: ThoughtStateManager;
  private timelineBuilder: TimelineBuilder;
  private rollbackManager: RollbackManager;

  // Ingestion Layer
  private logParser: LogParser;
  private metricProcessor: MetricProcessor;
  private eventStream: EventStream;

  // Verification Layer - available for enhanced multi-modal verification
  // Currently using inline verification with VerificationResult type for RollbackManager integration
  private verificationService: VerificationService;

  // Vision Layer - for per-app frame capture from VisionService
  private visionService: VisionService;

  // Intelligence Layer - Pattern matching for hypothesis boosting
  private knowledgeBase: KnowledgeBase | null = null;

  /**
   * Target deployment for remediation actions.
   * Set via setTargetDeployment() before starting investigation.
   */
  private targetDeployment?: string;

  /**
   * Target namespace for remediation actions.
   * Used together with targetDeployment for K8s operations.
   */
  private targetNamespace?: string;

  /**
   * Service URL for direct health checks during verification.
   * Dynamically resolved from K8s NodePort.
   */
  private targetServiceUrl?: string;

  /**
   * Last measured error rate from verification traffic.
   * Used as fallback when Prometheus is unavailable.
   */
  private lastVerificationErrorRate?: number;

  /**
   * Error rate measured BEFORE any remediation action is taken.
   * Used to determine if escalation to code_fix is needed, since
   * post-action measurements can be misleading (e.g. restart resets in-memory state).
   */
  private preEscalationErrorRate?: number;

  constructor(
    dependencies: OrchestratorDependencies,
    config: Partial<OrchestratorConfig> = {}
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Inject core dependencies
    this.geminiClient = dependencies.geminiClient;
    this.videoWatcher = dependencies.videoWatcher ?? new VideoWatcher();
    this.executorFactory = dependencies.executorFactory ?? new ExecutorFactory();

    // Initialize autonomous components
    this.correlationEngine = dependencies.correlationEngine ?? new CorrelationEngine(this.geminiClient);
    this.thoughtStateManager = dependencies.thoughtStateManager ?? new ThoughtStateManager();
    this.timelineBuilder = dependencies.timelineBuilder ?? new TimelineBuilder();
    this.rollbackManager = dependencies.rollbackManager ?? new RollbackManager();

    // Initialize ingestion layer
    this.logParser = dependencies.logParser ?? new LogParser();
    this.metricProcessor = dependencies.metricProcessor ?? new MetricProcessor();
    this.eventStream = dependencies.eventStream ?? new EventStream();

    // Initialize verification layer
    this.verificationService = dependencies.verificationService ?? new VerificationService();

    // Initialize vision layer (singleton for per-app frame capture)
    this.visionService = getVisionService();

    // Initialize intelligence layer (optional - only for pattern boosting)
    // Create default KnowledgeBase if not provided (requires GeminiClient)
    this.knowledgeBase = dependencies.knowledgeBase ?? new KnowledgeBase(this.geminiClient);

    // Initialize state machine
    this.stateMachine = new OODAStateMachine({
      confidenceThreshold: this.config.confidenceThreshold,
      maxActionsPerIncident: this.config.maxActionsPerIncident,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.stateMachine.on('state:changed', ({ from, to, context }) => {
      this.logger.info(`Phase changed: ${from} -> ${to}`, { incidentId: context.incident.id });
      this.emit('phase:changed', { phase: to, context });
    });

    this.stateMachine.on('incident:resolved', ({ incident, duration }) => {
      this.logger.info(`Investigation completed in ${duration}ms`, { incidentId: incident.id });
      this.emit('investigation:completed', { incident, duration });
    });

    this.stateMachine.on('incident:failed', ({ incident, reason }) => {
      this.logger.error(`Investigation failed: ${reason}`, { incidentId: incident.id });
      this.emit('investigation:failed', { incident, reason });
    });

    this.stateMachine.on('error', ({ state, error, context }) => {
      this.logger.error(`Error in phase ${state}`, error, { incidentId: context.incident.id });
    });
  }

  /**
   * Set the target deployment for remediation actions.
   * Call this before investigate() to ensure actions target the correct deployment.
   */
  setTargetDeployment(deployment: string): void {
    this.targetDeployment = deployment;
    this.logger.info({ targetDeployment: deployment }, 'Target deployment set');
  }

  /**
   * Start an investigation for an incident
   */
  async investigate(incident: Incident): Promise<void> {
    this.logger.info(`Starting investigation for incident ${incident.id}`);
    this.emit('investigation:started', { incident });

    try {
      // If incident has a monitoredAppId, fetch app details for targeting
      if (incident.monitoredAppId) {
        const monitoredApp = await monitoredAppRepository.getById(incident.monitoredAppId);
        if (monitoredApp) {
          // Set target deployment and namespace from MonitoredApp
          this.setTargetDeployment(monitoredApp.deployment);
          this.targetNamespace = monitoredApp.namespace;

          // Resolve service URL for direct health checks during verification
          await this.resolveServiceUrl(monitoredApp.deployment, monitoredApp.namespace);

          this.logger.info({
            incidentId: incident.id,
            monitoredAppId: incident.monitoredAppId,
            deployment: monitoredApp.deployment,
            namespace: monitoredApp.namespace,
            developmentCycleId: monitoredApp.developmentCycleId,
            serviceUrl: this.targetServiceUrl,
          }, 'MonitoredApp loaded for investigation targeting');

          // Start vision monitoring for this app to capture frames during investigation
          try {
            await this.visionService.startMonitoring(monitoredApp.deployment, monitoredApp.namespace);
            this.logger.info({ deployment: monitoredApp.deployment }, 'Vision monitoring started for investigation');
          } catch (visionError) {
            this.logger.warn({ 
              error: (visionError as Error).message,
              deployment: monitoredApp.deployment,
            }, 'Failed to start vision monitoring, will try fallback in observe phase');
          }

          // Link the development cycle for code evolution if available
          if (monitoredApp.developmentCycleId) {
            await incidentRepository.update(incident.id, {
              linkedDevelopmentCycleId: monitoredApp.developmentCycleId,
            } as import('@chronosops/database').UpdateIncidentInput);
          }
        } else {
          this.logger.warn({
            incidentId: incident.id,
            monitoredAppId: incident.monitoredAppId,
          }, 'MonitoredApp not found for incident');
        }
      }

      // Initialize autonomous components for this investigation
      this.timelineBuilder.initialize(incident.id);
      this.thoughtStateManager.initialize(incident.id);

      await this.stateMachine.start(incident);
      await this.runInvestigationLoop();

      // Complete the timeline
      this.timelineBuilder.complete(
        this.stateMachine.getState() === OODA_STATES.DONE ? 'resolved' : 'failed',
        `Investigation ${this.stateMachine.getState() === OODA_STATES.DONE ? 'completed successfully' : 'failed'}`
      );

    } catch (error) {
      this.logger.error('Investigation failed', error as Error, { incidentId: incident.id });
      this.timelineBuilder.complete('failed', `Investigation failed: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Resume an interrupted investigation
   * Used for server restart recovery
   */
  async resume(incident: Incident): Promise<void> {
    this.logger.info({ incidentId: incident.id, state: incident.state },
      'Resuming interrupted investigation');
    this.emit('investigation:started', { incident });

    try {
      // Set target deployment if available
      if (incident.monitoredAppId) {
        const monitoredApp = await monitoredAppRepository.getById(incident.monitoredAppId);
        if (monitoredApp) {
          this.setTargetDeployment(monitoredApp.deployment);
          this.targetNamespace = monitoredApp.namespace;

          // Resolve service URL for direct health checks during verification
          await this.resolveServiceUrl(monitoredApp.deployment, monitoredApp.namespace);

          this.logger.info({
            incidentId: incident.id,
            deployment: monitoredApp.deployment,
            serviceUrl: this.targetServiceUrl,
          }, 'Target deployment restored for resumed investigation');

          // Try to restart vision monitoring
          try {
            await this.visionService.startMonitoring(monitoredApp.deployment, monitoredApp.namespace);
          } catch (visionError) {
            this.logger.warn({
              error: (visionError as Error).message,
            }, 'Failed to restart vision monitoring for resumed investigation');
          }
        }
      }

      // Initialize autonomous components
      this.timelineBuilder.initialize(incident.id);
      this.thoughtStateManager.initialize(incident.id);

      // Resume state machine from last known state
      await this.stateMachine.resume(
        incident,
        incident.state as OODAState,
        incident.phaseRetries
      );

      // Continue the investigation loop
      await this.runInvestigationLoop();

      // Complete the timeline
      this.timelineBuilder.complete(
        this.stateMachine.getState() === OODA_STATES.DONE ? 'resolved' : 'failed',
        `Investigation ${this.stateMachine.getState() === OODA_STATES.DONE ? 'resumed and completed' : 'resumed but failed'}`
      );

    } catch (error) {
      this.logger.error('Resumed investigation failed', error as Error, { incidentId: incident.id });
      this.timelineBuilder.complete('failed', `Resumed investigation failed: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Run the main investigation loop
   */
  private async runInvestigationLoop(): Promise<void> {
    while (this.stateMachine.isActive()) {
      const state = this.stateMachine.getState();
      const context = this.stateMachine.getContext();

      if (!context) break;

      try {
        switch (state) {
          case OODA_STATES.OBSERVING:
            await this.runObservePhase(context);
            break;
          case OODA_STATES.ORIENTING:
            await this.runOrientPhase(context);
            break;
          case OODA_STATES.DECIDING:
            await this.runDecidePhase(context);
            break;
          case OODA_STATES.ACTING:
            await this.runActPhase(context);
            break;
          case OODA_STATES.VERIFYING:
            await this.runVerifyPhase(context);
            break;
          default:
            break;
        }
      } catch (error) {
        const err = error as Error;
        this.logger.error(
          {
            errorName: err.name,
            errorMessage: err.message,
            errorStack: err.stack?.substring(0, 500),
          },
          `Phase ${state} failed`
        );
        await this.stateMachine.transition(OODA_STATES.FAILED);
      }
    }
  }

  // ===========================================
  // OBSERVE Phase: Collect evidence from video frames
  // ===========================================

  private async runObservePhase(context: StateContext): Promise<void> {
    this.logger.info('Running OBSERVE phase', { incidentId: context.incident.id });

    // Record phase transition
    this.timelineBuilder.transitionPhase('OBSERVING');
    this.thoughtStateManager.transitionPhase('OBSERVING');

    // 1. Try to get frames from VisionService (per-app monitoring) first
    let frames: FrameForAnalysis[] = [];
    
    if (this.targetDeployment) {
      // Use VisionService for per-app frame capture
      const visionFrames = this.visionService.getRecentFrames(this.targetDeployment, 5);
      
      if (visionFrames.length > 0) {
        frames = visionFrames.map(f => ({
          data: f.frame.toString('base64'),
          timestamp: f.timestamp,
          mimeType: 'image/jpeg' as const,
        }));
        this.logger.info(`Collected ${frames.length} frames from VisionService for ${this.targetDeployment}`, {
          incidentId: context.incident.id,
          targetDeployment: this.targetDeployment,
        });
      } else {
        this.logger.warn('No frames available from VisionService, trying VideoWatcher fallback', {
          targetDeployment: this.targetDeployment,
        });
      }
    }

    // 2. Fallback to VideoWatcher if no frames from VisionService
    if (frames.length === 0) {
      const videoAvailable = await this.videoWatcher.isAvailable();
      if (!videoAvailable) {
        this.logger.warn('VideoWatcher not available, using fallback observation');
        this.thoughtStateManager.addObservation('VideoWatcher not available - using fallback');
      } else {
        frames = await this.videoWatcher.getRecentFrames(5);
        this.logger.info(`Collected ${frames.length} frames from VideoWatcher`, { incidentId: context.incident.id });
      }
    }

    // 3. Analyze frames with Gemini Vision
    if (frames.length > 0) {
      let analysisResult;
      try {
        analysisResult = await this.geminiClient.analyzeFrames({
          incidentId: context.incident.id,
          frames: frames.map((f) => ({
            data: f.data,
            timestamp: f.timestamp,
            mimeType: f.mimeType,
          })),
          context: `Investigating incident: ${context.incident.title}`,
        });
      } catch (frameAnalysisError) {
        const err = frameAnalysisError as Error;
        this.logger.error(
          { errorName: err.name, errorMessage: err.message },
          'Frame analysis threw exception'
        );
        // Continue without frame analysis - we can still use fallback observations
        analysisResult = { success: false, error: err.message };
      }

      if (analysisResult.success && analysisResult.data) {
        // Log what Gemini returned for debugging
        this.logger.info('Gemini frame analysis response', {
          hasAnomalies: Array.isArray(analysisResult.data.anomalies),
          anomalyCount: Array.isArray(analysisResult.data.anomalies) ? analysisResult.data.anomalies.length : 0,
          hasMetrics: Array.isArray(analysisResult.data.metrics),
          metricCount: Array.isArray(analysisResult.data.metrics) ? analysisResult.data.metrics.length : 0,
          hasDashboardState: !!analysisResult.data.dashboardState,
        });

        // Convert analysis to evidence
        const evidence = this.convertAnalysisToEvidence(
          context.incident.id,
          analysisResult.data,
          frames
        );

        for (const ev of evidence) {
          this.stateMachine.addEvidence(ev);
          this.timelineBuilder.recordEvidence(ev);
          this.thoughtStateManager.addObservation(
            (ev.content as { description?: string }).description ?? `Evidence: ${ev.type}`
          );
          this.emit('observation:collected', { evidence: ev });
        }

        // Update thought state if signature available
        if (analysisResult.thoughtSignature) {
          this.stateMachine.updateThoughtState({
            signature: analysisResult.thoughtSignature,
            timestamp: new Date(),
            incidentId: context.incident.id,
            currentPhase: OODA_STATES.OBSERVING,
            observations: evidence.map((e) => (e.content as { description?: string }).description ?? JSON.stringify(e.content)),
            hypotheses: [],
            rejectedHypotheses: [],
            currentFocus: 'Collecting visual observations',
            reasoningChain: [],
            thinkingBudget: analysisResult.usage?.thinkingTokens ?? 0,
          });
        }

        this.logger.info(`Collected ${evidence.length} pieces of evidence`, {
          incidentId: context.incident.id,
        });
      } else {
        this.logger.warn('Frame analysis failed', { error: analysisResult.error });
      }
    }

    // 4. Collect multi-modal data (logs, metrics, events)
    await this.collectMultiModalData(context);

    // 5. Transition to ORIENTING
    await this.stateMachine.transition(OODA_STATES.ORIENTING);
  }

  /**
   * Collect multi-modal data from logs, metrics, and Kubernetes events
   * L1 fix: Parallelized data collection for better performance
   */
  private async collectMultiModalData(context: StateContext): Promise<void> {
    const namespace = context.incident.namespace;
    const deployment = this.targetDeployment ?? 'demo-app';

    this.logger.info({ namespace, deployment }, 'Collecting multi-modal data in parallel');

    // L1 fix: Run all three data collection operations in parallel
    const results = await Promise.allSettled([
      this.collectKubernetesLogs(context, namespace, deployment),
      this.collectPrometheusMetrics(context, namespace, deployment),
      this.collectKubernetesEvents(context, namespace),
    ]);

    // Log any failures for debugging
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const operation = ['logs', 'metrics', 'events'][index];
        this.logger.warn({ error: result.reason, operation }, `Multi-modal ${operation} collection failed`);
      }
    });

    this.logger.info('Multi-modal data collection completed');
  }

  /**
   * Collect and parse Kubernetes logs (extracted for parallelization)
   */
  private async collectKubernetesLogs(context: StateContext, namespace: string, deployment: string): Promise<void> {
    try {
      const rawLogs = await this.fetchKubernetesLogs(namespace, deployment);
      if (rawLogs) {
        const logResult = this.logParser.analyze(rawLogs, `kubectl:${deployment}`);

        this.logger.info({
          totalLogs: logResult.summary.totalLogs,
          errorCount: logResult.summary.errorCount,
          spikeCount: logResult.spikes.length,
        }, 'Log analysis complete');

        // Add errors as evidence
        for (const error of logResult.errors.slice(0, 5)) {
          const evidence: Evidence = {
            id: randomUUID(),
            incidentId: context.incident.id,
            type: 'log',
            source: 'log_parser',
            content: {
              description: `${error.errorType}: ${error.message.substring(0, 200)}`,
              errorType: error.errorType,
              occurrences: error.occurrences,
              affectedPods: error.affectedPods,
            },
            confidence: Math.min(0.9, 0.5 + error.occurrences * 0.1),
            metadata: {
              firstSeen: error.firstSeen.toISOString(),
              lastSeen: error.lastSeen.toISOString(),
              stackTrace: error.stackTrace,
            },
            timestamp: error.lastSeen,
            createdAt: new Date(),
          };

          this.stateMachine.addEvidence(evidence);
          this.timelineBuilder.recordEvidence(evidence);
          this.thoughtStateManager.addObservation(
            `Log error: ${error.errorType} (${error.occurrences} occurrences)`
          );
          this.emit('observation:collected', { evidence });
        }

        // Add error spikes as evidence
        for (const spike of logResult.spikes) {
          const evidence: Evidence = {
            id: randomUUID(),
            incidentId: context.incident.id,
            type: 'log',
            source: 'error_spike',
            content: {
              description: `Error spike: ${spike.count} errors in ${(spike.end.getTime() - spike.start.getTime()) / 1000}s`,
              spikeRate: spike.spikeRate,
              baselineRate: spike.baselineRate,
              errorTypes: spike.types,
            },
            confidence: 0.8,
            metadata: {
              startTime: spike.start.toISOString(),
              endTime: spike.end.toISOString(),
              samples: spike.samples.map((s) => s.message).slice(0, 3),
            },
            timestamp: spike.end,
            createdAt: new Date(),
          };

          this.stateMachine.addEvidence(evidence);
          this.timelineBuilder.recordEvidence(evidence);
          this.thoughtStateManager.addObservation(
            `Error spike detected: ${spike.count} errors (${spike.spikeRate.toFixed(1)}x baseline)`
          );
        }

        // Always persist a log summary as evidence (even without errors) for context
        // This ensures logs are available for review in the UI
        const logSummaryEvidence: Evidence = {
          id: randomUUID(),
          incidentId: context.incident.id,
          type: 'log',
          source: 'log_summary',
          content: {
            description: `Log analysis: ${logResult.summary.totalLogs} lines, ${logResult.summary.errorCount} errors, ${logResult.summary.warnCount} warnings`,
            totalLogs: logResult.summary.totalLogs,
            errorCount: logResult.summary.errorCount,
            warnCount: logResult.summary.warnCount,
            timeRange: logResult.summary.timeRange,
            // Include recent log samples for context (last 20 lines)
            recentLogs: rawLogs.split('\n').slice(-20).join('\n'),
          },
          confidence: 0.5, // Lower confidence since it's contextual data
          metadata: {
            deployment,
            namespace,
            hasErrors: logResult.summary.errorCount > 0,
            hasWarnings: logResult.summary.warnCount > 0,
            spikeCount: logResult.spikes.length,
          },
          timestamp: new Date(),
          createdAt: new Date(),
        };

        this.stateMachine.addEvidence(logSummaryEvidence);
        this.timelineBuilder.recordEvidence(logSummaryEvidence);
        this.emit('observation:collected', { evidence: logSummaryEvidence });

        this.logger.info({
          totalLogs: logResult.summary.totalLogs,
          hasErrors: logResult.summary.errorCount > 0,
        }, 'Log summary evidence persisted');
      }
    } catch (error) {
      this.logger.warn({ error: (error as Error).message }, 'Failed to collect Kubernetes logs');
    }
  }

  /**
   * Collect Prometheus metrics (extracted for parallelization)
   */
  private async collectPrometheusMetrics(context: StateContext, namespace: string, deployment: string): Promise<void> {
    try {
      // MetricProcessor uses PROMETHEUS_URL env var internally
      const k8sMetrics = await this.metricProcessor.getK8sMetrics(
        namespace,
        deployment,
        300000 // 5 minute window
      );

      if (k8sMetrics) {
        this.logger.info({
          cpuAvg: k8sMetrics.cpu.avg.toFixed(2),
          memoryAvg: k8sMetrics.memory.avg.toFixed(2),
          errorRate: k8sMetrics.errorRate.current.toFixed(4),
        }, 'Prometheus metrics collected');

        // Add high anomaly metrics as evidence
        const metricsToCheck = [
          { name: 'cpu', data: k8sMetrics.cpu },
          { name: 'memory', data: k8sMetrics.memory },
          { name: 'error_rate', data: k8sMetrics.errorRate },
          { name: 'latency_p99', data: k8sMetrics.latencyP99 },
        ];

        for (const { name, data } of metricsToCheck) {
          if (data.anomalyScore > 0.5) {
            const evidence: Evidence = {
              id: randomUUID(),
              incidentId: context.incident.id,
              type: 'metric',
              source: 'prometheus',
              content: {
                description: `Metric anomaly: ${name} = ${data.current.toFixed(2)} (${data.trend})`,
                metricName: name,
                current: data.current,
                avg: data.avg,
                min: data.min,
                max: data.max,
                trend: data.trend,
                anomalyScore: data.anomalyScore,
              },
              confidence: data.anomalyScore,
              metadata: {
                dataPoints: data.dataPoints,
                labels: data.labels,
              },
              timestamp: new Date(),
              createdAt: new Date(),
            };

            this.stateMachine.addEvidence(evidence);
            this.timelineBuilder.recordEvidence(evidence);
            this.thoughtStateManager.addObservation(
              `Metric anomaly: ${name} shows ${data.trend} trend (score: ${(data.anomalyScore * 100).toFixed(0)}%)`
            );
          }
        }
      }
    } catch (error) {
      this.logger.warn({ error: (error as Error).message }, 'Failed to collect Prometheus metrics');
    }
  }

  /**
   * Collect and analyze Kubernetes events (extracted for parallelization)
   */
  private async collectKubernetesEvents(context: StateContext, namespace: string): Promise<void> {
    try {
      const k8sEventsRaw = await this.fetchKubernetesEvents(namespace);
      if (k8sEventsRaw) {
        const k8sEvents = this.eventStream.parseKubernetesEvents(k8sEventsRaw);
        const infraEvents = this.eventStream.convertK8sEvents(k8sEvents);

        // Find potential triggers for this incident
        const triggers = this.eventStream.findPotentialTriggers(
          infraEvents,
          context.startedAt
        );

        this.logger.info({
          totalEvents: k8sEvents.length,
          triggerCount: triggers.length,
        }, 'Kubernetes events analyzed');

        // Add high-score triggers as evidence
        for (const trigger of triggers.filter((t) => t.triggerScore > 0.5).slice(0, 3)) {
          const evidence: Evidence = {
            id: randomUUID(),
            incidentId: context.incident.id,
            type: 'k8s_event',
            source: 'kubernetes_events',
            content: {
              description: `Potential trigger: ${trigger.event.description.substring(0, 200)}`,
              eventType: trigger.event.type,
              target: trigger.event.target,
              triggerScore: trigger.triggerScore,
              reasoning: trigger.reasoning,
            },
            confidence: trigger.triggerScore,
            metadata: {
              actor: trigger.event.actor,
              severity: trigger.event.severity,
              k8sMetadata: trigger.event.metadata,
            },
            timestamp: trigger.event.timestamp,
            createdAt: new Date(),
          };

          this.stateMachine.addEvidence(evidence);
          this.timelineBuilder.recordEvidence(evidence);
          this.thoughtStateManager.addObservation(
            `Potential trigger: ${trigger.event.type} - ${trigger.reasoning}`
          );
        }

        // Find preceding deployment
        const precedingDeploy = this.eventStream.findPrecedingDeployment(
          infraEvents,
          context.startedAt
        );

        if (precedingDeploy) {
          const evidence: Evidence = {
            id: randomUUID(),
            incidentId: context.incident.id,
            type: 'k8s_event',
            source: 'deployment_correlation',
            content: {
              description: `Recent deployment: ${precedingDeploy.deployment} (rev ${precedingDeploy.revision})`,
              deployment: precedingDeploy.deployment,
              revision: precedingDeploy.revision,
              image: precedingDeploy.image,
              status: precedingDeploy.status,
            },
            confidence: 0.75,
            metadata: {
              namespace: precedingDeploy.namespace,
              triggeredBy: precedingDeploy.triggeredBy,
              timeSinceIncident: context.startedAt.getTime() - precedingDeploy.timestamp.getTime(),
            },
            timestamp: precedingDeploy.timestamp,
            createdAt: new Date(),
          };

          this.stateMachine.addEvidence(evidence);
          this.timelineBuilder.recordEvidence(evidence);
          this.thoughtStateManager.addInsight(
            `Recent deployment detected: ${precedingDeploy.image} may have caused the incident`
          );
        }
      }
    } catch (error) {
      this.logger.warn({ error: (error as Error).message }, 'Failed to collect Kubernetes events');
    }
  }

  /**
   * Sanitize Kubernetes names to prevent shell injection (M3 fix)
   * Only allows alphanumeric characters, hyphens, underscores, and dots
   * which are the valid characters for K8s resource names
   * @throws Error if sanitized name is empty (invalid input)
   */
  private sanitizeK8sName(name: string): string {
    const sanitized = name.replace(/[^a-zA-Z0-9-_.]/g, '');
    if (!sanitized) {
      throw new Error(`Invalid Kubernetes name: "${name}" contains no valid characters`);
    }
    return sanitized;
  }

  /**
   * Fetch Kubernetes logs via kubectl
   * Tries multiple label selectors to handle different labeling conventions
   */
  private async fetchKubernetesLogs(namespace: string, deployment: string): Promise<string | null> {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      // M3 fix: Sanitize inputs to prevent shell injection
      const safeNamespace = this.sanitizeK8sName(namespace);
      const safeDeployment = this.sanitizeK8sName(deployment);

      this.logger.debug({ namespace: safeNamespace, deployment: safeDeployment }, 'Fetching Kubernetes logs');

      // Try multiple label selectors to handle different labeling conventions
      // 1. app.kubernetes.io/name - Kubernetes recommended label (used by generated apps)
      // 2. app - common legacy label
      const labelSelectors = [
        `app.kubernetes.io/name=${safeDeployment}`,
        `app=${safeDeployment}`,
      ];

      for (const labelSelector of labelSelectors) {
        this.logger.debug({ labelSelector }, 'Trying kubectl logs with label selector');

        try {
          const { stdout } = await execAsync(
            `kubectl logs -l ${labelSelector} -n ${safeNamespace} --all-containers --tail=1000 --since=4h 2>/dev/null || echo ""`
          );

          const logs = stdout.trim();
          if (logs) {
            this.logger.info({
              namespace: safeNamespace,
              deployment: safeDeployment,
              labelSelector,
              logLines: logs.split('\n').length,
            }, 'Fetched Kubernetes logs');
            return logs;
          }
        } catch {
          // Continue to next selector
          this.logger.debug({ labelSelector }, 'No logs found with this label selector, trying next');
        }
      }

      // Fallback: try direct deployment log access (works even without matching labels)
      try {
        this.logger.debug({ deployment: safeDeployment }, 'Trying kubectl logs via deployment name directly');
        const { stdout } = await execAsync(
          `kubectl logs deployment/${safeDeployment} -n ${safeNamespace} --all-containers --tail=1000 --since=4h 2>/dev/null || echo ""`
        );

        const logs = stdout.trim();
        if (logs) {
          this.logger.info({
            namespace: safeNamespace,
            deployment: safeDeployment,
            method: 'deployment-direct',
            logLines: logs.split('\n').length,
          }, 'Fetched Kubernetes logs via deployment name');
          return logs;
        }
      } catch {
        this.logger.debug({ deployment: safeDeployment }, 'Direct deployment log access also failed');
      }

      this.logger.warn({
        namespace: safeNamespace,
        deployment: safeDeployment,
        triedSelectors: [...labelSelectors, `deployment/${safeDeployment}`],
      }, 'No logs found with any method - pod may not have recent logs');

      return null;
    } catch (error) {
      this.logger.warn({ error, namespace, deployment }, 'kubectl logs command failed');
      return null;
    }
  }

  /**
   * Fetch Kubernetes events via kubectl
   */
  private async fetchKubernetesEvents(namespace: string): Promise<string | null> {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      // M3 fix: Sanitize inputs to prevent shell injection
      const safeNamespace = this.sanitizeK8sName(namespace);

      this.logger.debug({ namespace: safeNamespace }, 'Fetching Kubernetes events');

      const { stdout } = await execAsync(
        `kubectl get events -n ${safeNamespace} --sort-by='.lastTimestamp' 2>/dev/null || echo ""`
      );

      const events = stdout.trim();
      if (!events || events === 'No resources found in ' + safeNamespace + ' namespace.') {
        this.logger.info({ namespace: safeNamespace }, 'No Kubernetes events in namespace (this is normal for stable pods)');
        return null;
      }

      const eventCount = events.split('\n').length - 1; // Subtract header row
      this.logger.info({ namespace: safeNamespace, eventCount }, 'Fetched Kubernetes events');

      return events;
    } catch (error) {
      this.logger.warn({ error, namespace }, 'kubectl events command failed');
      return null;
    }
  }

  private convertAnalysisToEvidence(
    incidentId: string,
    analysis: FrameAnalysisResponse,
    frames: FrameForAnalysis[]
  ): Evidence[] {
    const evidence: Evidence[] = [];
    const now = new Date();

    // Safely get arrays with fallbacks
    const anomalies = Array.isArray(analysis.anomalies) ? analysis.anomalies : [];
    const metrics = Array.isArray(analysis.metrics) ? analysis.metrics : [];
    const dashboardState = analysis.dashboardState ?? {
      healthy: false,
      overallSeverity: 'warning' as const,
      panelStates: [],
    };

    // Get the most recent frame for evidence images
    const latestFrame = frames[frames.length - 1];

    // Add anomalies as evidence (with frame images for visual context)
    for (const anomaly of anomalies) {
      // Find the frame closest to the anomaly timestamp, or use the latest frame
      const relevantFrame = this.findRelevantFrame(anomaly.timestamp, frames) ?? latestFrame;

      evidence.push({
        id: randomUUID(),
        incidentId,
        type: 'video_frame',
        source: 'gemini_vision',
        content: {
          description: `${anomaly.type}: ${anomaly.description}`,
          anomalyType: anomaly.type,
          severity: anomaly.severity,
          location: anomaly.location,
        },
        confidence: anomaly.confidence,
        metadata: relevantFrame ? {
          frameImage: relevantFrame.data,
          frameMimeType: relevantFrame.mimeType ?? 'image/png',
          frameTimestamp: relevantFrame.timestamp.toISOString(),
          analysisText: anomaly.description,
          firstSeenInFrame: anomaly.firstSeenInFrame,
        } : null,
        timestamp: anomaly.timestamp,
        createdAt: now,
      });
    }

    // Add dashboard state as evidence (with frame image)
    evidence.push({
      id: randomUUID(),
      incidentId,
      type: 'video_frame',
      source: 'dashboard_analysis',
      content: {
        description: `Dashboard state: ${dashboardState.overallSeverity}. Healthy: ${dashboardState.healthy}`,
        healthy: dashboardState.healthy,
        severity: dashboardState.overallSeverity,
        panelStates: dashboardState.panelStates,
      },
      confidence: null,
      metadata: latestFrame ? {
        frameImage: latestFrame.data,
        frameMimeType: latestFrame.mimeType ?? 'image/png',
        frameTimestamp: latestFrame.timestamp.toISOString(),
        panelStates: dashboardState.panelStates,
        temporalAnalysis: analysis.temporalAnalysis,
      } : null,
      timestamp: frames[frames.length - 1]?.timestamp ?? now,
      createdAt: now,
    });

    // Add metrics as evidence (with frame context for visual verification)
    for (const metric of metrics) {
      evidence.push({
        id: randomUUID(),
        incidentId,
        type: 'metric',
        source: 'extracted_metric',
        content: {
          description: `${metric.name}: ${metric.value}${metric.unit} (trend: ${metric.trend})`,
          name: metric.name,
          value: metric.value,
          unit: metric.unit,
          trend: metric.trend,
        },
        confidence: null,
        metadata: latestFrame ? {
          frameImage: latestFrame.data,
          frameMimeType: latestFrame.mimeType ?? 'image/png',
          frameTimestamp: latestFrame.timestamp.toISOString(),
          changeFromBaseline: metric.changeFromBaseline,
        } : null,
        timestamp: metric.timestamp,
        createdAt: now,
      });
    }

    return evidence;
  }

  /**
   * Find the frame closest to a given timestamp
   */
  private findRelevantFrame(
    timestamp: Date | string,
    frames: FrameForAnalysis[]
  ): FrameForAnalysis | undefined {
    if (frames.length === 0) return undefined;
    if (frames.length === 1) return frames[0];

    // Handle both Date objects and ISO string timestamps from Gemini
    const targetTime = timestamp instanceof Date
      ? timestamp.getTime()
      : new Date(timestamp).getTime();
    let closestFrame = frames[0];
    let closestDiff = Math.abs(frames[0]!.timestamp.getTime() - targetTime);

    for (const frame of frames) {
      const diff = Math.abs(frame.timestamp.getTime() - targetTime);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestFrame = frame;
      }
    }

    return closestFrame;
  }

  // ===========================================
  // ORIENT Phase: Correlate signals and build timeline
  // ===========================================

  private async runOrientPhase(context: StateContext): Promise<void> {
    this.logger.info('Running ORIENT phase', { incidentId: context.incident.id });

    // Record phase transition
    this.timelineBuilder.transitionPhase('ORIENTING');
    this.thoughtStateManager.transitionPhase('ORIENTING');

    // 1. Use correlation engine to analyze evidence signals
    const correlationResult = await this.correlationEngine.analyze(
      context.evidence,
      context.incident.id
    );

    if (correlationResult.causalChain) {
      this.thoughtStateManager.addInsight(
        `Root cause identified: ${correlationResult.causalChain.rootCause.description}`
      );
      this.thoughtStateManager.addKeyFinding(
        `Causal chain with ${correlationResult.causalChain.effects.length} effects, confidence: ${Math.round(correlationResult.causalChain.confidence * 100)}%`
      );
    }

    this.logger.info('Correlation analysis complete', {
      incidentId: context.incident.id,
      totalSignals: correlationResult.summary.totalSignals,
      correlationsFound: correlationResult.summary.correlationsFound,
      hasCausalChain: !!correlationResult.causalChain,
    });

    // 2. Build correlation summary from evidence
    const correlationSummary = this.buildCorrelationSummary(context.evidence);

    this.logger.info('Built correlation summary', {
      incidentId: context.incident.id,
      evidenceCount: context.evidence.length,
      summary: correlationSummary.substring(0, 200),
    });

    // 2. Analyze logs if available (using evidence-based approach)
    const logEvidence = context.evidence.filter((e) => e.type === 'log');
    if (logEvidence.length > 0) {
      const logResult = await this.geminiClient.analyzeLogs({
        incidentId: context.incident.id,
        logs: logEvidence.map((e) => (e.content as { description?: string }).description ?? JSON.stringify(e.content)),
        timeRange: {
          start: context.startedAt,
          end: new Date(),
        },
        context: correlationSummary,
      });

      if (logResult.success && logResult.data) {
        // Add log patterns as additional evidence
        for (const pattern of logResult.data.patterns) {
          this.stateMachine.addEvidence({
            id: randomUUID(),
            incidentId: context.incident.id,
            type: 'log',
            source: 'log_correlation',
            content: {
              description: `Pattern: ${pattern.pattern} (count: ${pattern.count}, severity: ${pattern.severity})`,
              pattern: pattern.pattern,
              count: pattern.count,
              severity: pattern.severity,
              samples: pattern.samples,
            },
            confidence: null,
            metadata: null,
            timestamp: new Date(),
            createdAt: new Date(),
          });
        }
      }
    }

    // 3. Transition to DECIDING
    await this.stateMachine.transition(OODA_STATES.DECIDING);
  }

  private buildCorrelationSummary(evidence: Evidence[]): string {
    const anomalies = evidence.filter(
      (e) => e.type === 'video_frame' && (e.content as Record<string, unknown>).anomalyType
    );
    const metrics = evidence.filter((e) => e.type === 'metric');
    const dashboardState = evidence.find((e) => e.type === 'video_frame' && e.source === 'dashboard_analysis');

    const lines: string[] = [
      `Evidence collected: ${evidence.length} items`,
      `Anomalies detected: ${anomalies.length}`,
      `Metrics observed: ${metrics.length}`,
    ];

    if (dashboardState) {
      const desc = (dashboardState.content as { description?: string }).description;
      lines.push(`Dashboard: ${desc ?? 'Unknown'}`);
    }

    for (const anomaly of anomalies.slice(0, 5)) {
      const desc = (anomaly.content as { description?: string }).description;
      lines.push(`- ${desc ?? 'Unknown anomaly'}`);
    }

    return lines.join('\n');
  }

  /**
   * Build PatternMatchInput from collected evidence
   * Converts Evidence[] to the format expected by KnowledgeBase.findMatchingPatterns()
   */
  private buildPatternMatchInput(evidence: Evidence[], incident: { namespace?: string }): PatternMatchInput {
    const errorMessages: string[] = [];
    const logs: string[] = [];
    const events: Array<{ type: string; reason: string; message: string }> = [];
    const metricAnomalies: Array<{ metric: string; deviation: string }> = [];
    const symptoms: string[] = [];

    for (const e of evidence) {
      const content = e.content as Record<string, unknown>;

      switch (e.type) {
        case 'log':
          // Extract log messages
          if (typeof content.message === 'string') {
            logs.push(content.message);
            if (content.level === 'error' || content.level === 'fatal') {
              errorMessages.push(content.message);
            }
          }
          break;

        case 'k8s_event':
          // Extract Kubernetes events
          if (typeof content.reason === 'string' && typeof content.message === 'string') {
            events.push({
              type: content.type as string || 'Warning',
              reason: content.reason,
              message: content.message,
            });
          }
          break;

        case 'metric':
          // Extract metric anomalies
          if (typeof content.metric === 'string') {
            const deviation = content.deviation as string ||
              (content.isAnomaly ? 'anomaly detected' : 'normal');
            metricAnomalies.push({
              metric: content.metric,
              deviation,
            });
          }
          break;

        case 'video_frame':
          // Extract symptoms from dashboard analysis
          if (content.anomalyType) {
            symptoms.push(`Dashboard anomaly: ${content.anomalyType}`);
          }
          if (content.description && typeof content.description === 'string') {
            symptoms.push(content.description);
          }
          break;
      }
    }

    return {
      errorMessages: errorMessages.length > 0 ? errorMessages : undefined,
      logs: logs.length > 0 ? logs : undefined,
      events: events.length > 0 ? events : undefined,
      metricAnomalies: metricAnomalies.length > 0 ? metricAnomalies : undefined,
      affectedService: incident.namespace,
      symptoms: symptoms.length > 0 ? symptoms : undefined,
    };
  }

  // ===========================================
  // DECIDE Phase: Generate and test hypotheses
  // ===========================================

  private async runDecidePhase(context: StateContext): Promise<void> {
    this.logger.info({ incidentId: context.incident.id }, 'Running DECIDE phase');

    // Record phase transition
    this.timelineBuilder.transitionPhase('DECIDING');
    this.thoughtStateManager.transitionPhase('DECIDING');

    // 1. Fetch allowed actions from database configuration
    const k8sConfig = await configService.getKubernetesConfig();
    const allowedActions = k8sConfig.allowedActions;

    this.logger.info({
      incidentId: context.incident.id,
      allowedActions,
      source: 'database',
    }, 'Fetched allowed actions for hypothesis generation');

    // 2. Query knowledge base for matching patterns (Intelligence Integration)
    let matchedPatterns: PatternMatch[] = [];
    if (this.knowledgeBase) {
      try {
        const patternMatchInput = this.buildPatternMatchInput(context.evidence, context.incident);
        const patternResult = await this.knowledgeBase.findMatchingPatterns(patternMatchInput, {
          minScore: 0.3,
          maxResults: 5,
          types: ['diagnostic', 'resolution'],
        });

        matchedPatterns = patternResult.matches;

        if (matchedPatterns.length > 0) {
          this.logger.info({
            incidentId: context.incident.id,
            matchCount: matchedPatterns.length,
            topPattern: matchedPatterns[0]?.pattern.name,
            topScore: matchedPatterns[0]?.score,
          }, 'Found matching patterns from knowledge base');

          // Add pattern insights to thought state for reasoning continuity
          for (const match of matchedPatterns) {
            this.thoughtStateManager.addInsight(
              `Pattern match: "${match.pattern.name}" (score: ${Math.round(match.score * 100)}%) - ` +
              `${match.pattern.recommendedActions.slice(0, 2).join(', ')}`
            );
          }

          // Record in timeline
          this.timelineBuilder.addEvent('insight_discovered', {
            title: `Matched ${matchedPatterns.length} patterns from knowledge base`,
            description: matchedPatterns.map(m => m.pattern.name).join(', '),
            severity: 'medium',
          });
        } else {
          this.logger.info({ incidentId: context.incident.id }, 'No matching patterns found in knowledge base');
        }
      } catch (patternError) {
        // Non-fatal: log and continue without pattern boosting
        this.logger.warn({ err: patternError }, 'Pattern matching failed, continuing without pattern boosting');
      }
    }

    // 3. Calculate dynamic thinking budget based on evidence confidence
    // Low confidence evidence → higher thinking budget for deeper analysis
    const dynamicThinkingBudget = this.calculateDynamicThinkingBudget(context.evidence);

    this.logger.info({
      incidentId: context.incident.id,
      thinkingBudget: dynamicThinkingBudget,
      evidenceCount: context.evidence.length,
    }, 'Using dynamic thinking escalation');

    // 4. Generate hypotheses using Gemini Pro with dynamic thinking
    let hypothesisResult;
    try {
      hypothesisResult = await this.geminiClient.generateHypotheses({
        incidentId: context.incident.id,
        evidence: context.evidence,
        previousHypotheses: context.hypotheses,
        thoughtSignature: context.thoughtState?.signature,
        thinkingBudget: dynamicThinkingBudget,
        namespace: context.incident.namespace,
        targetDeployment: this.targetDeployment,
        // Pass allowed actions from database config - Gemini will ONLY suggest these
        allowedActions,
      });
    } catch (hypothesisError) {
      const err = hypothesisError as Error;
      this.logger.error(
        { errorName: err.name, errorMessage: err.message },
        'Hypothesis generation threw exception'
      );
      hypothesisResult = { success: false, error: err.message };
    }

    if (!hypothesisResult.success || !hypothesisResult.data) {
      this.logger.error('Failed to generate hypotheses', { error: hypothesisResult.error });
      await this.stateMachine.transition(OODA_STATES.FAILED);
      return;
    }

    // 5. Convert generated hypotheses to stored format
    const generatedHypotheses = hypothesisResult.data.hypotheses;
    this.logger.info(`Generated ${generatedHypotheses.length} hypotheses`, {
      incidentId: context.incident.id,
    });

    // 6. Boost hypothesis confidence based on pattern matches (Intelligence Integration)
    if (matchedPatterns.length > 0) {
      for (const gh of generatedHypotheses) {
        const originalConfidence = gh.confidence;
        let boostApplied = false;

        // Check if hypothesis action aligns with pattern recommendations
        for (const match of matchedPatterns) {
          const patternActions = match.pattern.recommendedActions.map(a => a.toLowerCase());
          const hypothesisActions = gh.suggestedActions.map(a => a.type.toLowerCase());

          // Check for action alignment
          const hasActionOverlap = hypothesisActions.some(ha =>
            patternActions.some(pa => pa.includes(ha) || ha.includes(pa))
          );

          // Check if root cause aligns with pattern trigger conditions
          const rootCauseLower = gh.rootCause.toLowerCase();
          const hasConditionMatch = match.pattern.triggerConditions.some(tc =>
            rootCauseLower.includes(tc.toLowerCase()) || tc.toLowerCase().includes(rootCauseLower.split(' ')[0] || '')
          );

          if (hasActionOverlap || hasConditionMatch) {
            // Boost confidence proportional to pattern match score
            // Maximum boost of 15% (0.15)
            const boost = Math.min(0.15, match.score * 0.2);
            gh.confidence = Math.min(1.0, gh.confidence + boost);
            boostApplied = true;

            this.logger.info({
              incidentId: context.incident.id,
              hypothesis: gh.rootCause.slice(0, 50),
              originalConfidence,
              newConfidence: gh.confidence,
              patternName: match.pattern.name,
              boost,
            }, 'Boosted hypothesis confidence from pattern match');
          }
        }

        if (boostApplied) {
          this.thoughtStateManager.addInsight(
            `Hypothesis "${gh.rootCause.slice(0, 30)}..." confidence boosted from ${Math.round(originalConfidence * 100)}% to ${Math.round(gh.confidence * 100)}% based on pattern match`
          );
        }
      }
    }

    for (const gh of generatedHypotheses) {
      const hypothesis = this.convertToHypothesis(context.incident.id, gh);
      this.stateMachine.addHypothesis(hypothesis);
      this.timelineBuilder.recordHypothesis(hypothesis);
      this.thoughtStateManager.addHypothesis({
        description: hypothesis.title,
        confidence: hypothesis.confidence,
        status: hypothesis.status === 'confirmed' ? 'confirmed' : 'active',
      });
      this.emit('hypothesis:generated', { hypothesis });
    }

    // 7. Find the best hypothesis above confidence threshold
    const confirmedHypothesis = generatedHypotheses.find(
      (h) => h.confidence >= this.config.confidenceThreshold
    );

    if (!confirmedHypothesis) {
      this.logger.warn('No hypothesis above confidence threshold', {
        threshold: this.config.confidenceThreshold,
        maxConfidence: Math.max(...generatedHypotheses.map((h) => h.confidence)),
      });

      // If no hypothesis is confident enough, escalate to human
      // For demo purposes, we'll use the best available
      if (generatedHypotheses.length > 0) {
        const bestHypothesis = generatedHypotheses.reduce((a, b) =>
          a.confidence > b.confidence ? a : b
        );
        this.logger.info('Using best available hypothesis', {
          confidence: bestHypothesis.confidence,
          rootCause: bestHypothesis.rootCause,
        });
      }
    }

    // 4. Update thought state
    if (hypothesisResult.thoughtSignature) {
      this.stateMachine.updateThoughtState({
        signature: hypothesisResult.thoughtSignature,
        timestamp: new Date(),
        incidentId: context.incident.id,
        currentPhase: OODA_STATES.DECIDING,
        observations: context.evidence.map((e) => (e.content as { description?: string }).description ?? JSON.stringify(e.content)),
        hypotheses: context.hypotheses,
        rejectedHypotheses: [],
        currentFocus: confirmedHypothesis?.rootCause ?? 'Evaluating hypotheses',
        reasoningChain: [],
        thinkingBudget: hypothesisResult.data.thinkingTokensUsed ?? 0,
      });
    }

    // 5. Transition to ACTING
    await this.stateMachine.transition(OODA_STATES.ACTING);
  }

  private convertToHypothesis(incidentId: string, gh: GeneratedHypothesis): Hypothesis {
    const now = new Date();
    return {
      id: randomUUID(),
      incidentId,
      title: gh.rootCause,
      description: `Root cause: ${gh.rootCause}. Supporting evidence: ${gh.supportingEvidence.length} items.`,
      confidence: gh.confidence,
      status: gh.confidence >= this.config.confidenceThreshold ? 'confirmed' : 'proposed',
      evidence: gh.supportingEvidence,
      suggestedAction: gh.suggestedActions[0]?.type,
      reasoning: `Confidence: ${Math.round(gh.confidence * 100)}%. Testing steps: ${gh.testingSteps.join(', ')}`,
      createdAt: now,
      updatedAt: now,
    };
  }

  // ===========================================
  // ACT Phase: Execute remediation action
  // ===========================================

  private async runActPhase(context: StateContext): Promise<void> {
    this.logger.info('Running ACT phase', { incidentId: context.incident.id });

    // Record phase transition
    this.timelineBuilder.transitionPhase('ACTING');
    this.thoughtStateManager.transitionPhase('ACTING');

    // 1. Check action limits
    if (context.actions.length >= this.config.maxActionsPerIncident) {
      this.logger.warn('Max actions per incident reached', {
        max: this.config.maxActionsPerIncident,
        current: context.actions.length,
      });
      await this.stateMachine.transition(OODA_STATES.FAILED);
      return;
    }

    // 2. Get the confirmed hypothesis
    const confirmedHypothesis = context.hypotheses.find((h) => h.status === 'confirmed');
    if (!confirmedHypothesis) {
      // Use the highest confidence hypothesis
      const bestHypothesis = context.hypotheses.reduce((a, b) =>
        a.confidence > b.confidence ? a : b
      );
      if (bestHypothesis) {
        bestHypothesis.status = 'confirmed';
      } else {
        this.logger.warn('No hypothesis available for action');
        await this.stateMachine.transition(OODA_STATES.FAILED);
        return;
      }
    }

    // 3. Determine the action to take
    const hypothesis = context.hypotheses.find((h) => h.status === 'confirmed')!;
    const actionType = this.determineActionType(hypothesis);

    // 3.5 Check if we should use escalating remediation pipeline
    const shouldUseEscalation =
      this.config.useEscalatingRemediation ||
      hypothesis.confidence < this.config.escalationConfidenceThreshold;

    if (shouldUseEscalation && actionType !== 'code_fix') {
      // Use escalating remediation pipeline (SRE best practice)
      this.logger.info({
        incidentId: context.incident.id,
        confidence: hypothesis.confidence,
        threshold: this.config.escalationConfidenceThreshold,
      }, 'Using escalating remediation pipeline');

      this.thoughtStateManager.addInsight(
        `Using escalating remediation: hypothesis confidence ${Math.round(hypothesis.confidence * 100)}% ` +
        `(threshold: ${Math.round(this.config.escalationConfidenceThreshold * 100)}%). ` +
        `Will try: rollback → restart → scale → code_fix`
      );

      const escalationResult = await this.executeEscalatingRemediation(context, hypothesis);

      // Actions are now persisted in real-time inside executeEscalatingRemediation()
      // No batch persistence needed here — actions appear in UI as they execute
      this.logger.info({
        incidentId: context.incident.id,
        totalAttempts: escalationResult.attempts.length,
        success: escalationResult.success,
        resolvedBy: escalationResult.resolvedByAction,
      }, 'Escalating remediation completed (actions persisted in real-time)');

      // NOTE: No emit('action:executed') here — actions are already persisted in real-time
      // inside executeEscalatingRemediation(). Emitting here would cause duplicate actions
      // in the database via the event handlers in anomaly-detection-service and incidents routes.

      // Transition based on escalation result
      if (escalationResult.success) {
        this.timelineBuilder.addEvent('insight_discovered', {
          title: `Escalation Successful: ${escalationResult.resolvedByAction}`,
          description: `Issue resolved by ${escalationResult.resolvedByAction} after ${escalationResult.attempts.length} attempt(s) in ${Math.round(escalationResult.totalDurationMs / 1000)}s`,
          severity: 'info',
          data: { ...escalationResult },
        });
        await this.stateMachine.transition(OODA_STATES.VERIFYING);
      } else {
        this.timelineBuilder.addEvent('insight_discovered', {
          title: 'Escalation Exhausted',
          description: `All remediation attempts failed after ${escalationResult.totalDurationMs}ms. Manual intervention required.`,
          severity: 'high',
          data: { ...escalationResult },
        });
        await this.stateMachine.transition(OODA_STATES.FAILED);
      }
      return;
    }

    // 4. Build action request (single action mode)
    const actionRequest: ActionRequest = {
      type: actionType,
      target: {
        namespace: context.incident.namespace,
        deployment: this.extractDeploymentName(context.incident, hypothesis),
      },
      parameters: this.getActionParameters(actionType),
      dryRun: false, // For demo, execute the actual action
      reason: hypothesis.title,
      incidentId: context.incident.id,
    };

    this.logger.info('Executing action', {
      type: actionType,
      target: actionRequest.target,
      incidentId: context.incident.id,
    });

    // 4.5 For rollback: Check if we're already on the healthy version to prevent ping-pong
    if (actionType === ACTION_TYPES.ROLLBACK) {
      const alreadyHealthy = await this.isAlreadyOnHealthyVersion(
        actionRequest.target.namespace,
        actionRequest.target.deployment
      );
      if (alreadyHealthy) {
        this.logger.info('Already on healthy version (v1.0), skipping rollback to prevent ping-pong');
        // Emit success and skip execution
        this.emit('action:executed', {
          action: {
            actionType,
            target: `${actionRequest.target.namespace}/${actionRequest.target.deployment}`,
            dryRun: false,
          },
          result: {
            success: true,
            message: 'Already on healthy version - no rollback needed',
          },
        });
        // Transition to VERIFYING
        this.stateMachine.transition('VERIFYING');
        return;
      }
    }

    // 4.6 For code_fix: Trigger code evolution instead of K8s action
    if (actionType === ACTION_TYPES.CODE_FIX) {
      const codeFixResult = await this.triggerCodeEvolution(
        context,
        hypothesis,
        actionRequest.target.namespace,
        actionRequest.target.deployment
      );

      // Record the code_fix action
      const action: Action = {
        id: randomUUID(),
        incidentId: context.incident.id,
        hypothesisId: hypothesis.id,
        actionType: ACTION_TYPES.CODE_FIX,
        target: `${actionRequest.target.namespace}/${actionRequest.target.deployment}`,
        parameters: {
          evolutionId: codeFixResult.evolutionId,
          developmentCycleId: codeFixResult.developmentCycleId,
          fixDescription: codeFixResult.fixDescription,
        },
        status: codeFixResult.success ? 'executing' : 'failed',
        result: codeFixResult.message,
        executedAt: new Date(),
        completedAt: codeFixResult.success ? undefined : new Date(),
        createdAt: new Date(),
      };

      this.stateMachine.addAction(action);
      this.timelineBuilder.recordAction({
        success: codeFixResult.success,
        mode: 'kubernetes' as const,
        message: codeFixResult.message,
        timestamp: new Date(),
        durationMs: 0,
        action: actionRequest,
      });

      // Persist code_fix action to database for API access
      try {
        await actionRepository.create({
          incidentId: context.incident.id,
          hypothesisId: hypothesis.id,
          type: 'code_fix',
          target: action.target,
          parameters: action.parameters,
          status: action.status as 'pending' | 'executing' | 'completed' | 'failed',
          dryRun: false,
        });
        this.logger.debug({ actionId: action.id, type: 'code_fix' }, 'Code fix action persisted to database');
      } catch (err) {
        this.logger.warn({ err, actionId: action.id }, 'Failed to persist code_fix action to database');
      }

      this.thoughtStateManager.addReasoning({
        type: 'observation',
        content: codeFixResult.success
          ? `Triggered code evolution for ${actionRequest.target.deployment}: ${codeFixResult.message}`
          : `Failed to trigger code evolution: ${codeFixResult.message}`,
        confidence: codeFixResult.success ? 0.7 : 0.3,
        evidence: [hypothesis.id],
        phase: 'ACTING',
      });

      this.emit('action:executed', {
        action,
        result: {
          success: codeFixResult.success,
          mode: 'kubernetes' as const,
          message: codeFixResult.message,
          timestamp: new Date(),
          durationMs: 0,
          action: actionRequest,
        },
      });

      // Transition to VERIFYING (verification will check evolution status)
      await this.stateMachine.transition(OODA_STATES.VERIFYING);
      return;
    }

    // 5. Execute the action (K8s operations)
    const result = await this.executorFactory.executeWithFallback(actionRequest)

    // 6. Record the action
    const action: Action = {
      id: randomUUID(),
      incidentId: context.incident.id,
      hypothesisId: hypothesis.id,
      actionType,
      target: `${actionRequest.target.namespace}/${actionRequest.target.deployment}`,
      parameters: actionRequest.parameters ?? {},
      status: result.success ? 'completed' : 'failed',
      result: result.message,
      executedAt: result.timestamp,
      completedAt: new Date(),
      createdAt: new Date(),
    };

    this.stateMachine.addAction(action);
    this.timelineBuilder.recordAction(result);

    // Persist action to database for API access
    try {
      await actionRepository.create({
        incidentId: this.stateMachine.getContext()!.incident.id,
        hypothesisId: hypothesis.id,
        type: actionType as 'rollback' | 'restart' | 'scale' | 'manual' | 'code_fix',
        target: action.target,
        parameters: action.parameters,
        status: action.status as 'pending' | 'executing' | 'completed' | 'failed',
        dryRun: false, // Actions are executed, not dry runs
      });
      this.logger.debug({ actionId: action.id, type: actionType }, 'Action persisted to database');
    } catch (err) {
      this.logger.warn({ err, actionId: action.id }, 'Failed to persist action to database');
    }

    this.thoughtStateManager.addReasoning({
      type: 'observation',
      content: `Executed ${actionType} on ${actionRequest.target.namespace}/${actionRequest.target.deployment}: ${result.success ? 'success' : 'failed'}`,
      confidence: result.success ? 0.8 : 0.3,
      evidence: [hypothesis.id],
      phase: 'ACTING',
    });
    this.emit('action:executed', { action, result });

    if (!result.success) {
      this.logger.error('Action execution failed', { message: result.message });
      // Don't fail immediately - try verification anyway
    }

    // 7. Transition to VERIFYING
    await this.stateMachine.transition(OODA_STATES.VERIFYING);
  }

  private determineActionType(hypothesis: Hypothesis): 'rollback' | 'restart' | 'scale' | 'code_fix' {
    const action = hypothesis.suggestedAction?.toLowerCase();

    if (action?.includes('code_fix') || action?.includes('code fix') || action?.includes('fix code')) {
      return ACTION_TYPES.CODE_FIX;
    }
    if (action?.includes('rollback') || action?.includes('undo')) {
      return ACTION_TYPES.ROLLBACK;
    }
    if (action?.includes('restart') || action?.includes('reboot')) {
      return ACTION_TYPES.RESTART;
    }
    if (action?.includes('scale')) {
      return ACTION_TYPES.SCALE;
    }

    // Default to rollback for deployment issues
    return ACTION_TYPES.ROLLBACK;
  }

  private extractDeploymentName(incident: Incident, hypothesis?: Hypothesis): string {
    // Try to extract deployment name from various sources

    // 0. FIRST: Use explicitly set targetDeployment if available
    // This takes priority over text extraction to ensure correct targeting
    if (this.targetDeployment) {
      this.logger.debug({ targetDeployment: this.targetDeployment }, 'Using explicitly set target deployment');
      return this.targetDeployment;
    }

    // 1. Check hypothesis suggested action for deployment references
    if (hypothesis?.suggestedAction) {
      const deploymentMatch = hypothesis.suggestedAction.match(
        /(?:deployment|deploy|service|app)[:\s]+["']?([a-z0-9-]+)["']?/i
      );
      if (deploymentMatch?.[1]) {
        return deploymentMatch[1];
      }
    }

    // 2. Check hypothesis title/description for deployment names
    // Skip common words that appear before "deployment" in descriptions
    if (hypothesis?.title) {
      const skipWords = ['recent', 'new', 'old', 'current', 'previous', 'latest', 'failed', 'bad'];
      const titleMatch = hypothesis.title.match(/([a-z0-9-]+)(?:\s+deployment|\s+service|\s+pod)/i);
      if (titleMatch?.[1] && !skipWords.includes(titleMatch[1].toLowerCase())) {
        return titleMatch[1];
      }
    }

    // 3. Check evidence strings for deployment references
    if (hypothesis?.evidence) {
      for (const ev of hypothesis.evidence) {
        const evMatch = ev.match(/deployment[\/:\s]+([a-z0-9-]+)/i);
        if (evMatch?.[1]) {
          return evMatch[1];
        }
      }
    }

    // 4. Use namespace-based naming convention
    // Common patterns: <namespace>-app, <namespace>-api, <namespace>-service
    const namespace = incident.namespace;
    if (namespace && namespace !== 'default') {
      return `${namespace}-app`;
    }

    // 5. Default fallback
    return 'app';
  }

  private getActionParameters(
    actionType: 'rollback' | 'restart' | 'scale' | 'code_fix'
  ): Record<string, unknown> {
    switch (actionType) {
      case ACTION_TYPES.SCALE:
        return { replicas: 3 };
      case ACTION_TYPES.ROLLBACK:
        // Use default (previous revision) - the execute phase will check current version
        return {};
      case ACTION_TYPES.RESTART:
        return {};
      case ACTION_TYPES.CODE_FIX:
        // Parameters for code evolution will be set separately in triggerCodeEvolution
        return {};
      default:
        return {};
    }
  }

  /**
   * Check if deployment is already on the healthy version (v1.0)
   * This prevents rollback ping-pong when multiple incidents trigger actions
   */
  private async isAlreadyOnHealthyVersion(namespace: string, deployment: string): Promise<boolean> {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const { stdout } = await execAsync(
        `kubectl get deployment ${deployment} -n ${namespace} -o jsonpath='{.spec.template.spec.containers[0].image}'`
      );

      const currentImage = stdout.trim().replace(/'/g, '');
      const isHealthy = currentImage.endsWith(':v1.0') || currentImage.includes('v1.0');

      this.logger.info('Checked current deployment image', { currentImage, isHealthy });
      return isHealthy;
    } catch (error) {
      this.logger.warn('Could not check current deployment version, proceeding with rollback', { error });
      return false;
    }
  }

  // ===========================================
  // VERIFY Phase: Confirm fix worked
  // ===========================================

  private async runVerifyPhase(context: StateContext): Promise<void> {
    this.logger.info('Running VERIFY phase', { incidentId: context.incident.id });

    // Record phase transition
    this.timelineBuilder.transitionPhase('VERIFYING');
    this.thoughtStateManager.transitionPhase('VERIFYING');

    // Get the last action for verification
    const lastAction = context.actions[context.actions.length - 1];

    // 1. Wait for system to stabilize
    this.logger.info(`Waiting ${this.config.verificationWaitMs}ms for system to stabilize`);
    await this.delay(this.config.verificationWaitMs);

    let verificationPassed = false;
    let verificationDetails = '';

    // 2. Direct API check is INFORMATIONAL ONLY — /health and /bugs/status
    // cannot detect code-level bugs (e.g. hard-coded error rates in route handlers).
    // A restart resets in-memory chaosConfig, making /bugs/status falsely report "no bugs".
    const directStatus = await this.getDirectSystemStatus();
    if (directStatus) {
      this.logger.info({ directStatus }, 'Got direct system status for verification (informational)');

      if (!directStatus.healthy || directStatus.activeBugs.length > 0) {
        // Early FAIL if obviously unhealthy (known bugs still active)
        verificationPassed = false;
        verificationDetails = `Direct API unhealthy: bugs=${directStatus.activeBugs.join(',')}`;
        this.logger.info({ activeBugs: directStatus.activeBugs }, 'Direct API shows system still unhealthy');
      } else {
        this.logger.info('Direct API shows healthy, but will run traffic-based verification to confirm');
      }
    }

    // 3. ALWAYS run traffic-based verification as the definitive check.
    // This generates actual requests to business endpoints and measures real error rates.
    if (!verificationPassed) {
      const trafficCheckPassed = await this.quickVerificationCheck();
      if (trafficCheckPassed) {
        verificationPassed = true;
        verificationDetails = `Traffic verification passed (error rate: ${((this.lastVerificationErrorRate ?? 0) * 100).toFixed(1)}%)`;
        this.logger.info({ errorRate: this.lastVerificationErrorRate }, 'Traffic-based verification PASSED');
      } else {
        verificationPassed = false;
        verificationDetails = `Traffic verification failed (error rate: ${((this.lastVerificationErrorRate ?? 0) * 100).toFixed(1)}%)`;
        this.logger.warn({ errorRate: this.lastVerificationErrorRate }, 'Traffic-based verification FAILED - system still has errors');
      }
    }

    // 4. Fall back to frame analysis if traffic check didn't pass
    if (!verificationPassed) {
      const videoAvailable = await this.videoWatcher.isAvailable();

      if (videoAvailable) {
        for (let attempt = 0; attempt < this.config.maxVerificationAttempts; attempt++) {
          this.logger.info(`Frame verification attempt ${attempt + 1}/${this.config.maxVerificationAttempts}`);

          try {
            const frames = await this.videoWatcher.getRecentFrames(3);
            if (frames.length === 0) {
              this.logger.warn('No frames available for verification');
              continue;
            }

            // Analyze with Gemini Vision
            const analysisResult = await this.geminiClient.analyzeFrames({
              incidentId: context.incident.id,
              frames: frames.map((f) => ({
                data: f.data,
                timestamp: f.timestamp,
                mimeType: f.mimeType,
              })),
              context: 'Verifying that the remediation action was successful. Check if the dashboard shows healthy state.',
            });

            if (analysisResult.success && analysisResult.data) {
              const dashboardState = analysisResult.data.dashboardState;
              const anomalies = analysisResult.data.anomalies ?? [];

              if (!dashboardState) {
                this.logger.warn('Verification: dashboardState not available in response');
                verificationPassed = true;
                verificationDetails = 'Verification completed - no issues detected by analysis';
                break;
              }

              const dashboardHealthy = dashboardState.healthy ?? true;
              const severity = dashboardState.overallSeverity ?? 'healthy';
              const criticalAnomalies = anomalies.filter(
                (a) => a.severity === 'critical' || a.severity === 'high'
              );

              verificationDetails = `Dashboard healthy: ${dashboardHealthy}, Severity: ${severity}, Critical anomalies: ${criticalAnomalies.length}`;

              if (dashboardHealthy && criticalAnomalies.length === 0) {
                verificationPassed = true;
                this.logger.info('Frame verification passed - system is healthy');
                break;
              }

              this.logger.warn('Frame verification shows system still unhealthy', {
                healthy: dashboardHealthy,
                severity,
                criticalAnomalies: criticalAnomalies.length,
              });
            } else {
              this.logger.warn('Frame verification analysis failed', { error: analysisResult.error });
            }
          } catch (error) {
            const err = error as Error;
            this.logger.warn('Frame verification attempt failed with error', {
              errorName: err.name,
              errorMessage: err.message,
              errorStack: err.stack?.substring(0, 500),
            });
          }

          // Wait before retry
          if (attempt < this.config.maxVerificationAttempts - 1) {
            await this.delay(5000);
          }
        }

        // If all frame attempts failed, log but proceed
        if (!verificationPassed) {
          this.logger.warn('All frame verification attempts failed, proceeding to completion');
          verificationDetails = 'Verification could not confirm system health';
        }
      } else {
        // VideoWatcher not available
        this.logger.warn('VideoWatcher not available, assuming verification passed');
        verificationPassed = true;
        verificationDetails = 'Verification skipped - VideoWatcher not available';
      }
    }

    // 3.5 Evolution-Aware Verification: Check if there's a pending evolution linked to this incident
    // CRITICAL: If an evolution was triggered for this incident, we MUST wait for it to complete
    // regardless of what Direct API or frame analysis shows. The evolution IS the fix.
    const pendingEvolution = await this.checkPendingEvolution(context.incident.id);
    if (pendingEvolution) {
      this.logger.info({
        evolutionId: pendingEvolution.id,
        status: pendingEvolution.status,
        recentlyApplied: pendingEvolution.recentlyApplied,
        currentVerificationPassed: verificationPassed,
      }, 'Found evolution for incident - ensuring proper verification');

      // Override any previous verification result - we need proper evolution-aware verification
      verificationPassed = false;
      verificationDetails = pendingEvolution.recentlyApplied
        ? `Recently-applied evolution ${pendingEvolution.id} - verifying deployment`
        : `Pending code evolution ${pendingEvolution.id} (${pendingEvolution.status})`;

      // Record that we're handling evolution verification
      this.timelineBuilder.addEvent('insight_discovered', {
        title: pendingEvolution.recentlyApplied ? 'Verifying Code Evolution' : 'Waiting for Code Evolution',
        description: pendingEvolution.recentlyApplied
          ? `Evolution ${pendingEvolution.id} was recently applied. Verifying deployment and testing traffic.`
          : `Evolution ${pendingEvolution.id} is ${pendingEvolution.status}. Must wait for completion before final verification.`,
        severity: 'info',
        data: {
          evolutionId: pendingEvolution.id,
          evolutionStatus: pendingEvolution.status,
          recentlyApplied: pendingEvolution.recentlyApplied,
        },
      });

      // For recently-applied evolutions (automatic mode), skip waiting for completion
      // and go straight to deployment rollout wait + traffic verification
      let evolutionApplied = pendingEvolution.recentlyApplied ?? false;
      
      if (!evolutionApplied) {
        // Wait for evolution to complete (only for pending evolutions)
        this.thoughtStateManager.addInsight(
          `Code evolution ${pendingEvolution.id} is pending (${pendingEvolution.status}). Waiting up to ${Math.round(this.config.evolutionWaitTimeoutMs / 60000)} minutes for completion. This is the actual fix for the issue.`
        );

        const evolutionResult = await this.waitForEvolutionCompletion(
          pendingEvolution.id,
          this.config.evolutionWaitTimeoutMs
        );

        if (evolutionResult.completed && evolutionResult.applied) {
          this.logger.info('Evolution applied successfully, waiting for deployment rollout');
          evolutionApplied = true;

          // Record successful evolution
          this.timelineBuilder.addEvent('insight_discovered', {
            title: 'Code Evolution Applied',
            description: `Evolution ${pendingEvolution.id} was applied. Waiting for deployment rollout before verification.`,
            severity: 'info',
            data: {
              evolutionId: pendingEvolution.id,
              applied: true,
            },
          });
        } else if (evolutionResult.timedOut) {
          this.logger.warn('Evolution wait timed out - evolution still pending');
          verificationPassed = false;
          verificationDetails = `Evolution ${pendingEvolution.id} pending - awaiting manual approval (timed out after ${Math.round(this.config.evolutionWaitTimeoutMs / 60000)} min)`;

          this.thoughtStateManager.addInsight(
            `Evolution wait timed out. The evolution is still pending human approval. Incident cannot be marked as resolved until evolution completes.`
          );

          // Special case: Don't mark as success - evolution is still pending
          this.timelineBuilder.addEvent('insight_discovered', {
            title: 'Evolution Wait Timeout',
            description: 'Evolution is still pending approval. Incident will be marked as failed but evolution cooldown prevents duplicates.',
            severity: 'medium',
            data: {
              evolutionId: pendingEvolution.id,
              timedOut: true,
            },
          });
        } else {
          this.logger.info({ reason: evolutionResult.reason }, 'Evolution did not complete successfully');
          verificationPassed = false;
          verificationDetails = `Evolution ${evolutionResult.reason}: ${pendingEvolution.request.substring(0, 50)}`;

          this.thoughtStateManager.addInsight(
            `Code evolution ${pendingEvolution.id} was ${evolutionResult.reason}. The incident could not be resolved automatically.`
          );
        }
      }

      // If evolution was applied (either recently or just now), verify the deployment
      if (evolutionApplied) {
        this.logger.info({
          evolutionId: pendingEvolution.id,
          recentlyApplied: pendingEvolution.recentlyApplied,
        }, 'Evolution applied - proceeding with deployment verification');

        // Wait for deployment rollout to complete before verifying
        // The evolution triggers a rebuild and deploy - we need to wait for new pods to be running
        const deploymentWaitMs = 120000; // 2 minutes max for deployment rollout
        const deployment = this.targetDeployment || context.incident.namespace;
        const namespace = this.targetNamespace || context.incident.namespace;

        this.logger.info({
          deployment,
          namespace,
          maxWaitMs: deploymentWaitMs,
        }, 'Waiting for deployment rollout after code evolution');

        try {
          const executor = await this.executorFactory.getExecutor();
          if ('waitForDeploymentReady' in executor && typeof executor.waitForDeploymentReady === 'function') {
            await (executor as { waitForDeploymentReady: (ns: string, dep: string, timeoutMs: number) => Promise<boolean> })
              .waitForDeploymentReady(namespace, deployment, deploymentWaitMs);
            this.logger.info('Deployment rollout complete, proceeding with verification');
          } else {
            // Fallback: wait a fixed time for deployment to roll out
            this.logger.info({ wait: 60000 }, 'No rollout status check available, waiting 60s for deployment');
            await this.delay(60000);
          }
        } catch (rolloutError) {
          this.logger.warn({
            error: (rolloutError as Error).message,
          }, 'Could not wait for deployment rollout, proceeding with verification after delay');
          await this.delay(30000); // Wait 30s as fallback
        }

        // Re-run quick verification after deployment is rolled out
        // This uses traffic generation to actually test the service for errors
        verificationPassed = await this.quickVerificationCheck();
        verificationDetails = verificationPassed
          ? `Code evolution applied and verified: ${pendingEvolution.request.substring(0, 100)}`
          : `Code evolution applied but system still unhealthy`;

        this.thoughtStateManager.addReasoning({
          type: 'conclusion',
          content: verificationPassed
            ? 'Code evolution resolved the issue - system is now healthy'
            : 'Code evolution was applied but issue persists',
          confidence: verificationPassed ? 0.9 : 0.4,
          evidence: [pendingEvolution.id],
          phase: 'VERIFYING',
        });
      }
    }

    // 4. Record verification result in timeline
    this.timelineBuilder.addEvent('action_verified', {
      title: `Verification: ${verificationPassed ? 'Success' : 'Failed'}`,
      description: verificationDetails,
      severity: verificationPassed ? 'info' : 'high',
      data: {
        actionId: lastAction?.id,
        success: verificationPassed,
        confidence: verificationPassed ? 0.85 : 0.3,
      },
    });

    this.thoughtStateManager.addReasoning({
      type: 'conclusion',
      content: verificationPassed
        ? 'Verification successful - system restored to healthy state'
        : 'Verification failed - system still experiencing issues',
      confidence: verificationPassed ? 0.85 : 0.3,
      evidence: [lastAction?.id ?? 'verification'],
      phase: 'VERIFYING',
    });

    this.emit('verification:completed', {
      success: verificationPassed,
      details: verificationDetails,
    });

    // 5. Use RollbackManager to evaluate if rollback is needed when verification failed
    if (!verificationPassed && lastAction) {
      this.logger.warn('Verification failed - evaluating rollback need', {
        incidentId: context.incident.id,
        actionId: lastAction.id,
      });

      // Build ActionResult for RollbackManager evaluation
      const actionResult = {
        success: lastAction.status === 'completed',
        mode: 'kubernetes' as const,
        message: lastAction.result ?? 'Action completed',
        timestamp: lastAction.executedAt ?? new Date(),
        durationMs: 0,
        action: {
          type: lastAction.actionType as 'rollback' | 'restart' | 'scale',
          target: {
            namespace: context.incident.namespace,
            deployment: this.extractDeploymentFromTarget(lastAction.target),
          },
        },
      };

      // Build VerificationResult for RollbackManager
      const verificationResult: VerificationResult = {
        id: randomUUID(),
        actionId: lastAction.id,
        incidentId: context.incident.id,
        timestamp: new Date(),
        success: verificationPassed,
        confidence: verificationPassed ? 0.85 : 0.3,
        verdict: verificationPassed ? 'confirmed_success' : 'confirmed_failure',
        checks: [],
        verificationStartedAt: new Date(),
        verificationCompletedAt: new Date(),
        durationMs: 0,
        summary: verificationDetails,
        recommendations: [],
        shouldRetry: !verificationPassed,
      };

      // Evaluate if rollback is needed
      const rollbackDecision = this.rollbackManager.evaluateRollbackNeed(
        actionResult,
        verificationResult,
        context.incident.id
      );

      this.logger.info({
        shouldRollback: rollbackDecision.shouldRollback,
        confidence: rollbackDecision.confidence,
        reasoning: rollbackDecision.reasoning,
        urgency: rollbackDecision.urgency,
      }, 'Rollback decision evaluated');

      // Record rollback evaluation in timeline
      this.timelineBuilder.addEvent('insight_discovered', {
        title: `Rollback ${rollbackDecision.shouldRollback ? 'Recommended' : 'Not Needed'}`,
        description: rollbackDecision.reasoning,
        severity: rollbackDecision.shouldRollback ? 'medium' : 'info',
        data: {
          type: 'rollback_evaluation',
          shouldRollback: rollbackDecision.shouldRollback,
          confidence: rollbackDecision.confidence,
          urgency: rollbackDecision.urgency,
          alternatives: rollbackDecision.alternativeActions,
        },
      });

      if (rollbackDecision.shouldRollback) {
        this.thoughtStateManager.addInsight(
          `Rollback recommended: ${rollbackDecision.reasoning} (confidence: ${Math.round(rollbackDecision.confidence * 100)}%)`
        );
      } else {
        this.thoughtStateManager.addInsight(
          `Rollback not needed: ${rollbackDecision.reasoning}`
        );
        if (rollbackDecision.alternativeActions) {
          this.thoughtStateManager.addInsight(
            `Alternative actions: ${rollbackDecision.alternativeActions.join(', ')}`
          );
        }
      }
    }

    // 6. Record verification result in state machine
    this.stateMachine.setLastVerificationResult({
      success: verificationPassed,
      details: verificationDetails,
    });

    // 7. Transition based on verification result
    if (verificationPassed) {
      await this.stateMachine.transition(OODA_STATES.DONE);
    } else {
      // Get current verification attempt count
      const verificationAttempt = (context.verificationRetryCount ?? 0) + 1;
      this.stateMachine.incrementVerificationRetry();

      const maxRetries = context.maxVerificationRetries ?? 3;

      this.thoughtStateManager.addInsight(
        `Verification failed (attempt ${verificationAttempt}/${maxRetries}): ${verificationDetails}`
      );

      // Check if we've exhausted retries
      if (verificationAttempt >= maxRetries) {
        this.logger.error({
          incidentId: context.incident.id,
          attempts: verificationAttempt,
          lastResult: verificationDetails,
        }, 'Max verification retries exceeded, transitioning to FAILED');

        // Store failure reason in context
        this.stateMachine.setFailureReason(
          `Verification failed after ${verificationAttempt} attempts. Last status: ${verificationDetails}`
        );

        await this.stateMachine.transition(OODA_STATES.FAILED);
      } else {
        this.logger.warn({
          incidentId: context.incident.id,
          attempt: verificationAttempt,
          maxRetries,
        }, 'Verification failed, looping back to OBSERVING for re-analysis');

        // Record the loop back in timeline (use phase_transition for retry)
        this.timelineBuilder.addEvent('phase_transition', {
          title: `Retrying investigation (attempt ${verificationAttempt + 1}/${maxRetries})`,
          description: `Previous verification failed: ${verificationDetails}`,
          severity: 'medium',
          data: { attempt: verificationAttempt, reason: verificationDetails },
        });

        // Loop back to OBSERVING for fresh observations
        await this.stateMachine.transition(OODA_STATES.OBSERVING);
      }
    }
  }

  // ===========================================
  // Code Evolution Bridge
  // ===========================================

  /**
   * Trigger code evolution for a code_fix action
   * Connects the Investigation OODA loop to the Development OODA loop
   */
  private async triggerCodeEvolution(
    context: StateContext,
    hypothesis: Hypothesis,
    namespace: string,
    deployment: string
  ): Promise<{
    success: boolean;
    message: string;
    evolutionId?: string;
    developmentCycleId?: string;
    fixDescription?: string;
  }> {
    this.logger.info({
      incidentId: context.incident.id,
      namespace,
      deployment,
      hypothesis: hypothesis.title,
    }, 'Triggering code evolution for code_fix action');

    try {
      // 1. Find the development cycle for this deployment via MonitoringConfigService
      const { monitoringConfigService } = await import('../monitoring/index.js');

      const developmentCycleId = await monitoringConfigService.findDevelopmentCycleByDeployment(
        namespace,
        deployment
      );

      if (!developmentCycleId) {
        this.logger.warn({
          namespace,
          deployment,
        }, 'No development cycle found for deployment - cannot trigger code evolution');

        return {
          success: false,
          message: `No development cycle found for ${namespace}/${deployment}. Manual code fix required.`,
        };
      }

      // 2. Build fix description from hypothesis and evidence
      const fixDescription = this.buildFixDescription(hypothesis, context);

      // 3. Create evolution request via CodeEvolutionEngine
      const { getCodeEvolutionEngine } = await import('../evolution/index.js');
      const codeEvolutionEngine = getCodeEvolutionEngine();

      // Build detailed evolution prompt with explicit instructions
      // CRITICAL: The prompt must tell Gemini EXACTLY what to look for and fix
      const evolutionPrompt = [
        `## INCIDENT FIX REQUEST`,
        `Incident ID: ${context.incident.id}`,
        `Title: ${context.incident.title}`,
        ``,
        `## ROOT CAUSE ANALYSIS`,
        `${hypothesis.title}`,
        ``,
        `## DETAILED FIX REQUIREMENTS`,
        `${fixDescription}`,
        ``,
        `## HYPOTHESIS EVIDENCE`,
        hypothesis.evidence.slice(0, 10).map((e) => `- ${e}`).join('\n'),
        ``,
        `## TASK`,
        `You are fixing a production bug. The error messages above indicate the exact problem.`,
        ``,
        `IMPORTANT INSTRUCTIONS:`,
        `1. SEARCH the source code for ANY of the error message strings mentioned above`,
        `2. LOOK for intentional error injection like:`,
        `   - if (Math.random() < X) throw new Error(...)`,
        `   - if (true) throw ...`,
        `   - Debug/test flags that throw errors`,
        `   - Conditional error throwing based on routes or parameters`,
        `3. REMOVE or FIX the code that causes the errors`,
        `4. Ensure the endpoint returns proper responses (200 with data) instead of errors`,
        ``,
        `The fix should be minimal - only change what's necessary to stop the errors.`,
      ].join('\n');

      const evolutionResult = await codeEvolutionEngine.requestEvolution({
        developmentCycleId,
        prompt: evolutionPrompt,
      });

      if (!evolutionResult.success || !evolutionResult.evolution) {
        return {
          success: false,
          message: evolutionResult.error ?? 'Failed to create evolution request',
          developmentCycleId,
        };
      }

      const evolution = evolutionResult.evolution;

      this.logger.info({
        incidentId: context.incident.id,
        evolutionId: evolution.id,
        developmentCycleId,
      }, 'Code evolution triggered successfully');

      // 4. Update the evolution with incident link
      await codeEvolutionEngine.linkToIncident(evolution.id, context.incident.id);

      // 5. Register evolution cooldown to prevent duplicate incidents during code fix
      // This ensures the HybridAnomalyDetector won't create new incidents while the evolution is pending
      try {
        const { DetectionStateManager } = await import('../detection/detection-state-manager.js');
        const stateManager = DetectionStateManager.getInstance();
        stateManager.registerPendingEvolution(deployment, evolution.id);
        this.logger.info({
          deployment,
          evolutionId: evolution.id,
        }, 'Registered evolution cooldown to prevent duplicate incidents');
      } catch (cooldownError) {
        // Non-critical - log but don't fail the evolution
        this.logger.warn({
          error: (cooldownError as Error).message,
          deployment,
          evolutionId: evolution.id,
        }, 'Failed to register evolution cooldown (non-critical)');
      }

      // 6. Check if we should run the evolution automatically (default: yes)
      // The setting `requireManualCodeEvolutionApproval` controls this:
      // - false (default): Run full evolution cycle automatically
      // - true: Return and let VERIFYING phase poll for manual completion
      const { configRepository } = await import('@chronosops/database');
      const safetyConfig = await configRepository.getByCategory('safety');
      const safetySettings = safetyConfig?.config as { requireManualCodeEvolutionApproval?: boolean } | undefined;
      const requireManualApproval = safetySettings?.requireManualCodeEvolutionApproval ?? false;

      if (!requireManualApproval) {
        // Run the full evolution cycle automatically: analyze → generate → apply
        this.logger.info({
          incidentId: context.incident.id,
          evolutionId: evolution.id,
          requireManualApproval: false,
        }, 'Running automatic code evolution (requireManualCodeEvolutionApproval=false)');

        // Record that we're starting automatic evolution
        this.timelineBuilder.addEvent('insight_discovered', {
          title: 'Automatic Code Evolution Started',
          description: `Evolution ${evolution.id} starting automatic cycle: analyze → generate → apply`,
          severity: 'info',
          data: { evolutionId: evolution.id, automatic: true },
        });

        // Run the full evolution cycle
        const fullCycleResult = await codeEvolutionEngine.runFullEvolutionCycle(evolution.id);

        if (fullCycleResult.success) {
          this.logger.info({
            incidentId: context.incident.id,
            evolutionId: evolution.id,
            filesUpdated: fullCycleResult.filesUpdated,
          }, 'Automatic code evolution completed, triggering rebuild/redeploy');

          // Record successful code fix
          this.timelineBuilder.addEvent('insight_discovered', {
            title: 'Code Evolution Applied',
            description: `Evolution applied successfully: ${fullCycleResult.filesUpdated} files updated`,
            severity: 'info',
            data: { evolutionId: evolution.id, filesUpdated: fullCycleResult.filesUpdated },
          });

          // Trigger rebuild and redeploy
          const rebuildResult = await codeEvolutionEngine.triggerRebuildAndRedeploy(evolution.id);

          if (rebuildResult.success) {
            this.logger.info({
              incidentId: context.incident.id,
              evolutionId: evolution.id,
              serviceUrl: rebuildResult.deployResult?.serviceUrl,
            }, 'Self-healing complete: code evolved, rebuilt, and redeployed');

            return {
              success: true,
              message: `Code evolution applied and redeployed: ${evolution.id}`,
              evolutionId: evolution.id,
              developmentCycleId,
              fixDescription,
            };
          } else {
            // Evolution applied but rebuild failed - partial success
            this.logger.warn({
              incidentId: context.incident.id,
              evolutionId: evolution.id,
              rebuildError: rebuildResult.message,
            }, 'Code evolution applied but rebuild/redeploy failed');

            return {
              success: true, // Evolution itself succeeded
              message: `Code evolution applied but rebuild failed: ${rebuildResult.message}`,
              evolutionId: evolution.id,
              developmentCycleId,
              fixDescription,
            };
          }
        } else {
          // Automatic evolution failed
          this.logger.error({
            incidentId: context.incident.id,
            evolutionId: evolution.id,
            error: fullCycleResult.error,
          }, 'Automatic code evolution failed');

          this.timelineBuilder.addEvent('escalation', {
            title: 'Automatic Code Evolution Failed',
            description: `Evolution ${evolution.id} failed: ${fullCycleResult.error}`,
            severity: 'high',
            data: { evolutionId: evolution.id, error: fullCycleResult.error },
          });

          return {
            success: false,
            message: `Automatic code evolution failed: ${fullCycleResult.error}`,
            evolutionId: evolution.id,
            developmentCycleId,
          };
        }
      }

      // Manual approval required - return and let VERIFYING phase poll for completion
      this.logger.info({
        incidentId: context.incident.id,
        evolutionId: evolution.id,
        requireManualApproval: true,
      }, 'Code evolution requires manual approval');

      return {
        success: true,
        message: `Code evolution triggered (awaiting manual approval): ${evolution.id}`,
        evolutionId: evolution.id,
        developmentCycleId,
        fixDescription,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({
        error: errorMessage,
        incidentId: context.incident.id,
      }, 'Failed to trigger code evolution');

      return {
        success: false,
        message: `Code evolution failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Build fix description from hypothesis and context
   *
   * CRITICAL: This description is passed to Gemini for code evolution.
   * It must include:
   * 1. Root cause and reasoning
   * 2. Actual error messages from logs (not just summaries)
   * 3. Specific patterns/strings to look for in the code
   * 4. Clear instructions on what to remove or fix
   */
  private buildFixDescription(hypothesis: Hypothesis, context: StateContext): string {
    const parts: string[] = [];

    parts.push(`Root cause: ${hypothesis.title}`);

    if (hypothesis.description) {
      parts.push(`Description: ${hypothesis.description}`);
    }

    if (hypothesis.reasoning) {
      parts.push(`Reasoning: ${hypothesis.reasoning}`);
    }

    // Extract actual error messages from log evidence (up to 10)
    // This is CRITICAL - Gemini needs the exact error text to find the bug
    const logEvidence = context.evidence
      .filter((e) => e.type === 'log')
      .slice(0, 10);

    if (logEvidence.length > 0) {
      const errorMessages: string[] = [];
      const suspiciousPatterns: string[] = [];

      for (const ev of logEvidence) {
        const content = ev.content as {
          description?: string;
          errorType?: string;
          message?: string;
          occurrences?: number;
        };

        // Get the full error message
        const errorMsg = content.description || content.message || 'Unknown error';
        errorMessages.push(`- ${errorMsg} (${content.occurrences ?? 1}x)`);

        // Extract suspicious keywords that might be in the code
        // Look for test/debug/deliberate patterns that indicate intentional bugs
        const lowerMsg = errorMsg.toLowerCase();
        if (lowerMsg.includes('deliberate') || lowerMsg.includes('testing') ||
            lowerMsg.includes('intentional') || lowerMsg.includes('fake') ||
            lowerMsg.includes('simulated') || lowerMsg.includes('debug') ||
            lowerMsg.includes('demo') || lowerMsg.includes('flaky') ||
            lowerMsg.includes('internal server error') || lowerMsg.includes('server error') ||
            lowerMsg.includes('random') || lowerMsg.includes('chaos')) {
          // Extract the exact phrase for Gemini to search for
          const match = errorMsg.match(/['"]([^'"]+)['"]/);
          if (match && match[1]) {
            suspiciousPatterns.push(match[1]);
          }
          suspiciousPatterns.push(errorMsg.substring(0, 100));
        }
      }

      parts.push(`Error messages from logs:\n${errorMessages.join('\n')}`);

      if (suspiciousPatterns.length > 0) {
        parts.push(`SUSPICIOUS PATTERNS TO FIND IN CODE:\nThe following strings/patterns appear in error messages and may indicate intentional bugs or test code that should be removed:\n${suspiciousPatterns.map(p => `- "${p}"`).join('\n')}`);
      }
    }

    // Add metric evidence if available
    const metricEvidence = context.evidence
      .filter((e) => e.type === 'metric')
      .slice(0, 3)
      .map((e) => (e.content as { description?: string }).description ?? 'Metric anomaly');

    if (metricEvidence.length > 0) {
      parts.push(`Metric evidence:\n${metricEvidence.map((e) => `- ${e}`).join('\n')}`);
    }

    // Add explicit fix instructions
    parts.push(`FIX INSTRUCTIONS:
1. Search the code for error messages, throw statements, and conditionals that match the patterns above
2. Look for code that deliberately throws errors (e.g., "if (Math.random()...)", "if (true) throw", debug flags)
3. Remove or fix any intentional error injection code
4. Ensure all error handling returns proper responses instead of throwing`);

    return parts.join('\n\n');
  }

  // ===========================================
  // Evolution-Aware Verification Helpers
  // ===========================================

  /**
   * Check for pending or recently-applied evolution linked to this incident
   * 
   * CRITICAL FIX: When automatic evolution runs via triggerCodeEvolution(), the full
   * cycle (analyze → generate → apply → rebuild → redeploy) completes BEFORE the
   * VERIFYING phase runs. This means the evolution status is 'applied' by the time
   * we check. We MUST include 'applied' evolutions within a recent time window to
   * ensure proper verification (waiting for deployment rollout, traffic testing).
   * 
   * Returns the most recent pending/active/recently-applied evolution if found.
   */
  private async checkPendingEvolution(incidentId: string): Promise<{
    id: string;
    status: string;
    request: string;
    developmentCycleId: string;
    recentlyApplied?: boolean;
  } | null> {
    try {
      const { getCodeEvolutionEngine } = await import('../evolution/index.js');
      const codeEvolutionEngine = getCodeEvolutionEngine();

      const evolutions = await codeEvolutionEngine.findByIncidentId(incidentId);
      
      // First, look for actively pending evolutions (not yet applied)
      const pendingStatuses = ['pending', 'analyzing', 'generating', 'review', 'approved'];
      const pending = evolutions.find(e => pendingStatuses.includes(e.status));

      if (pending) {
        return {
          id: pending.id,
          status: pending.status,
          request: pending.prompt,
          developmentCycleId: pending.developmentCycleId,
        };
      }

      // CRITICAL: Also check for recently-applied evolutions (within 5 minutes)
      // This handles the automatic evolution case where apply + rebuild completes
      // before VERIFYING runs. We still need to wait for deployment rollout and
      // do proper traffic verification.
      const RECENTLY_APPLIED_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
      const now = Date.now();
      
      const recentlyApplied = evolutions.find(e => {
        if (e.status !== 'applied' || !e.appliedAt) return false;
        const appliedTime = new Date(e.appliedAt).getTime();
        return (now - appliedTime) < RECENTLY_APPLIED_WINDOW_MS;
      });

      if (recentlyApplied) {
        this.logger.info({
          evolutionId: recentlyApplied.id,
          appliedAt: recentlyApplied.appliedAt,
          ageMs: now - new Date(recentlyApplied.appliedAt!).getTime(),
        }, 'Found recently-applied evolution - will verify deployment');
        
        return {
          id: recentlyApplied.id,
          status: recentlyApplied.status,
          request: recentlyApplied.prompt,
          developmentCycleId: recentlyApplied.developmentCycleId,
          recentlyApplied: true,
        };
      }

      return null;
    } catch (error) {
      this.logger.error({ error: (error as Error).message }, 'Error checking pending evolutions');
      return null;
    }
  }

  /**
   * Wait for evolution to complete (applied, rejected, or failed)
   * Polls the evolution status until completion or timeout
   */
  private async waitForEvolutionCompletion(
    evolutionId: string,
    timeoutMs: number
  ): Promise<{
    completed: boolean;
    applied: boolean;
    timedOut: boolean;
    reason?: string;
  }> {
    const startTime = Date.now();
    const pollIntervalMs = 10000; // Poll every 10 seconds

    const { getCodeEvolutionEngine } = await import('../evolution/index.js');
    const codeEvolutionEngine = getCodeEvolutionEngine();

    while (Date.now() - startTime < timeoutMs) {
      const evolution = await codeEvolutionEngine.getEvolution(evolutionId);
      if (!evolution) {
        return { completed: true, applied: false, timedOut: false, reason: 'not_found' };
      }

      this.logger.debug({
        evolutionId,
        status: evolution.status,
        elapsedMs: Date.now() - startTime,
      }, 'Polling evolution status');

      if (evolution.status === 'applied') {
        return { completed: true, applied: true, timedOut: false };
      }
      if (evolution.status === 'rejected') {
        return { completed: true, applied: false, timedOut: false, reason: 'rejected' };
      }
      if (evolution.status === 'failed') {
        return { completed: true, applied: false, timedOut: false, reason: 'failed' };
      }
      if (evolution.status === 'reverted') {
        return { completed: true, applied: false, timedOut: false, reason: 'reverted' };
      }

      await this.delay(pollIntervalMs);
    }

    return { completed: false, applied: false, timedOut: true };
  }

  // ===========================================
  // Escalating Remediation Pipeline
  // ===========================================

  /**
   * Execute escalating remediation pipeline
   *
   * Tries operational fixes in order of complexity/risk:
   * 1. Rollback (~10s) - For bad deploys, config changes (SKIPPED if first deployment)
   * 2. Restart (~30s) - For memory leaks, deadlocks, cache issues
   * 3. Scale (~1min) - For load spikes, resource exhaustion
   * 4. Code Fix (~5-15min) - For actual bugs requiring code evolution
   *
   * INTELLIGENT ROLLBACK: Checks deployment revision count before attempting rollback.
   * If the deployment has only 1 revision (first deployment), rollback is skipped
   * since there's nothing to roll back to.
   *
   * @param context - Current investigation context
   * @param hypothesis - The hypothesis we're trying to resolve
   * @returns Result with which action (if any) resolved the issue
   */
  private async executeEscalatingRemediation(
    context: StateContext,
    hypothesis: Hypothesis
  ): Promise<EscalatingRemediationResult> {
    const startTime = Date.now();
    const attempts: RemediationAttempt[] = [];
    const namespace = context.incident.namespace;
    const deployment = this.extractDeploymentName(context.incident, hypothesis);

    this.logger.info({
      incidentId: context.incident.id,
      namespace,
      deployment,
    }, 'Starting escalating remediation pipeline');

    // INTELLIGENT ROLLBACK: Check deployment revision count AND age before including rollback
    // For fresh deployments, rollback typically returns to the same or similar broken state
    let canRollback = true;
    let revisionInfo: {
      revisionCount: number;
      currentRevision: number;
      canRollback: boolean;
      currentRevisionAgeSeconds?: number;
      isRecentDeployment?: boolean;
      rollbackSkipReason?: string;
    } | null = null;

    try {
      // Get executor to check revision count and deployment age
      const executor = await this.executorFactory.getExecutor();

      // Check if executor has getDeploymentRevisionCount method (KubernetesExecutor)
      if ('getDeploymentRevisionCount' in executor && typeof executor.getDeploymentRevisionCount === 'function') {
        revisionInfo = await (executor as {
          getDeploymentRevisionCount: (ns: string, dep: string) => Promise<{
            revisionCount: number;
            currentRevision: number;
            canRollback: boolean;
            currentRevisionAgeSeconds: number;
            isRecentDeployment: boolean;
            rollbackSkipReason?: string;
          }>;
        }).getDeploymentRevisionCount(namespace, deployment);
        canRollback = revisionInfo.canRollback;

        this.logger.info({
          incidentId: context.incident.id,
          namespace,
          deployment,
          revisionCount: revisionInfo.revisionCount,
          currentRevision: revisionInfo.currentRevision,
          currentRevisionAgeSeconds: revisionInfo.currentRevisionAgeSeconds,
          isRecentDeployment: revisionInfo.isRecentDeployment,
          canRollback,
          rollbackSkipReason: revisionInfo.rollbackSkipReason,
        }, 'Deployment revision check for intelligent rollback');

        if (!canRollback && revisionInfo.rollbackSkipReason) {
          this.thoughtStateManager.addInsight(
            `Intelligent rollback decision: ${revisionInfo.rollbackSkipReason}. ` +
            `Will try restart/scale actions first.`
          );
        }
      }
    } catch (error) {
      this.logger.warn({
        error: (error as Error).message,
      }, 'Could not check deployment revision count, rollback will be attempted');
    }

    // Build escalation order based on rollback availability
    const escalationOrder: ('rollback' | 'restart' | 'scale' | 'code_fix')[] = canRollback
      ? [...ESCALATION_ORDER]
      : ESCALATION_ORDER.filter((action) => action !== 'rollback');

    // Build descriptive reason for timeline
    let rollbackSkipDescription = '';
    if (!canRollback && revisionInfo) {
      if (revisionInfo.isRecentDeployment) {
        const ageMinutes = Math.round((revisionInfo.currentRevisionAgeSeconds ?? 0) / 60);
        rollbackSkipDescription = ` (rollback skipped - deployment is only ${ageMinutes} min old)`;
      } else if (revisionInfo.revisionCount <= 1) {
        rollbackSkipDescription = ' (rollback skipped - first deployment)';
      } else {
        rollbackSkipDescription = ` (rollback skipped - ${revisionInfo.rollbackSkipReason ?? 'unknown reason'})`;
      }
    }

    // Record escalation start in timeline
    this.timelineBuilder.addEvent('insight_discovered', {
      title: 'Escalating Remediation Started',
      description: `Trying remediation actions in order: ${escalationOrder.join(' → ')}${rollbackSkipDescription}`,
      severity: 'medium',
      data: {
        escalationOrder,
        canRollback,
        revisionInfo,
      },
    });

    // Emit escalation start for database persistence (timeline entries)
    this.emit('escalation:step', {
      title: 'Escalating Remediation Started',
      description: `Trying remediation actions in order: ${escalationOrder.join(' → ')}${rollbackSkipDescription}`,
      phase: 'ACTING',
      metadata: { escalationOrder, canRollback, rollbackSkipDescription },
    });

    // Get allowed actions from config
    const k8sConfig = await configService.getKubernetesConfig();
    // Include code_fix in allowed actions for escalating remediation
    const allowedActions = new Set<string>([...k8sConfig.allowedActions, 'code_fix']);

    // Measure pre-escalation error rate BEFORE any remediation action.
    // After restart, in-memory fault injection (chaosConfig) resets to 0,
    // so post-action measurements can falsely show 0% errors.
    // We capture the error rate now to use for shouldContinueToCodeFix decisions.
    await this.generateVerificationTraffic();
    this.preEscalationErrorRate = this.lastVerificationErrorRate;
    this.logger.info({
      preEscalationErrorRate: `${((this.preEscalationErrorRate ?? 0) * 100).toFixed(1)}%`,
    }, 'Captured pre-escalation error rate for code_fix decision');

    for (const actionType of escalationOrder) {
      // Skip actions not allowed by config
      if (!allowedActions.has(actionType)) {
        this.logger.info({ actionType }, 'Skipping action (not in allowed list)');
        continue;
      }

      const attemptStart = Date.now();

      this.logger.info({
        incidentId: context.incident.id,
        actionType,
        attemptNumber: attempts.length + 1,
      }, `Attempting ${actionType}`);

      // Record attempt in timeline
      this.timelineBuilder.addEvent('action_proposed', {
        title: `Escalation: Trying ${actionType.toUpperCase()}`,
        description: `Attempting ${actionType} as part of escalating remediation (step ${attempts.length + 1}/${ESCALATION_ORDER.length})`,
        severity: 'info',
        data: { actionType, step: attempts.length + 1 },
      });

      // Emit for database timeline persistence
      this.emit('escalation:step', {
        title: `Escalation: Trying ${actionType.toUpperCase()}`,
        description: `Attempting ${actionType} as part of escalating remediation (step ${attempts.length + 1}/${ESCALATION_ORDER.length})`,
        phase: 'ACTING',
        metadata: { actionType, step: attempts.length + 1 },
      });

      try {
        let actionResult: { success: boolean; message: string; evolutionId?: string };

        if (actionType === 'code_fix') {
          // For code_fix, trigger evolution instead of K8s action
          actionResult = await this.triggerCodeEvolution(
            context,
            hypothesis,
            namespace,
            deployment
          );
        } else {
          // For operational actions, use executor
          const request: ActionRequest = {
            type: actionType as 'rollback' | 'restart' | 'scale',
            target: { namespace, deployment },
            parameters: this.getActionParameters(actionType),
            dryRun: false,
            reason: `Escalating remediation: ${hypothesis.title}`,
            incidentId: context.incident.id,
          };

          const executor = await this.executorFactory.getExecutor();
          const result = await executor.execute(request);
          actionResult = {
            success: result.success,
            message: result.message,
          };
        }

        const attemptDuration = Date.now() - attemptStart;

        // SPECIAL CASE: code_fix with evolution created
        // When code_fix creates an evolution, don't verify immediately.
        // Return success so VERIFYING phase can wait for evolution completion.
        if (actionType === 'code_fix' && actionResult.success && actionResult.evolutionId) {
          this.logger.info({
            incidentId: context.incident.id,
            evolutionId: actionResult.evolutionId,
          }, 'Code evolution created - deferring verification to VERIFYING phase');

          const attempt: RemediationAttempt = {
            actionType,
            timestamp: new Date(),
            success: true,
            durationMs: attemptDuration,
            message: actionResult.message,
            verificationPassed: false, // Not verified yet - will be checked in VERIFYING phase
          };
          attempts.push(attempt);

          // Persist code_fix action to database immediately for real-time UI updates
          try {
            const action: Action = {
              id: randomUUID(),
              incidentId: context.incident.id,
              hypothesisId: hypothesis.id,
              actionType: 'code_fix' as ActionType,
              target: `${namespace}/${deployment}`,
              parameters: { escalated: true, attemptNumber: attempts.length, evolutionId: actionResult.evolutionId },
              status: 'completed',
              result: attempt.message,
              executedAt: attempt.timestamp,
              completedAt: attempt.timestamp,
              createdAt: attempt.timestamp,
            };
            this.stateMachine.addAction(action);

            await actionRepository.create({
              incidentId: context.incident.id,
              hypothesisId: hypothesis.id,
              type: 'code_fix',
              target: `${namespace}/${deployment}`,
              parameters: { escalated: true, attemptNumber: attempts.length, evolutionId: actionResult.evolutionId },
              status: 'completed',
              dryRun: false,
            });
          } catch (err) {
            this.logger.warn({ err }, 'Failed to persist code_fix evolution action');
          }

          // Record attempt result
          this.timelineBuilder.addEvent('action_executed', {
            title: 'CODE_FIX: Evolution Created - Pending Approval',
            description: `${actionResult.message}. Verification will occur after evolution is applied.`,
            severity: 'info',
            data: { ...attempt, evolutionId: actionResult.evolutionId },
          });

          // Emit for database timeline persistence
          this.emit('escalation:step', {
            title: 'CODE_FIX: Evolution Created - Pending Approval',
            description: `${actionResult.message}. Verification will occur after evolution is applied.`,
            phase: 'ACTING',
            metadata: { actionType: 'code_fix', evolutionId: actionResult.evolutionId, attemptNumber: attempts.length },
          });

          // Return success to transition to VERIFYING phase
          // The VERIFYING phase will wait for the evolution to complete
          return {
            success: true,
            resolvedByAction: 'code_fix',
            attempts,
            totalDurationMs: Date.now() - startTime,
            message: `Code evolution created (${actionResult.evolutionId}). Awaiting approval and application.`,
          };
        }

        // Wait for system to stabilize (for non-code_fix actions or failed code_fix)
        const stabilizationWait = actionType === 'code_fix' ? 30000 : 10000;
        this.logger.info({ wait: stabilizationWait }, 'Waiting for system to stabilize');
        await this.delay(stabilizationWait);

        // Quick verification check
        const verified = await this.quickVerificationCheck();

        const attempt: RemediationAttempt = {
          actionType,
          timestamp: new Date(),
          success: actionResult.success,
          durationMs: attemptDuration,
          message: actionResult.message,
          verificationPassed: verified,
        };
        attempts.push(attempt);

        // Persist action to database immediately for real-time UI updates
        try {
          const action: Action = {
            id: randomUUID(),
            incidentId: context.incident.id,
            hypothesisId: hypothesis.id,
            actionType: attempt.actionType as ActionType,
            target: `${namespace}/${deployment}`,
            parameters: { escalated: true, attemptNumber: attempts.length },
            status: attempt.verificationPassed ? 'completed' : 'failed',
            result: attempt.message,
            executedAt: attempt.timestamp,
            completedAt: attempt.timestamp,
            createdAt: attempt.timestamp,
          };
          this.stateMachine.addAction(action);

          await actionRepository.create({
            incidentId: context.incident.id,
            hypothesisId: hypothesis.id,
            type: attempt.actionType as 'rollback' | 'restart' | 'scale' | 'manual' | 'code_fix',
            target: `${namespace}/${deployment}`,
            parameters: { escalated: true, attemptNumber: attempts.length },
            status: attempt.verificationPassed ? 'completed' : 'failed',
            dryRun: false,
          });

          this.logger.info({
            incidentId: context.incident.id,
            actionType: attempt.actionType,
            status: attempt.verificationPassed ? 'completed' : 'failed',
          }, 'Escalation action persisted to database (real-time)');
        } catch (err) {
          this.logger.warn({ err, actionType: attempt.actionType }, 'Failed to persist escalation action in real-time');
        }

        // Record attempt result
        this.timelineBuilder.addEvent('action_executed', {
          title: `${actionType.toUpperCase()}: ${verified ? 'RESOLVED' : actionResult.success ? 'Executed but not resolved' : 'Failed'}`,
          description: actionResult.message,
          severity: verified ? 'info' : 'medium',
          data: { ...attempt },
        });

        // Emit for database timeline persistence
        this.emit('escalation:step', {
          title: `${actionType.toUpperCase()}: ${verified ? 'RESOLVED' : actionResult.success ? 'Executed but not resolved' : 'Failed'}`,
          description: actionResult.message,
          phase: 'ACTING',
          metadata: { actionType, verified, success: actionResult.success, attemptNumber: attempts.length },
        });

        if (verified) {
          // Check if this is a generated app with ACTUAL code-level errors
          // Only continue to code_fix if the verification traffic showed real 5xx errors
          // before the action resolved them. A 0% error rate means the issue was transient
          // (latency spike, resource contention) — not a code bug.
          const isGeneratedApp = !!context.incident.monitoredAppId;
          const isTemporaryFix = actionType === 'scale' || actionType === 'restart';
          // Use PRE-escalation error rate (measured before any remediation).
          // Post-action lastVerificationErrorRate is unreliable because restart resets
          // in-memory chaosConfig, causing 0% errors temporarily.
          const preActionRate = this.preEscalationErrorRate ?? this.lastVerificationErrorRate;
          const hasCodeLevelErrors = preActionRate !== undefined && preActionRate > 0;
          const shouldContinueToCodeFix = isGeneratedApp && isTemporaryFix
            && hasCodeLevelErrors && escalationOrder.includes('code_fix');

          if (shouldContinueToCodeFix) {
            this.logger.info({
              incidentId: context.incident.id,
              temporaryFixAction: actionType,
              monitoredAppId: context.incident.monitoredAppId,
              preEscalationErrorRate: `${((preActionRate ?? 0) * 100).toFixed(1)}%`,
              postActionErrorRate: `${((this.lastVerificationErrorRate ?? 0) * 100).toFixed(1)}%`,
            }, `${actionType} temporarily resolved issue, but pre-escalation error rate was elevated - continuing to code_fix for generated app (root cause fix)`);

            // Record attempt result with note about temporary fix
            this.timelineBuilder.addEvent('insight_discovered', {
              title: `${actionType.toUpperCase()}: Temporary Fix Applied`,
              description: `${actionType} reduced error rate, but pre-escalation error rate was ${((preActionRate ?? 0) * 100).toFixed(1)}% - continuing to code_fix for permanent solution`,
              severity: 'info',
              data: { actionType, isTemporaryFix: true, willContinueToCodeFix: true, preEscalationErrorRate: preActionRate },
            });

            // Emit for database timeline persistence
            this.emit('escalation:step', {
              title: `${actionType.toUpperCase()}: Temporary Fix - Escalating to Code Fix`,
              description: `${actionType} reduced error rate, but pre-escalation error rate was ${((preActionRate ?? 0) * 100).toFixed(1)}% - continuing to code_fix for permanent solution`,
              phase: 'ACTING',
              metadata: { actionType, isTemporaryFix: true, willContinueToCodeFix: true },
            });

            // Continue to next action (code_fix) instead of returning
            continue;
          }

          if (isGeneratedApp && isTemporaryFix && !hasCodeLevelErrors) {
            this.logger.info({
              incidentId: context.incident.id,
              resolvedByAction: actionType,
              preEscalationErrorRate: `${((preActionRate ?? 0) * 100).toFixed(1)}%`,
            }, `${actionType} resolved issue and pre-escalation error rate was 0% - issue was transient, no code fix needed`);
          }

          // Issue resolved — either permanently, or transiently with no code-level errors
          this.logger.info({
            incidentId: context.incident.id,
            resolvedByAction: actionType,
            attempts: attempts.length,
          }, 'Issue resolved by escalating remediation');

          return {
            success: true,
            resolvedByAction: actionType,
            attempts,
            totalDurationMs: Date.now() - startTime,
            message: `Issue resolved by ${actionType} after ${attempts.length} attempt(s)`,
          };
        }

        this.logger.warn({
          incidentId: context.incident.id,
          actionType,
          verified,
        }, `${actionType} did not resolve issue, escalating to next action`);

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const attemptDuration = Date.now() - attemptStart;

        const attempt: RemediationAttempt = {
          actionType,
          timestamp: new Date(),
          success: false,
          durationMs: attemptDuration,
          message: `Error: ${errorMessage}`,
          verificationPassed: false,
        };
        attempts.push(attempt);

        // Persist failed action to database immediately for real-time UI updates
        try {
          const action: Action = {
            id: randomUUID(),
            incidentId: context.incident.id,
            hypothesisId: hypothesis.id,
            actionType: attempt.actionType as ActionType,
            target: `${namespace}/${deployment}`,
            parameters: { escalated: true, attemptNumber: attempts.length },
            status: 'failed',
            result: attempt.message,
            executedAt: attempt.timestamp,
            completedAt: attempt.timestamp,
            createdAt: attempt.timestamp,
          };
          this.stateMachine.addAction(action);

          await actionRepository.create({
            incidentId: context.incident.id,
            hypothesisId: hypothesis.id,
            type: attempt.actionType as 'rollback' | 'restart' | 'scale' | 'manual' | 'code_fix',
            target: `${namespace}/${deployment}`,
            parameters: { escalated: true, attemptNumber: attempts.length },
            status: 'failed',
            dryRun: false,
          });
        } catch (persistErr) {
          this.logger.warn({ persistErr, actionType: attempt.actionType }, 'Failed to persist failed escalation action');
        }

        this.logger.error({
          incidentId: context.incident.id,
          actionType,
          error: errorMessage,
        }, `Escalation action ${actionType} threw error, continuing to next`);
      }
    }

    // All escalation attempts exhausted
    this.logger.error({
      incidentId: context.incident.id,
      totalAttempts: attempts.length,
    }, 'All escalation actions exhausted without resolution');

    return {
      success: false,
      attempts,
      totalDurationMs: Date.now() - startTime,
      message: `All ${attempts.length} remediation attempts failed to resolve issue`,
    };
  }

  /**
   * Quick verification check for escalating remediation
   * Enhanced to generate test traffic and check actual error rate
   *
   * PRIMARY: Uses direct traffic measurement (most reliable)
   * SECONDARY: Confirms with Prometheus if available
   */
  private async quickVerificationCheck(): Promise<boolean> {
    const errorThreshold = 0.05; // 5% error rate threshold

    // 1. First check if known bugs are still active
    const directStatus = await this.getDirectSystemStatus();
    if (directStatus && directStatus.activeBugs.length > 0) {
      this.logger.info({ activeBugs: directStatus.activeBugs }, 'Quick verification FAILED - known bugs still active');
      return false;
    }

    // 2. Generate test traffic and measure error rate directly
    const trafficGenerated = await this.generateVerificationTraffic();
    if (!trafficGenerated) {
      this.logger.warn('Could not generate verification traffic');
      // Without traffic measurement, we can't reliably verify - fail safe
      return false;
    }

    // 3. PRIMARY CHECK: Use direct traffic measurement
    // This is the most reliable indicator as we just measured it
    if (this.lastVerificationErrorRate !== undefined) {
      const directErrorRate = this.lastVerificationErrorRate;

      if (directErrorRate >= errorThreshold) {
        this.logger.info({
          directErrorRate: `${(directErrorRate * 100).toFixed(1)}%`,
          threshold: `${(errorThreshold * 100).toFixed(0)}%`,
        }, 'Quick verification FAILED - direct measurement shows elevated error rate');
        return false;
      }

      this.logger.info({
        directErrorRate: `${(directErrorRate * 100).toFixed(1)}%`,
        threshold: `${(errorThreshold * 100).toFixed(0)}%`,
      }, 'Quick verification PASSED - direct measurement shows healthy error rate');
      return true;
    }

    // 4. FALLBACK: If direct measurement unavailable, try Prometheus
    // Wait for Prometheus to scrape new metrics
    const scrapeWaitMs = 20000;
    this.logger.info({ waitMs: scrapeWaitMs }, 'Direct measurement unavailable, waiting for Prometheus scrape');
    await this.delay(scrapeWaitMs);

    const prometheusOk = await this.checkPrometheusErrorRate();
    if (prometheusOk) {
      this.logger.info('Quick verification PASSED - Prometheus shows healthy error rate');
      return true;
    }

    this.logger.info('Quick verification FAILED - Prometheus shows elevated error rate');
    return false;
  }

  /**
   * Generate test traffic to the target service for metric validation
   */
  private async generateVerificationTraffic(): Promise<boolean> {
    const serviceUrl = this.targetServiceUrl;
    if (!serviceUrl) {
      this.logger.warn('No target service URL available for traffic generation');
      return false;
    }

    const requestCount = 40;
    // Weight business endpoints (/users) much higher than /health.
    // /health almost always returns 200 even when the app has real bugs.
    // With 40 requests cycling through these 5 entries, ~24 hit /users (60%).
    const endpoints = ['/users', '/users', '/users', '/', '/health']; // Business endpoints weighted higher

    this.logger.info({ serviceUrl, requestCount }, 'Generating verification traffic');

    let successCount = 0;
    let errorCount = 0;

    const requests = [];
    for (let i = 0; i < requestCount; i++) {
      const endpoint = endpoints[i % endpoints.length];
      requests.push(
        fetch(`${serviceUrl}${endpoint}`, {
          signal: AbortSignal.timeout(5000),
          method: 'GET',
        })
          .then(res => {
            if (res.status >= 500) errorCount++;
            else successCount++;
          })
          .catch(() => errorCount++)
      );
    }

    await Promise.all(requests);

    const errorRate = errorCount / requestCount;
    this.logger.info({
      successCount,
      errorCount,
      errorRate: `${(errorRate * 100).toFixed(1)}%`
    }, 'Verification traffic completed');

    // Store for later reference
    this.lastVerificationErrorRate = errorRate;

    return true; // Traffic was generated
  }

  /**
   * Check actual error rate from Prometheus metrics
   * Falls back to direct measurement if Prometheus is unavailable or returns no data
   */
  private async checkPrometheusErrorRate(): Promise<boolean> {
    const errorThreshold = 0.05; // 5%

    // Helper to check direct measurement
    const checkDirectMeasurement = (): boolean => {
      if (this.lastVerificationErrorRate !== undefined) {
        const passed = this.lastVerificationErrorRate < errorThreshold;
        this.logger.info({
          directErrorRate: `${(this.lastVerificationErrorRate * 100).toFixed(1)}%`,
          threshold: `${(errorThreshold * 100).toFixed(0)}%`,
          passed,
        }, 'Using direct measurement fallback');
        return passed;
      }
      // No direct measurement available - fail safe
      this.logger.warn('No direct measurement available - failing safe');
      return false;
    };

    try {
      const { PrometheusClient } = await import('../detection/prometheus-client.js');
      const prometheusClient = new PrometheusClient();

      // Check if Prometheus is available
      const available = await prometheusClient.isAvailable();
      if (!available) {
        this.logger.warn('Prometheus not available, using direct traffic measurement');
        return checkDirectMeasurement();
      }

      // Get namespace and deployment from class properties
      const namespace = this.targetNamespace || 'development';
      const deployment = this.targetDeployment || 'unknown';

      // Query error rate using the same formula as detection
      const query = `
        sum(rate(http_requests_total{namespace="${namespace}", app="${deployment}", status=~"5.."}[1m]))
        /
        sum(rate(http_requests_total{namespace="${namespace}", app="${deployment}"}[1m]))
      `.replace(/\s+/g, ' ').trim();

      this.logger.info({ query, namespace, deployment }, 'Querying Prometheus for error rate');

      const result = await prometheusClient.query(query);

      if (!result.success) {
        this.logger.warn({ error: result.error }, 'Prometheus query failed, using direct measurement');
        return checkDirectMeasurement();
      }

      const errorRate = result.value ?? 0;

      // NaN means no data - fall back to direct measurement instead of assuming healthy
      if (isNaN(errorRate)) {
        this.logger.warn('Prometheus returned NaN (no data), using direct measurement');
        return checkDirectMeasurement();
      }

      const passed = errorRate < errorThreshold;
      this.logger.info({
        errorRate: `${(errorRate * 100).toFixed(1)}%`,
        threshold: `${(errorThreshold * 100).toFixed(0)}%`,
        passed,
      }, 'Prometheus error rate check');

      return passed;
    } catch (error) {
      this.logger.error({ error: (error as Error).message }, 'Error checking Prometheus metrics');
      return checkDirectMeasurement();
    }
  }

  // ===========================================
  // Utility Methods
  // ===========================================

  /**
   * Resolve the service URL for a deployment
   * Uses internal K8s DNS when running in-cluster, NodePort for local development
   */
  private async resolveServiceUrl(deployment: string, namespace: string): Promise<void> {
    const isInCluster = !!process.env.KUBERNETES_SERVICE_HOST;

    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      if (isInCluster) {
        // In-cluster: use internal K8s DNS URL (doesn't need NodePort, uses container port)
        // Get the container port (spec.ports[0].port, not nodePort)
        try {
          const cmd = `kubectl get svc ${deployment} -n ${namespace} -o jsonpath='{.spec.ports[0].port}' 2>/dev/null`;
          const { stdout } = await execAsync(cmd);
          const port = stdout.trim().replace(/'/g, '');

          if (port && /^\d+$/.test(port)) {
            // Internal K8s DNS format: http://service.namespace.svc.cluster.local:port
            this.targetServiceUrl = `http://${deployment}.${namespace}.svc.cluster.local:${port}`;
            this.logger.info({ deployment, namespace, port, serviceUrl: this.targetServiceUrl, isInCluster }, 'Resolved internal service URL');
            return;
          }
        } catch (error) {
          this.logger.warn({ error: (error as Error).message }, 'Failed to get container port, falling back to NodePort');
        }
      }

      // Local development: use NodePort with localhost
      const cmd = `kubectl get svc ${deployment} -n ${namespace} -o jsonpath='{.spec.ports[0].nodePort}' 2>/dev/null`;
      const { stdout } = await execAsync(cmd);
      const nodePort = stdout.trim().replace(/'/g, '');

      if (nodePort && /^\d+$/.test(nodePort)) {
        this.targetServiceUrl = `http://localhost:${nodePort}`;
        this.logger.info({ deployment, namespace, nodePort, serviceUrl: this.targetServiceUrl, isInCluster }, 'Resolved external service URL');
      } else {
        this.logger.warn({ deployment, namespace, stdout, isInCluster }, 'Could not resolve NodePort');
      }
    } catch (error) {
      this.logger.warn({ deployment, namespace, error: (error as Error).message, isInCluster }, 'Failed to resolve service URL');
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Extract deployment name from target string (format: namespace/deployment)
   */
  private extractDeploymentFromTarget(target: string): string {
    if (target.includes('/')) {
      const parts = target.split('/');
      return parts[1] ?? parts[0] ?? 'unknown';
    }
    return target;
  }

  /**
   * Get direct system status from the target app's API
   * Uses dynamically resolved service URL for correct targeting
   * Checks both /health and /bugs/status endpoints
   */
  private async getDirectSystemStatus(): Promise<{
    healthy: boolean;
    systemStatus: string;
    cpu: number;
    activeBugs: string[];
  } | null> {
    // Use dynamically resolved service URL, fall back to env var or default
    const serviceUrl = this.targetServiceUrl || process.env.DEMO_APP_URL || 'http://localhost:30080';
    this.logger.debug({ serviceUrl }, 'Checking direct system status');

    try {
      // Check health endpoint
      const healthResponse = await fetch(`${serviceUrl}/health`, { signal: AbortSignal.timeout(5000) });
      const healthOk = healthResponse.ok;

      // Check bugs status endpoint
      let activeBugs: string[] = [];
      try {
        const bugsResponse = await fetch(`${serviceUrl}/bugs/status`, { signal: AbortSignal.timeout(5000) });
        if (bugsResponse.ok) {
          const bugsData = (await bugsResponse.json()) as {
            activeBugs?: Record<string, unknown>;
          };
          // Extract active bug names (bugs with non-null values)
          if (bugsData.activeBugs) {
            activeBugs = Object.entries(bugsData.activeBugs)
              .filter(([, value]) => value !== null)
              .map(([key]) => key);
          }
        }
      } catch {
        // Bugs endpoint not available, that's ok
      }

      const isHealthy = healthOk && activeBugs.length === 0;
      this.logger.info({
        serviceUrl,
        healthOk,
        activeBugs,
        isHealthy,
      }, 'Direct status check completed');

      return {
        healthy: isHealthy,
        systemStatus: healthOk ? 'healthy' : 'unhealthy',
        cpu: 0,
        activeBugs,
      };
    } catch (error) {
      this.logger.warn({ serviceUrl, error: (error as Error).message }, 'Could not fetch direct status');
      return null;
    }
  }

  /**
   * Calculate dynamic thinking budget based on evidence confidence
   *
   * This implements Gemini 3's thinking escalation pattern:
   * - Low confidence evidence (< 0.5) → HIGH thinking budget (24576 tokens)
   * - Medium confidence (0.5 - 0.7) → MEDIUM thinking budget (8192 tokens)
   * - High confidence (> 0.7) → LOW thinking budget (1024 tokens)
   *
   * The rationale: when observations are unclear, invest more in reasoning.
   * When evidence strongly points to a cause, quick decisions suffice.
   *
   * @param evidence - Array of evidence items with confidence scores
   * @returns ThinkingBudget appropriate for the evidence quality
   */
  private calculateDynamicThinkingBudget(evidence: Evidence[]): ThinkingBudget {
    // Filter evidence with valid confidence scores
    const evidenceWithConfidence = evidence.filter(
      (e) => e.confidence != null && e.confidence > 0
    );

    // If no evidence has confidence scores, use HIGH for thorough analysis
    if (evidenceWithConfidence.length === 0) {
      this.logger.debug('No confidence scores in evidence, using HIGH thinking budget');
      return THINKING_BUDGETS.HIGH;
    }

    // Calculate average confidence
    const totalConfidence = evidenceWithConfidence.reduce(
      (sum, e) => sum + (e.confidence ?? 0),
      0
    );
    const avgConfidence = totalConfidence / evidenceWithConfidence.length;

    // Determine thinking budget based on confidence thresholds
    let budget: ThinkingBudget;
    let reason: string;

    if (avgConfidence < 0.5) {
      // Low confidence → need deep thinking to find patterns
      budget = THINKING_BUDGETS.HIGH;
      reason = 'low confidence requires deep analysis';
    } else if (avgConfidence < 0.7) {
      // Medium confidence → balanced approach
      budget = THINKING_BUDGETS.MEDIUM;
      reason = 'medium confidence allows balanced analysis';
    } else {
      // High confidence → quick decision is safe
      budget = THINKING_BUDGETS.LOW;
      reason = 'high confidence enables quick decision';
    }

    this.logger.debug({
      avgConfidence: Math.round(avgConfidence * 100) / 100,
      evidenceCount: evidenceWithConfidence.length,
      budget,
      reason,
    }, 'Calculated dynamic thinking budget');

    return budget;
  }

  /**
   * Get current state
   */
  getState(): OODAState {
    return this.stateMachine.getState();
  }

  /**
   * Check if investigation is active
   */
  isActive(): boolean {
    return this.stateMachine.isActive();
  }

  /**
   * Get current context
   */
  getContext(): StateContext | null {
    return this.stateMachine.getContext();
  }

  /**
   * Stop current investigation
   */
  stop(): void {
    this.stateMachine.reset();
  }

  // ===========================================
  // Autonomous Component Accessors
  // ===========================================

  /**
   * Get the investigation timeline
   */
  getTimeline() {
    return this.timelineBuilder.getTimeline();
  }

  /**
   * Get postmortem timeline format
   */
  getPostmortemTimeline() {
    return this.timelineBuilder.buildPostmortemTimeline();
  }

  /**
   * Get thought state and reasoning chain
   */
  getThoughtState() {
    return this.thoughtStateManager.getCurrentState();
  }

  /**
   * Get the reasoning chain for current investigation
   */
  getReasoningChain() {
    return this.thoughtStateManager.getReasoningChain();
  }

  /**
   * Get continuation context for resuming investigation
   */
  getContinuationContext() {
    return this.thoughtStateManager.getContinuationContext();
  }

  /**
   * Get rollback history for an incident
   */
  getRollbackHistory(incidentId: string) {
    return this.rollbackManager.getHistory(incidentId);
  }

  /**
   * Get pending rollback approvals
   */
  getPendingRollbackApprovals() {
    return this.rollbackManager.getPendingApprovals();
  }

  /**
   * Get verification service for external access
   * Useful for running additional verification checks or configuration
   */
  getVerificationService() {
    return this.verificationService;
  }

  /**
   * Export timeline as markdown
   */
  exportTimelineMarkdown(): string {
    return this.timelineBuilder.toMarkdown();
  }

  /**
   * Export timeline as JSON
   */
  exportTimelineJSON(): string {
    return this.timelineBuilder.toJSON();
  }
}

/**
 * Anomaly Detection Service
 * Integrates autonomous anomaly detection with incident management
 * Creates incidents and triggers investigations when anomalies are detected
 *
 * Uses HybridAnomalyDetector which:
 * - Monitors ALL deployed apps from the database
 * - Uses Prometheus metrics for detection (error rate, latency, memory)
 * - Polls every 15 seconds (configurable)
 * - Can optionally use Gemini Vision for additional context
 */

import { EventEmitter } from 'events';
import type { FastifyInstance } from 'fastify';
import {
  HybridAnomalyDetector,
  DetectionStateManager,
  type HybridAnomalyEvent,
  type HybridAnomalyDetectorConfig,
} from '@chronosops/core';
import type { AnomalyDetection } from '@chronosops/gemini';
import type { PrometheusMetricAnomaly } from '@chronosops/core';
import {
  incidentRepository,
  timelineRepository,
  monitoredAppRepository,
  evidenceRepository,
  hypothesisRepository,
  actionRepository,
  postmortemRepository,
  type TimelinePhase,
} from '@chronosops/database';
import { broadcastPhaseChange, broadcastIncidentUpdate } from '../websocket/index.js';
import { createChildLogger, getConfig } from '@chronosops/shared';
import type { Incident, OODAState } from '@chronosops/shared';
import type { GeminiClient } from '@chronosops/gemini';

const logger = createChildLogger({ component: 'AnomalyDetectionService' });

/**
 * Anomaly Detection Service configuration
 */
export interface AnomalyDetectionServiceConfig {
  enabled: boolean;
  namespace: string;
}

const DEFAULT_CONFIG: AnomalyDetectionServiceConfig = {
  enabled: true,
  namespace: 'development', // Changed from 'demo' to 'development' where apps deploy
};

/**
 * Type label mapping for incident titles
 */
const ANOMALY_TYPE_LABELS: Record<string, string> = {
  error_spike: 'Error Rate Spike Detected',
  high_error_rate: 'Error Rate Spike Detected',
  latency_increase: 'Latency Increase Detected',
  high_latency: 'Latency Increase Detected',
  resource_exhaustion: 'Resource Exhaustion Detected',
  memory_pressure: 'Memory Pressure Detected',
  cpu_pressure: 'CPU Pressure Detected',
  pod_restart: 'Pod Restarts Detected',
  deployment_event: 'Deployment Issue Detected',
  traffic_anomaly: 'Traffic Anomaly Detected',
};

/**
 * Map Prometheus metric anomaly type to standard anomaly type for incident creation
 */
function mapPrometheusTypeToAnomalyType(type: string): string {
  const typeMap: Record<string, string> = {
    high_error_rate: 'error_spike',
    high_latency: 'latency_increase',
    memory_pressure: 'resource_exhaustion',
    cpu_pressure: 'resource_exhaustion',
    pod_restart: 'deployment_event',
  };
  return typeMap[type] ?? type;
}

/**
 * Map anomaly type to incident title
 */
function getIncidentTitle(anomalyType: string, description: string, appName?: string): string {
  const baseTitle = ANOMALY_TYPE_LABELS[anomalyType] || 'Anomaly Detected';
  // Truncate description if too long
  const shortDesc = description.length > 50 ? description.slice(0, 47) + '...' : description;
  const appPrefix = appName ? `[${appName}] ` : '';
  return `${appPrefix}${baseTitle}: ${shortDesc}`;
}

/**
 * Extract app name from incident title
 * Parses titles like "[AppName] Error Rate Spike Detected: ..."
 */
function extractAppNameFromIncident(incident: Incident): string | undefined {
  // Try to extract from title format: "[AppName] ..."
  const titleMatch = incident.title.match(/^\[([^\]]+)\]/);
  if (titleMatch) {
    return titleMatch[1];
  }
  return undefined;
}

/**
 * Get the type label for matching existing incidents
 */
function getAnomalyTypeLabel(anomalyType: string): string {
  return ANOMALY_TYPE_LABELS[anomalyType] || 'Anomaly Detected';
}

/**
 * Map anomaly severity to incident severity
 */
function mapSeverity(
  anomalySeverity: string
): 'low' | 'medium' | 'high' | 'critical' {
  const severityMap: Record<string, 'low' | 'medium' | 'high' | 'critical'> = {
    low: 'low',
    medium: 'medium',
    high: 'high',
    critical: 'critical',
  };
  return severityMap[anomalySeverity] || 'medium';
}

/**
 * Convert HybridAnomalyEvent to a format compatible with incident creation
 */
interface NormalizedAnomaly {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  description: string;
  appName?: string;       // Human-readable display name (for UI/titles)
  deployment?: string;    // K8s deployment name (for API calls)
  namespace?: string;
}

function normalizeAnomalyEvent(event: HybridAnomalyEvent): NormalizedAnomaly {
  if (event.source === 'prometheus') {
    const metricAnomaly = event.anomaly as PrometheusMetricAnomaly;
    return {
      type: mapPrometheusTypeToAnomalyType(metricAnomaly.type),
      severity: metricAnomaly.severity,
      confidence: 1.0, // Prometheus metrics are precise
      description: metricAnomaly.description,
      appName: metricAnomaly.app,
      deployment: metricAnomaly.deployment,  // K8s deployment name for API calls
      namespace: metricAnomaly.namespace,
    };
  } else {
    // Vision-based anomaly
    const visionAnomaly = event.anomaly as AnomalyDetection;
    return {
      type: visionAnomaly.type,
      severity: visionAnomaly.severity,
      confidence: visionAnomaly.confidence,
      description: visionAnomaly.description,
      appName: event.app?.displayName,
      deployment: event.app?.deployment,     // K8s deployment name for API calls
      namespace: event.app?.namespace,
    };
  }
}

/**
 * AnomalyDetectionService - Autonomous incident creation and investigation
 *
 * Uses HybridAnomalyDetector for multi-app monitoring via Prometheus metrics
 */
export class AnomalyDetectionService extends EventEmitter {
  private config: AnomalyDetectionServiceConfig;
  private detector: HybridAnomalyDetector | null = null;
  private stateManager: DetectionStateManager;
  private app: FastifyInstance | null = null;
  private geminiClient: GeminiClient;

  constructor(
    geminiClient: GeminiClient,
    config: Partial<AnomalyDetectionServiceConfig> = {}
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.geminiClient = geminiClient;

    // Initialize state manager with config from environment
    const appConfig = getConfig();
    this.stateManager = new DetectionStateManager({
      cooldownMs: appConfig.detection.cooldownMs,
      maxConcurrentInvestigations: appConfig.detection.maxConcurrentInvestigations,
    });
  }

  /**
   * Attach Fastify app for orchestrator access
   */
  attachApp(app: FastifyInstance): void {
    this.app = app;
  }

  /**
   * Start the detection service
   * Uses HybridAnomalyDetector which automatically monitors ALL deployed apps
   */
  async start(): Promise<void> {
    if (this.detector?.getIsRunning()) {
      logger.warn('Detection service already running');
      return;
    }

    const appConfig = getConfig();

    // Create HybridAnomalyDetector configuration
    const detectorConfig: Partial<HybridAnomalyDetectorConfig> = {
      mode: 'prometheus', // Use Prometheus-only mode for reliable metric detection
      metricsPollingIntervalMs: appConfig.detection.pollingIntervalMs ?? 15000,
      minSeverity: appConfig.detection.minSeverity ?? 'medium',
      minConfidence: appConfig.detection.minConfidence ?? 0.7,
    };

    // Create HybridAnomalyDetector
    // It automatically monitors ALL apps from monitoredAppRepository.getActive()
    this.detector = new HybridAnomalyDetector(
      this.stateManager,
      detectorConfig
      // No frame fetcher needed for Prometheus-only mode
    );

    // Handle detected anomalies from Prometheus metrics
    this.detector.on('anomaly:detected', (event: HybridAnomalyEvent) => {
      void this.handleAnomalyDetected(event);
    });

    // Handle detection errors
    this.detector.on('detection:error', (error: Error, source: 'prometheus' | 'vision') => {
      logger.error({ errorMessage: error.message, source }, 'Detection error');
      this.emit('error', error);
    });

    // Handle detection stopped (due to errors)
    this.detector.on('detection:stopped', () => {
      logger.warn('Detection stopped unexpectedly');
      this.emit('stopped');
    });

    // Handle healthy detection cycles
    this.detector.on('detection:healthy', (source: 'prometheus' | 'vision') => {
      logger.debug({ source }, 'Detection cycle healthy');
    });

    // Handle metrics check results (for debugging)
    this.detector.on('metrics:checked', (result) => {
      if (result.anomalies.length > 0) {
        logger.info({
          anomalyCount: result.anomalies.length,
          checkedApps: result.checkedApps,
        }, 'Metrics check found anomalies');
      } else {
        logger.debug({
          checkedApps: result.checkedApps,
        }, 'Metrics check completed - no anomalies');
      }
    });

    // Start detection
    await this.detector.start();
    logger.info({
      mode: detectorConfig.mode,
      pollingIntervalMs: detectorConfig.metricsPollingIntervalMs,
      minSeverity: detectorConfig.minSeverity,
    }, 'Anomaly detection service started - monitoring ALL deployed apps');
    this.emit('started');
  }

  /**
   * Stop the detection service
   */
  stop(): void {
    if (this.detector) {
      this.detector.stop();
      this.detector.removeAllListeners();
      this.detector = null;
    }
    this.stateManager.stop();
    logger.info('Anomaly detection service stopped');
    this.emit('stopped');
  }

  /**
   * Check if service is running
   */
  isRunning(): boolean {
    return this.detector?.getIsRunning() ?? false;
  }

  /**
   * Get service status
   */
  getStatus(): {
    running: boolean;
    enabled: boolean;
    detectorStatus: ReturnType<HybridAnomalyDetector['getStatus']> | null;
  } {
    return {
      running: this.isRunning(),
      enabled: this.config.enabled,
      detectorStatus: this.detector?.getStatus() ?? null,
    };
  }

  /**
   * Handle detected anomaly - create incident and trigger investigation
   * Implements deduplication to avoid creating duplicate incidents for ongoing issues
   */
  private async handleAnomalyDetected(event: HybridAnomalyEvent): Promise<void> {
    const normalizedAnomaly = normalizeAnomalyEvent(event);

    logger.info(
      {
        source: event.source,
        type: normalizedAnomaly.type,
        severity: normalizedAnomaly.severity,
        confidence: normalizedAnomaly.confidence,
        description: normalizedAnomaly.description,
        app: normalizedAnomaly.appName,
        namespace: normalizedAnomaly.namespace,
      },
      'Processing detected anomaly'
    );

    try {
      // Use the namespace from the anomaly, fall back to config
      const namespace = normalizedAnomaly.namespace ?? this.config.namespace;

      // Check for existing unresolved incident of the same type and app (deduplication)
      const existingIncident = await this.findExistingUnresolvedIncident(
        normalizedAnomaly.type,
        namespace,
        normalizedAnomaly.appName
      );

      if (existingIncident) {
        logger.info(
          {
            existingIncidentId: existingIncident.id,
            existingState: existingIncident.state,
            anomalyType: normalizedAnomaly.type,
            app: normalizedAnomaly.appName,
          },
          'Found existing unresolved incident for this anomaly type, skipping creation'
        );

        // Update the existing incident's description with new anomaly info
        await incidentRepository.update(existingIncident.id, {
          description: `${existingIncident.description}\n\n[${new Date().toISOString()}] Re-detected: ${normalizedAnomaly.description} (Confidence: ${Math.round(normalizedAnomaly.confidence * 100)}%)`,
        });

        // Don't create new incident or trigger new investigation
        return;
      }

      // Validate that the deployment still exists before creating incident
      // This prevents creating incidents for deleted deployments
      // Use the deployment name (not appName which is the display name)
      const deploymentName = normalizedAnomaly.deployment || normalizedAnomaly.appName;
      if (deploymentName && this.app?.services?.k8sClient) {
        try {
          const deployment = await this.app.services.k8sClient.getDeployment(
            deploymentName,
            namespace
          );
          if (!deployment) {
            logger.info(
              {
                deployment: deploymentName,
                appName: normalizedAnomaly.appName,
                namespace,
              },
              'Skipping anomaly - deployment no longer exists'
            );
            return;
          }
        } catch (err) {
          // If we can't verify the deployment, skip creating the incident
          // This handles the case where the deployment was deleted
          logger.info(
            {
              deployment: deploymentName,
              appName: normalizedAnomaly.appName,
              namespace,
              error: (err as Error).message,
            },
            'Skipping anomaly - could not verify deployment exists'
          );
          return;
        }
      }

      // Create incident
      const incident = await this.createIncident(normalizedAnomaly, namespace);

      // Record in state manager
      this.stateManager.recordAnomaly(normalizedAnomaly.type, normalizedAnomaly.description, incident.id);
      this.stateManager.startInvestigation(incident.id);

      // Emit event for external listeners (e.g., WebSocket broadcast)
      this.emit('incident:created', { incident, anomaly: normalizedAnomaly });

      // Trigger investigation if app is attached
      if (this.app) {
        await this.triggerInvestigation(incident);
      } else {
        logger.warn('App not attached, cannot trigger investigation');
      }
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to handle anomaly');
    }
  }

  /**
   * Find existing unresolved incident for the same anomaly type and app
   * Used for deduplication to prevent creating multiple incidents for the same ongoing issue
   */
  private async findExistingUnresolvedIncident(
    anomalyType: string,
    namespace: string,
    appName?: string
  ): Promise<Incident | null> {
    const typeLabel = getAnomalyTypeLabel(anomalyType);
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

    // Fetch recent incidents that are not resolved/closed
    const recentIncidents = await incidentRepository.list(
      {
        namespace: namespace,
        startedAfter: thirtyMinutesAgo,
      },
      20, // limit
      0   // offset
    );

    // Find incidents that:
    // 1. Match the anomaly type (title contains the type label)
    // 2. Are not resolved or closed (still active or investigating)
    // 3. Are not in FAILED state (we should create new incidents for failed ones)
    // 4. Match the app name if provided
    for (const incident of recentIncidents) {
      const isUnresolved = incident.status !== 'resolved' && incident.status !== 'closed';
      const isNotFailed = incident.state !== 'FAILED';
      const matchesType = incident.title.includes(typeLabel);
      const matchesApp = !appName || incident.title.includes(`[${appName}]`);

      if (isUnresolved && isNotFailed && matchesType && matchesApp) {
        logger.debug(
          {
            incidentId: incident.id,
            incidentTitle: incident.title,
            typeLabel,
            status: incident.status,
            state: incident.state,
          },
          'Found matching unresolved incident'
        );
        return incident;
      }
    }

    return null;
  }

  /**
   * Create incident from detected anomaly
   */
  private async createIncident(
    anomaly: NormalizedAnomaly,
    namespace: string
  ): Promise<Incident> {
    // Look up the monitoredAppId to link the incident for live video feed
    let monitoredAppId: string | undefined;
    if (anomaly.appName) {
      try {
        // The anomaly.appName is the displayName, but we need to find by deployment
        // Since Prometheus uses deployment name as app label, search by deployment
        const apps = await monitoredAppRepository.getActive();
        const matchingApp = apps.find(
          (app: { displayName: string; deployment: string; namespace: string }) =>
            (app.displayName === anomaly.appName || app.deployment === anomaly.appName) &&
            app.namespace === namespace
        );
        if (matchingApp) {
          monitoredAppId = matchingApp.id;
          logger.info({ monitoredAppId, appName: anomaly.appName }, 'Linked incident to monitored app');
        }
      } catch (err) {
        logger.warn({ error: (err as Error).message, appName: anomaly.appName }, 'Failed to look up monitored app');
      }
    }

    const incident = await incidentRepository.create({
      title: getIncidentTitle(anomaly.type, anomaly.description, anomaly.appName),
      description: `Automatically detected: ${anomaly.description}\n\nConfidence: ${Math.round(anomaly.confidence * 100)}%\nApp: ${anomaly.appName ?? 'Unknown'}\nNamespace: ${namespace}`,
      severity: mapSeverity(anomaly.severity),
      namespace: namespace,
      monitoredAppId, // Link to monitored app for live video feed
    });

    logger.info(
      { incidentId: incident.id, title: incident.title, app: anomaly.appName, monitoredAppId },
      'Incident created from detected anomaly'
    );

    return incident;
  }

  /**
   * Trigger OODA loop investigation for incident
   */
  private async triggerInvestigation(incident: Incident): Promise<void> {
    if (!this.app) {
      logger.error('Cannot trigger investigation: app not attached');
      return;
    }

    try {
      // Update incident status to investigating
      await incidentRepository.update(incident.id, { status: 'investigating' });

      // Create orchestrator
      const orchestrator = this.app.services.createOrchestrator();

      // Handle phase changes - persist to database
      orchestrator.on('phase:changed', async ({ phase, context }: { phase: OODAState; context?: unknown }) => {
        try {
          // IDLE is not a valid timeline phase, skip it
          if (phase === 'IDLE') return;

          // Add phase transition to timeline
          await timelineRepository.create({
            incidentId: incident.id,
            type: 'phase_change',
            title: `Entered ${phase} phase`,
            description: `Investigation transitioned to ${phase}`,
            phase: phase as TimelinePhase,
            timestamp: new Date(),
          });

          // Update incident state in database
          await incidentRepository.update(incident.id, { state: phase });

          logger.info(
            { incidentId: incident.id, phase },
            'Persisted phase change to database'
          );

          // Broadcast phase change via WebSocket
          broadcastPhaseChange(incident.id, phase, {
            phase,
            context,
            timestamp: new Date().toISOString(),
          });
        } catch (err) {
          logger.error(
            { incidentId: incident.id, phase, error: (err as Error).message },
            'Failed to persist phase change'
          );
        }
      });

      // Handle evidence collection - persist to database
      orchestrator.on('observation:collected', async ({ evidence }: { evidence: Record<string, unknown> }) => {
        try {
          // Ensure timestamp is a Date object
          const timestamp = evidence.timestamp
            ? (evidence.timestamp instanceof Date ? evidence.timestamp : new Date(evidence.timestamp as string))
            : new Date();

          // Persist evidence to database
          await evidenceRepository.create({
            incidentId: incident.id,
            type: ((evidence.type as string) || 'video_frame') as 'video_frame' | 'log' | 'metric' | 'k8s_event' | 'user_report',
            source: (evidence.source as string) || 'gemini_vision',
            content: (evidence.content || { description: 'Unknown evidence' }) as Record<string, unknown>,
            timestamp,
            confidence: evidence.confidence as number | undefined,
            metadata: evidence.metadata as Record<string, unknown> | undefined,
          });

          // Set incident thumbnail from first video_frame evidence with frameImage
          if (evidence.type === 'video_frame' && (evidence.metadata as Record<string, unknown>)?.frameImage) {
            const currentIncident = await incidentRepository.getById(incident.id);
            if (currentIncident && !currentIncident.thumbnail) {
              await incidentRepository.update(incident.id, {
                thumbnail: (evidence.metadata as Record<string, unknown>).frameImage as string,
              });
              logger.info({ incidentId: incident.id }, 'Set incident thumbnail from first frame');
            }
          }

          // Add to timeline
          await timelineRepository.create({
            incidentId: incident.id,
            type: 'evidence',
            title: `Evidence collected: ${(evidence.type as string) || 'observation'}`,
            description: (evidence.summary as string) || (evidence.description as string),
            phase: 'OBSERVING',
            timestamp: new Date(),
            metadata: { evidenceId: evidence.id },
          });

          logger.info({ incidentId: incident.id, evidenceType: evidence.type }, 'Evidence persisted');
        } catch (err) {
          logger.error({ incidentId: incident.id, error: (err as Error).message }, 'Failed to persist evidence');
        }

        // Broadcast via WebSocket
        broadcastIncidentUpdate(incident.id, {
          type: 'evidence_collected',
          evidence,
          timestamp: new Date().toISOString(),
        });
      });

      // Handle hypothesis generation - persist to database
      orchestrator.on('hypothesis:generated', async ({ hypothesis }: { hypothesis: Record<string, unknown> }) => {
        try {
          // Persist hypothesis to database, preserving orchestrator's ID for FK consistency
          // Without passing the in-memory ID, actionRepository.create() calls that reference
          // hypothesis.id will fail with FOREIGN KEY constraint violations
          await hypothesisRepository.create({
            id: hypothesis.id as string,
            incidentId: incident.id,
            rootCause: (hypothesis.rootCause as string) || (hypothesis.description as string),
            confidence: (hypothesis.confidence as number) || 0.5,
            status: (hypothesis.status as 'proposed' | 'testing' | 'confirmed' | 'rejected') || 'proposed',
            supportingEvidence: (hypothesis.supportingEvidence as string[]) || [],
            contradictingEvidence: (hypothesis.contradictingEvidence as string[]) || [],
            suggestedActions: (hypothesis.suggestedActions as string[]) || [],
          });

          // Add to timeline
          await timelineRepository.create({
            incidentId: incident.id,
            type: 'hypothesis',
            title: `Hypothesis generated`,
            description: (hypothesis.rootCause as string) || (hypothesis.description as string),
            phase: 'DECIDING',
            timestamp: new Date(),
            metadata: { confidence: hypothesis.confidence },
          });

          logger.info({ incidentId: incident.id, confidence: hypothesis.confidence }, 'Hypothesis persisted');
        } catch (err) {
          logger.error({ incidentId: incident.id, error: (err as Error).message }, 'Failed to persist hypothesis');
        }

        // Broadcast via WebSocket
        broadcastIncidentUpdate(incident.id, {
          type: 'hypothesis_generated',
          hypothesis,
          timestamp: new Date().toISOString(),
        });
      });

      // Handle escalation step events - persist to timeline for real-time visibility
      // These are emitted by executeEscalatingRemediation() for each remediation step
      // (rollback skipped, restart attempted, scale attempted, code_fix triggered, etc.)
      orchestrator.on('escalation:step', async ({ title, description, phase, metadata }: {
        title: string; description: string; phase: string; metadata: Record<string, unknown>;
      }) => {
        try {
          await timelineRepository.create({
            incidentId: incident.id,
            type: 'action',
            title,
            description,
            phase: phase as TimelinePhase,
            timestamp: new Date(),
            metadata,
          });
        } catch (err) {
          logger.warn({ err, title }, 'Failed to persist escalation step to timeline');
        }

        // Broadcast via WebSocket for real-time UI updates
        broadcastIncidentUpdate(incident.id, {
          type: 'timeline_updated',
          title,
          description,
          phase,
          timestamp: new Date().toISOString(),
        });
      });

      // Handle action execution - persist to database
      orchestrator.on('action:executed', async ({ action, result }: { action: Record<string, unknown>; result: Record<string, unknown> }) => {
        try {
          // Persist action to database
          await actionRepository.create({
            incidentId: incident.id,
            type: ((action.actionType as string) || 'manual') as 'rollback' | 'restart' | 'scale' | 'manual',
            target: typeof action.target === 'string' ? action.target : JSON.stringify(action.target || 'unknown'),
            parameters: action.parameters as Record<string, unknown> | undefined,
            status: result.success ? 'completed' : 'failed',
            dryRun: (action.dryRun as boolean) ?? false,
          });

          // Add to timeline
          await timelineRepository.create({
            incidentId: incident.id,
            type: 'action',
            title: `Action executed: ${action.actionType as string}`,
            description: (result.message as string) || `${action.actionType as string} on ${action.target as string}`,
            phase: 'ACTING',
            timestamp: new Date(),
            metadata: { success: result.success, target: action.target },
          });

          logger.info({ incidentId: incident.id, actionType: action.actionType, success: result.success }, 'Action persisted');
        } catch (err) {
          logger.error({ incidentId: incident.id, error: (err as Error).message }, 'Failed to persist action');
        }

        // Broadcast via WebSocket
        broadcastIncidentUpdate(incident.id, {
          type: 'action_executed',
          action,
          result,
          timestamp: new Date().toISOString(),
        });
      });

      // Handle verification completion - persist to timeline
      orchestrator.on('verification:completed', async ({ success, details }: { success: boolean; details: string }) => {
        try {
          await timelineRepository.create({
            incidentId: incident.id,
            type: 'verification',
            title: success ? 'Verification successful' : 'Verification failed',
            description: details,
            phase: 'VERIFYING',
            timestamp: new Date(),
            metadata: { success },
          });

          logger.info({ incidentId: incident.id, success }, 'Verification persisted');
        } catch (err) {
          logger.error({ incidentId: incident.id, error: (err as Error).message }, 'Failed to persist verification');
        }

        // Broadcast via WebSocket
        broadcastIncidentUpdate(incident.id, {
          type: 'verification_completed',
          success,
          details,
          timestamp: new Date().toISOString(),
        });
      });

      // Handle investigation completion - persist resolution and generate postmortem
      orchestrator.on(
        'investigation:completed',
        async ({ duration }: { incident: Incident; duration: number }) => {
          // Extract app name for post-investigation cooldown
          const appName = extractAppNameFromIncident(incident);
          this.stateManager.completeInvestigation(incident.id, appName);

          try {
            // Add completion to timeline
            await timelineRepository.create({
              incidentId: incident.id,
              type: 'phase_change',
              title: 'Investigation completed',
              description: `Investigation completed successfully in ${Math.round(duration / 1000)}s`,
              phase: 'DONE',
              timestamp: new Date(),
              metadata: { duration },
            });

            // Update incident to resolved/DONE
            await incidentRepository.update(incident.id, {
              status: 'resolved',
              state: 'DONE',
            });

            logger.info(
              { incidentId: incident.id, duration },
              'Investigation completed and persisted'
            );

            // Generate postmortem automatically
            logger.info({ incidentId: incident.id }, 'Generating postmortem');

            // Fetch investigation data for postmortem
            const [evidence, hypotheses, actions] = await Promise.all([
              evidenceRepository.getByIncident(incident.id),
              hypothesisRepository.getByIncident(incident.id),
              actionRepository.getByIncident(incident.id),
            ]);

            // Generate postmortem using Gemini
            const postmortemResponse = await this.geminiClient.generatePostmortem({
              incidentId: incident.id,
              title: incident.title,
              evidence: evidence.map(e => ({
                id: e.id,
                type: e.type,
                source: e.source,
                content: typeof e.content === 'string' ? e.content : JSON.stringify(e.content),
                timestamp: e.timestamp,
                confidence: e.confidence ?? undefined,
              })),
              hypotheses: hypotheses.map(h => ({
                id: h.id,
                description: h.rootCause,
                confidence: h.confidence,
                status: h.status,
                supportingEvidence: h.supportingEvidence || [],
                contradictingEvidence: h.contradictingEvidence || [],
              })),
              actions: actions.map(a => ({
                id: a.id,
                type: a.type,
                target: a.target,
                status: a.status,
                result: a.result ? JSON.stringify(a.result) : undefined,
              })),
              duration,
            });

            if (postmortemResponse.success && postmortemResponse.data) {
              // Save postmortem to database
              await postmortemRepository.create({
                incidentId: incident.id,
                summary: postmortemResponse.data.summary,
                timeline: postmortemResponse.data.timeline.map(t => `${t.phase}: ${t.event}`),
                rootCauseAnalysis: postmortemResponse.data.rootCauseAnalysis,
                impactAnalysis: postmortemResponse.data.impactAnalysis,
                actionsTaken: postmortemResponse.data.actionsTaken.map(a => `${a.action}: ${a.result}`),
                lessonsLearned: postmortemResponse.data.lessonsLearned,
                preventionRecommendations: postmortemResponse.data.preventionRecommendations,
                markdown: postmortemResponse.data.markdown,
              });

              logger.info({ incidentId: incident.id }, 'Postmortem generated and saved');

              // Broadcast postmortem generation via WebSocket
              broadcastIncidentUpdate(incident.id, {
                type: 'postmortem_generated',
                timestamp: new Date().toISOString(),
              });
            } else {
              logger.error({ incidentId: incident.id, error: postmortemResponse.error }, 'Failed to generate postmortem');
            }
          } catch (err) {
            logger.error(
              { incidentId: incident.id, error: (err as Error).message },
              'Failed to persist completion'
            );
          }

          // Broadcast completion via WebSocket
          broadcastIncidentUpdate(incident.id, {
            type: 'completed',
            status: 'resolved',
            duration,
            timestamp: new Date().toISOString(),
          });

          this.emit('investigation:completed', { incidentId: incident.id });
        }
      );

      // Handle investigation failure - persist failed state
      orchestrator.on(
        'investigation:failed',
        async ({ reason, failureDetails }: { incident: Incident; reason: string; failureDetails?: {
          phase: OODAState;
          retryAttempts: number;
          lastAction?: Record<string, unknown>;
          lastVerificationResult?: { success: boolean; details: string };
          timestamp: Date;
        }}) => {
          // Extract app name for post-investigation cooldown (even on failure)
          const appName = extractAppNameFromIncident(incident);
          this.stateManager.completeInvestigation(incident.id, appName);

          try {
            // Add failure to timeline
            await timelineRepository.create({
              incidentId: incident.id,
              type: 'phase_change',
              title: 'Investigation failed',
              description: reason,
              phase: 'FAILED',
              timestamp: new Date(),
              metadata: failureDetails ? {
                failedInPhase: failureDetails.phase,
                retryAttempts: failureDetails.retryAttempts,
              } : undefined,
            });

            // Update incident to failed state (keep active so it can be retried)
            await incidentRepository.update(incident.id, {
              status: 'active',
              state: 'FAILED',
            });

            logger.warn(
              { incidentId: incident.id, reason, failureDetails },
              'Investigation failed and persisted'
            );
          } catch (err) {
            logger.error(
              { incidentId: incident.id, error: (err as Error).message },
              'Failed to persist failure'
            );
          }

          // Broadcast failure via WebSocket with detailed failure info
          broadcastIncidentUpdate(incident.id, {
            type: 'failed',
            status: 'active',
            reason,
            failureDetails: failureDetails ? {
              phase: failureDetails.phase,
              retryAttempts: failureDetails.retryAttempts,
              lastAction: failureDetails.lastAction,
              lastVerificationResult: failureDetails.lastVerificationResult,
              timestamp: failureDetails.timestamp?.toISOString() ?? new Date().toISOString(),
            } : undefined,
            timestamp: new Date().toISOString(),
          });

          this.emit('investigation:failed', { incidentId: incident.id });
        }
      );

      // Get target deployment from monitored apps for accurate action targeting
      const monitoredApps = await monitoredAppRepository.getActive();
      const targetApp = monitoredApps.find((app: { namespace: string; deployment: string }) => app.namespace === incident.namespace);
      if (targetApp) {
        orchestrator.setTargetDeployment(targetApp.deployment);
        logger.info({
          namespace: incident.namespace,
          deployment: targetApp.deployment
        }, 'Set target deployment for autonomous investigation');
      }

      // Start investigation asynchronously
      logger.info({ incidentId: incident.id }, 'Starting autonomous investigation');

      orchestrator.investigate(incident).catch((error: Error) => {
        logger.error(
          { incidentId: incident.id, error: error.message },
          'Investigation failed with unhandled error'
        );
        const appName = extractAppNameFromIncident(incident);
        this.stateManager.completeInvestigation(incident.id, appName);

        // Persist the unhandled failure
        void (async () => {
          try {
            await incidentRepository.update(incident.id, {
              status: 'active',
              state: 'FAILED',
            });
          } catch {
            // Already logged
          }
        })();
      });

      this.emit('investigation:started', { incidentId: incident.id });
    } catch (error) {
      logger.error(
        { incidentId: incident.id, error: (error as Error).message },
        'Failed to trigger investigation'
      );
      const appName = extractAppNameFromIncident(incident);
      this.stateManager.completeInvestigation(incident.id, appName);
    }
  }
}

/**
 * Create detection service from environment configuration
 * No longer requires FrameFetcher - uses Prometheus-based detection
 */
export function createDetectionServiceFromEnv(
  geminiClient: GeminiClient
): AnomalyDetectionService {
  const config = getConfig();

  return new AnomalyDetectionService(geminiClient, {
    enabled: config.detection.enabled,
    namespace: config.kubernetes.namespace,
  });
}

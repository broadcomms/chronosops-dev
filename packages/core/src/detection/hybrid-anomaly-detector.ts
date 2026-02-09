/**
 * Hybrid Anomaly Detector
 * Combines Prometheus metrics (fast, precise) with Gemini Vision (context-rich)
 * for comprehensive anomaly detection across all monitored apps
 */

import { EventEmitter } from 'events';
import { createChildLogger } from '@chronosops/shared';
import type { AnomalyDetection, FrameAnalysisResponse } from '@chronosops/gemini';
import { monitoredAppRepository, type MonitoredApp } from '@chronosops/database';
import {
  PrometheusClient,
  createPrometheusClientFromEnv,
  type PrometheusMetricAnomaly,
  type MetricCheckResult,
} from './prometheus-client.js';
import { DetectionStateManager } from './detection-state-manager.js';
import type { FrameFetcher, FrameAnalyzer } from './anomaly-detector.js';

const logger = createChildLogger({ component: 'HybridAnomalyDetector' });

/**
 * Configuration for hybrid detection
 */
export interface HybridAnomalyDetectorConfig {
  // Prometheus polling (fast)
  metricsPollingIntervalMs: number;
  // Vision polling (slower, context-rich)
  visionPollingIntervalMs: number;
  // Detection mode
  mode: 'prometheus' | 'vision' | 'hybrid';
  // Severity thresholds
  minSeverity: 'low' | 'medium' | 'high' | 'critical';
  minConfidence: number;
  // Screen capture URL
  screenCaptureUrl: string;
}

const DEFAULT_CONFIG: HybridAnomalyDetectorConfig = {
  metricsPollingIntervalMs: 15000,   // 15 seconds for metrics
  visionPollingIntervalMs: 30000,    // 30 seconds for vision
  mode: 'hybrid',
  minSeverity: 'medium',  // Lowered from 'high' to detect 10%+ error rates
  minConfidence: 0.7,
  screenCaptureUrl: 'http://localhost:4000',
};

const SEVERITY_LEVELS: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/**
 * Hybrid anomaly event - includes source information
 */
export interface HybridAnomalyEvent {
  source: 'prometheus' | 'vision' | 'combined';
  anomaly: AnomalyDetection | PrometheusMetricAnomaly;
  timestamp: Date;
  app?: MonitoredApp;
  frameAnalysis?: FrameAnalysisResponse;
  metricsContext?: MetricCheckResult;
}

/**
 * Events emitted by HybridAnomalyDetector
 */
export interface HybridAnomalyDetectorEvents {
  'anomaly:detected': (event: HybridAnomalyEvent) => void;
  'detection:started': () => void;
  'detection:stopped': () => void;
  'detection:error': (error: Error, source: 'prometheus' | 'vision') => void;
  'detection:healthy': (source: 'prometheus' | 'vision') => void;
  'metrics:checked': (result: MetricCheckResult) => void;
}

/**
 * HybridAnomalyDetector - Multi-modal anomaly detection
 */
export class HybridAnomalyDetector extends EventEmitter {
  private config: HybridAnomalyDetectorConfig;
  private stateManager: DetectionStateManager;
  private prometheusClient: PrometheusClient;
  private frameFetcher?: FrameFetcher;
  private frameAnalyzer?: FrameAnalyzer;

  private metricsInterval: NodeJS.Timeout | null = null;
  private visionInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  private lastMetricsCheckTime: Date | null = null;
  private lastVisionCheckTime: Date | null = null;
  private consecutiveMetricsErrors = 0;
  private consecutiveVisionErrors = 0;
  private readonly MAX_CONSECUTIVE_ERRORS = 5;

  constructor(
    stateManager: DetectionStateManager,
    config: Partial<HybridAnomalyDetectorConfig> = {},
    frameFetcher?: FrameFetcher,
    frameAnalyzer?: FrameAnalyzer
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stateManager = stateManager;
    this.prometheusClient = createPrometheusClientFromEnv();
    this.frameFetcher = frameFetcher;
    this.frameAnalyzer = frameAnalyzer;
  }

  /**
   * Start hybrid detection
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Already running');
      return;
    }

    logger.info(
      {
        mode: this.config.mode,
        metricsIntervalMs: this.config.metricsPollingIntervalMs,
        visionIntervalMs: this.config.visionPollingIntervalMs,
      },
      'Starting hybrid anomaly detection'
    );

    this.isRunning = true;
    this.consecutiveMetricsErrors = 0;
    this.consecutiveVisionErrors = 0;

    // Start Prometheus metrics polling
    if (this.config.mode === 'prometheus' || this.config.mode === 'hybrid') {
      const prometheusAvailable = await this.prometheusClient.isAvailable();
      if (prometheusAvailable) {
        this.metricsInterval = setInterval(() => {
          void this.runMetricsCheck();
        }, this.config.metricsPollingIntervalMs);

        // Run initial check
        void this.runMetricsCheck();
        logger.info('Prometheus metrics polling started');
      } else {
        logger.warn('Prometheus not available - metrics polling disabled');
      }
    }

    // Start vision polling
    if (this.config.mode === 'vision' || this.config.mode === 'hybrid') {
      if (this.frameFetcher && this.frameAnalyzer) {
        this.visionInterval = setInterval(() => {
          void this.runVisionCheck();
        }, this.config.visionPollingIntervalMs);

        // Run initial check after metrics
        setTimeout(() => {
          void this.runVisionCheck();
        }, 5000);
        logger.info('Vision polling started');
      } else {
        logger.warn('Frame fetcher/analyzer not configured - vision polling disabled');
      }
    }

    this.emit('detection:started');
  }

  /**
   * Stop detection
   */
  stop(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
    if (this.visionInterval) {
      clearInterval(this.visionInterval);
      this.visionInterval = null;
    }
    this.isRunning = false;
    logger.info('Stopped hybrid anomaly detection');
    this.emit('detection:stopped');
  }

  /**
   * Check if running
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get detection status
   */
  getStatus(): {
    running: boolean;
    mode: string;
    lastMetricsCheckTime: Date | null;
    lastVisionCheckTime: Date | null;
    consecutiveMetricsErrors: number;
    consecutiveVisionErrors: number;
    stateManagerStatus: ReturnType<DetectionStateManager['getState']>;
  } {
    return {
      running: this.isRunning,
      mode: this.config.mode,
      lastMetricsCheckTime: this.lastMetricsCheckTime,
      lastVisionCheckTime: this.lastVisionCheckTime,
      consecutiveMetricsErrors: this.consecutiveMetricsErrors,
      consecutiveVisionErrors: this.consecutiveVisionErrors,
      stateManagerStatus: this.stateManager.getState(),
    };
  }

  /**
   * Run metrics check against Prometheus
   */
  private async runMetricsCheck(): Promise<void> {
    try {
      // Get all active monitored apps
      const apps = await monitoredAppRepository.getActive();
      if (apps.length === 0) {
        logger.debug('No monitored apps - skipping metrics check');
        return;
      }

      // Check metrics for all apps
      const result = await this.prometheusClient.checkMetrics(
        apps.map(a => ({
          namespace: a.namespace,
          deployment: a.deployment,
          displayName: a.displayName,
        }))
      );

      this.lastMetricsCheckTime = new Date();
      this.emit('metrics:checked', result);

      if (!result.success) {
        throw new Error(result.error || 'Metrics check failed');
      }

      this.consecutiveMetricsErrors = 0;
      this.emit('detection:healthy', 'prometheus');

      // Process anomalies
      await this.processMetricAnomalies(result.anomalies, apps);
    } catch (error) {
      this.handleError(error as Error, 'prometheus');
    }
  }

  /**
   * Run vision check using Gemini
   */
  private async runVisionCheck(): Promise<void> {
    if (!this.frameFetcher || !this.frameAnalyzer) {
      return;
    }

    try {
      // Check if screen capture is available
      const available = await this.frameFetcher.isAvailable();
      if (!available) {
        logger.debug('Screen capture not available - skipping vision check');
        return;
      }

      // Fetch latest frame
      const frame = await this.frameFetcher.getLatestFrame();
      if (!frame) {
        logger.debug('No frame available - skipping vision check');
        return;
      }

      // Analyze frame with Gemini
      const analysisResult = await this.frameAnalyzer.analyzeFrames({
        incidentId: 'hybrid-detection',
        frames: [
          {
            data: frame.data,
            timestamp: frame.timestamp,
            mimeType: frame.mimeType,
          },
        ],
        context: 'Hybrid monitoring: Analyze unified dashboard for anomalies across all ChronosOps-managed applications.',
      });

      this.lastVisionCheckTime = new Date();

      if (!analysisResult.success || !analysisResult.data) {
        throw new Error(analysisResult.error || 'Vision analysis failed');
      }

      this.consecutiveVisionErrors = 0;
      this.emit('detection:healthy', 'vision');

      // Process vision anomalies
      await this.processVisionAnomalies(analysisResult.data);
    } catch (error) {
      this.handleError(error as Error, 'vision');
    }
  }

  /**
   * Process anomalies from Prometheus metrics
   */
  private async processMetricAnomalies(
    anomalies: PrometheusMetricAnomaly[],
    apps: MonitoredApp[]
  ): Promise<void> {
    if (anomalies.length === 0) {
      logger.debug('No metric anomalies detected');
      return;
    }

    logger.info({ anomalyCount: anomalies.length }, 'Processing metric anomalies');

    for (const anomaly of anomalies) {
      // Filter by severity
      if (!this.meetsMinSeverity(anomaly.severity)) {
        logger.info({
          type: anomaly.type,
          severity: anomaly.severity,
          minSeverity: this.config.minSeverity,
          app: anomaly.app,
        }, 'Skipping anomaly - below minimum severity threshold');
        continue;
      }

      // Find the app
      const app = apps.find(
        a => a.namespace === anomaly.namespace && a.deployment === anomaly.app
      );

      // Check state manager with app context for post-investigation cooldown
      const { shouldTrigger, reason } = this.stateManager.shouldTriggerIncident(
        anomaly.type,
        anomaly.severity,
        anomaly.description,
        anomaly.app  // Pass app name for post-investigation cooldown check
      );

      if (!shouldTrigger) {
        logger.info({ type: anomaly.type, severity: anomaly.severity, app: anomaly.app, reason }, 'Skipping anomaly - state manager blocked');
        continue;
      }

      // Record and emit
      this.stateManager.recordAnomaly(anomaly.type, anomaly.description);

      logger.info(
        {
          type: anomaly.type,
          severity: anomaly.severity,
          app: anomaly.app,
          value: anomaly.value,
        },
        'Metric anomaly detected'
      );

      this.emit('anomaly:detected', {
        source: 'prometheus',
        anomaly,
        timestamp: new Date(),
        app,
      } satisfies HybridAnomalyEvent);
    }
  }

  /**
   * Process anomalies from Gemini Vision
   */
  private async processVisionAnomalies(analysis: FrameAnalysisResponse): Promise<void> {
    const { anomalies } = analysis;

    if (!anomalies || anomalies.length === 0) {
      logger.debug('No vision anomalies detected');
      return;
    }

    logger.info({ anomalyCount: anomalies.length }, 'Processing vision anomalies');

    for (const anomaly of anomalies) {
      // Filter by severity
      if (!this.meetsMinSeverity(anomaly.severity)) {
        continue;
      }

      // Filter by confidence
      if (anomaly.confidence < this.config.minConfidence) {
        continue;
      }

      // Check state manager
      const { shouldTrigger, reason } = this.stateManager.shouldTriggerIncident(
        anomaly.type,
        anomaly.severity,
        anomaly.description
      );

      if (!shouldTrigger) {
        logger.debug({ type: anomaly.type, reason }, 'Skipping vision anomaly');
        continue;
      }

      // Record and emit
      this.stateManager.recordAnomaly(anomaly.type, anomaly.description);

      logger.info(
        {
          type: anomaly.type,
          severity: anomaly.severity,
          confidence: anomaly.confidence,
        },
        'Vision anomaly detected'
      );

      this.emit('anomaly:detected', {
        source: 'vision',
        anomaly,
        timestamp: new Date(),
        frameAnalysis: analysis,
      } satisfies HybridAnomalyEvent);
    }
  }

  /**
   * Check if severity meets threshold
   */
  private meetsMinSeverity(severity: string): boolean {
    const anomalySeverity = SEVERITY_LEVELS[severity] ?? 0;
    const minSeverity = SEVERITY_LEVELS[this.config.minSeverity] ?? 3;
    return anomalySeverity >= minSeverity;
  }

  /**
   * Handle errors
   */
  private handleError(error: Error, source: 'prometheus' | 'vision'): void {
    if (source === 'prometheus') {
      this.consecutiveMetricsErrors++;
      logger.error(
        { errorMessage: error.message, consecutiveErrors: this.consecutiveMetricsErrors },
        'Prometheus check error'
      );

      if (this.consecutiveMetricsErrors >= this.MAX_CONSECUTIVE_ERRORS) {
        logger.error('Too many Prometheus errors - disabling metrics polling');
        if (this.metricsInterval) {
          clearInterval(this.metricsInterval);
          this.metricsInterval = null;
        }
      }
    } else {
      this.consecutiveVisionErrors++;
      logger.error(
        { errorMessage: error.message, consecutiveErrors: this.consecutiveVisionErrors },
        'Vision check error'
      );

      if (this.consecutiveVisionErrors >= this.MAX_CONSECUTIVE_ERRORS) {
        logger.error('Too many vision errors - disabling vision polling');
        if (this.visionInterval) {
          clearInterval(this.visionInterval);
          this.visionInterval = null;
        }
      }
    }

    this.emit('detection:error', error, source);

    // Stop completely if both are disabled
    if (!this.metricsInterval && !this.visionInterval) {
      this.stop();
    }
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<HybridAnomalyDetectorConfig>): void {
    const wasRunning = this.isRunning;

    if (wasRunning) {
      this.stop();
    }

    this.config = { ...this.config, ...newConfig };

    if (wasRunning) {
      void this.start();
    }

    logger.info({ config: this.config }, 'Updated hybrid detection configuration');
  }

  /**
   * Get current configuration
   */
  getConfig(): HybridAnomalyDetectorConfig {
    return { ...this.config };
  }
}

/**
 * Create HybridAnomalyDetector from environment
 */
export function createHybridAnomalyDetectorFromEnv(
  stateManager: DetectionStateManager,
  frameFetcher?: FrameFetcher,
  frameAnalyzer?: FrameAnalyzer
): HybridAnomalyDetector {
  const mode = (process.env.ANOMALY_DETECTION_MODE ?? 'hybrid') as 'prometheus' | 'vision' | 'hybrid';

  return new HybridAnomalyDetector(
    stateManager,
    {
      mode,
      metricsPollingIntervalMs: parseInt(process.env.METRICS_POLLING_INTERVAL_MS ?? '15000', 10),
      visionPollingIntervalMs: parseInt(process.env.VISION_POLLING_INTERVAL_MS ?? '30000', 10),
      screenCaptureUrl: process.env.SCREEN_CAPTURE_URL ?? 'http://localhost:4000',
    },
    frameFetcher,
    frameAnalyzer
  );
}

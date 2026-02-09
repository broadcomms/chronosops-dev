/**
 * Anomaly Detector
 * Autonomous detection of anomalies via continuous dashboard monitoring
 * Uses VideoWatcher for frame capture and GeminiClient for AI analysis
 */

import { EventEmitter } from 'events';
import { createChildLogger } from '@chronosops/shared';
import type { AnomalyDetection, FrameAnalysisResponse } from '@chronosops/gemini';
import { DetectionStateManager } from './detection-state-manager';

const logger = createChildLogger({ component: 'AnomalyDetector' });

/**
 * Detection configuration
 */
export interface AnomalyDetectorConfig {
  pollingIntervalMs: number;
  minSeverity: 'low' | 'medium' | 'high' | 'critical';
  minConfidence: number;
  screenCaptureUrl: string;
}

const DEFAULT_CONFIG: AnomalyDetectorConfig = {
  pollingIntervalMs: 30000, // 30 seconds
  minSeverity: 'high',
  minConfidence: 0.7,
  screenCaptureUrl: 'http://localhost:4000',
};

/**
 * Severity levels for comparison
 */
const SEVERITY_LEVELS: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/**
 * Detected anomaly event payload
 */
export interface DetectedAnomalyEvent {
  anomaly: AnomalyDetection;
  timestamp: Date;
  frameAnalysis: FrameAnalysisResponse;
}

/**
 * Frame fetcher interface (implemented by VideoWatcher or API service)
 */
export interface FrameFetcher {
  getLatestFrame(): Promise<{ data: string; timestamp: Date; mimeType: string } | null>;
  isAvailable(): Promise<boolean>;
}

/**
 * Frame analyzer interface (implemented by GeminiClient)
 */
export interface FrameAnalyzer {
  analyzeFrames(request: {
    incidentId: string;
    frames: Array<{ data: string | Buffer; timestamp: Date; mimeType?: string }>;
    context?: string;
  }): Promise<{
    success: boolean;
    data?: FrameAnalysisResponse;
    error?: string;
  }>;
}

/**
 * AnomalyDetector events
 */
export interface AnomalyDetectorEvents {
  'anomaly:detected': (event: DetectedAnomalyEvent) => void;
  'detection:started': () => void;
  'detection:stopped': () => void;
  'detection:error': (error: Error) => void;
  'detection:healthy': () => void;
}

/**
 * AnomalyDetector - Autonomous dashboard monitoring and anomaly detection
 */
export class AnomalyDetector extends EventEmitter {
  private config: AnomalyDetectorConfig;
  private stateManager: DetectionStateManager;
  private frameFetcher: FrameFetcher;
  private frameAnalyzer: FrameAnalyzer;
  private pollInterval: NodeJS.Timeout | null = null;
  private isPolling = false;
  private lastAnalysisTime: Date | null = null;
  private consecutiveErrors = 0;
  private readonly MAX_CONSECUTIVE_ERRORS = 5;

  constructor(
    frameFetcher: FrameFetcher,
    frameAnalyzer: FrameAnalyzer,
    stateManager: DetectionStateManager,
    config: Partial<AnomalyDetectorConfig> = {}
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.frameFetcher = frameFetcher;
    this.frameAnalyzer = frameAnalyzer;
    this.stateManager = stateManager;
  }

  /**
   * Start autonomous detection polling
   */
  start(): void {
    if (this.pollInterval) {
      logger.warn('Already running');
      return;
    }

    logger.info(
      { pollingIntervalMs: this.config.pollingIntervalMs, minSeverity: this.config.minSeverity },
      'Starting autonomous anomaly detection'
    );

    this.isPolling = true;
    this.consecutiveErrors = 0;

    // Start polling
    this.pollInterval = setInterval(() => {
      void this.runDetectionCycle();
    }, this.config.pollingIntervalMs);

    // Run initial detection immediately
    void this.runDetectionCycle();

    this.emit('detection:started');
  }

  /**
   * Stop autonomous detection
   */
  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isPolling = false;
    logger.info('Stopped autonomous anomaly detection');
    this.emit('detection:stopped');
  }

  /**
   * Check if detection is running
   */
  isRunning(): boolean {
    return this.isPolling;
  }

  /**
   * Get detection status
   */
  getStatus(): {
    running: boolean;
    lastAnalysisTime: Date | null;
    consecutiveErrors: number;
    stateManagerStatus: ReturnType<DetectionStateManager['getState']>;
  } {
    return {
      running: this.isPolling,
      lastAnalysisTime: this.lastAnalysisTime,
      consecutiveErrors: this.consecutiveErrors,
      stateManagerStatus: this.stateManager.getState(),
    };
  }

  /**
   * Run a single detection cycle
   */
  private async runDetectionCycle(): Promise<void> {
    try {
      // Check if screen capture is available
      const available = await this.frameFetcher.isAvailable();
      if (!available) {
        logger.debug('Screen capture not available, skipping cycle');
        return;
      }

      // Fetch latest frame
      const frame = await this.frameFetcher.getLatestFrame();
      if (!frame) {
        logger.debug('No frame available, skipping cycle');
        return;
      }

      // Analyze frame with Gemini
      const analysisResult = await this.frameAnalyzer.analyzeFrames({
        incidentId: 'autonomous-detection', // Placeholder ID for detection-only analysis
        frames: [
          {
            data: frame.data,
            timestamp: frame.timestamp,
            mimeType: frame.mimeType,
          },
        ],
        context: 'Autonomous monitoring: Analyze dashboard for anomalies, errors, or concerning patterns.',
      });

      this.lastAnalysisTime = new Date();

      if (!analysisResult.success || !analysisResult.data) {
        logger.warn({ error: analysisResult.error }, 'Frame analysis failed');
        this.handleError(new Error(analysisResult.error || 'Analysis failed'));
        return;
      }

      // Reset consecutive errors on success
      this.consecutiveErrors = 0;
      this.emit('detection:healthy');

      // Process detected anomalies
      await this.processAnomalies(analysisResult.data);
    } catch (error) {
      this.handleError(error as Error);
    }
  }

  /**
   * Process detected anomalies from frame analysis
   */
  private async processAnomalies(analysis: FrameAnalysisResponse): Promise<void> {
    const { anomalies } = analysis;

    if (!anomalies || anomalies.length === 0) {
      logger.debug('No anomalies detected in frame');
      return;
    }

    logger.info({ anomalyCount: anomalies.length }, 'Processing detected anomalies');

    for (const anomaly of anomalies) {
      // Filter by severity
      if (!this.meetsMinSeverity(anomaly.severity)) {
        logger.debug(
          { type: anomaly.type, severity: anomaly.severity, minSeverity: this.config.minSeverity },
          'Anomaly below minimum severity threshold'
        );
        continue;
      }

      // Filter by confidence
      if (anomaly.confidence < this.config.minConfidence) {
        logger.debug(
          { type: anomaly.type, confidence: anomaly.confidence, minConfidence: this.config.minConfidence },
          'Anomaly below confidence threshold'
        );
        continue;
      }

      // Check if we should trigger for this anomaly
      const { shouldTrigger, reason } = this.stateManager.shouldTriggerIncident(
        anomaly.type,
        anomaly.severity,
        anomaly.description
      );

      if (!shouldTrigger) {
        logger.info({ type: anomaly.type, reason }, 'Skipping anomaly due to state manager');
        continue;
      }

      // Record the anomaly
      this.stateManager.recordAnomaly(anomaly.type, anomaly.description);

      // Emit detection event
      logger.info(
        {
          type: anomaly.type,
          severity: anomaly.severity,
          confidence: anomaly.confidence,
          description: anomaly.description,
        },
        'High-confidence anomaly detected, triggering incident'
      );

      this.emit('anomaly:detected', {
        anomaly,
        timestamp: new Date(),
        frameAnalysis: analysis,
      } satisfies DetectedAnomalyEvent);
    }
  }

  /**
   * Check if anomaly meets minimum severity threshold
   */
  private meetsMinSeverity(severity: string): boolean {
    const anomalySeverity = SEVERITY_LEVELS[severity] ?? 0;
    const minSeverity = SEVERITY_LEVELS[this.config.minSeverity] ?? 3;
    return anomalySeverity >= minSeverity;
  }

  /**
   * Handle detection errors
   */
  private handleError(error: Error): void {
    this.consecutiveErrors++;
    logger.error(
      { errorMessage: error.message, consecutiveErrors: this.consecutiveErrors },
      'Detection cycle error'
    );

    this.emit('detection:error', error);

    // Stop if too many consecutive errors
    if (this.consecutiveErrors >= this.MAX_CONSECUTIVE_ERRORS) {
      logger.error(
        { maxErrors: this.MAX_CONSECUTIVE_ERRORS },
        'Too many consecutive errors, stopping detection'
      );
      this.stop();
    }
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<AnomalyDetectorConfig>): void {
    const wasRunning = this.isPolling;

    if (wasRunning) {
      this.stop();
    }

    this.config = { ...this.config, ...newConfig };

    if (wasRunning) {
      this.start();
    }

    logger.info({ config: this.config }, 'Updated detection configuration');
  }

  /**
   * Get current configuration
   */
  getConfig(): AnomalyDetectorConfig {
    return { ...this.config };
  }
}

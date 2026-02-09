/**
 * Vision Service - Orchestrates the Unified Vision Stream pipeline
 *
 * Connects Prometheus metrics → Server-side rendering → MJPEG streaming
 * with Gemini Vision analysis integration.
 */

import EventEmitter from 'eventemitter3';
import type { ServerResponse } from 'node:http';
import { createChildLogger, getConfig } from '@chronosops/shared';
import {
  FrameCompositor,
  MJPEGStreamer,
  RecordingService,
  type ServiceMetrics,
  type MetricSeries,
  type AIAnnotation,
  type FrameData,
  type CompositorConfig,
} from '@chronosops/vision';
import { K8sClient } from '@chronosops/kubernetes';
import { PrometheusClient, createPrometheusClientFromEnv } from '../detection/prometheus-client.js';

const logger = createChildLogger({ component: 'VisionService' });

/**
 * Vision Service events
 */
export interface VisionServiceEvents {
  /** New frame ready for analysis */
  frame: (data: FrameData) => void;
  /** Service monitoring started */
  monitoringStarted: (serviceName: string) => void;
  /** Service monitoring stopped */
  monitoringStopped: (serviceName: string) => void;
  /** Error occurred */
  error: (error: Error) => void;
}

/**
 * Vision Service configuration
 */
export interface VisionServiceConfig {
  /** Frames per second */
  fps: number;
  /** Frame width */
  width: number;
  /** Frame height */
  height: number;
  /** JPEG quality (0-100) */
  quality: number;
  /** Recording output directory */
  recordingDir: string;
  /** Prometheus query time range */
  metricsTimeRange: string;
  /** Prometheus step interval */
  metricsStep: string;
}

const DEFAULT_CONFIG: VisionServiceConfig = {
  fps: 2,
  width: 1280,
  height: 720,
  quality: 85,
  recordingDir: './data/recordings',
  metricsTimeRange: '30m',
  metricsStep: '30s',
};

/**
 * Active service monitoring state
 */
interface MonitoringState {
  serviceName: string;
  namespace: string;
  interval: NodeJS.Timeout;
  frameNumber: number;
}

/**
 * Vision Service - Unified Vision Stream orchestrator
 */
export class VisionService extends EventEmitter<VisionServiceEvents> {
  private config: VisionServiceConfig;
  private compositor: FrameCompositor;
  private streamer: MJPEGStreamer;
  private recorder: RecordingService;
  private prometheus: PrometheusClient;
  private k8sClient: K8sClient | null = null;
  private monitoringStates: Map<string, MonitoringState> = new Map();
  private frameCallbacks: Array<(data: FrameData) => void> = [];

  constructor(config: Partial<VisionServiceConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize components
    const compositorConfig: Partial<CompositorConfig> = {
      width: this.config.width,
      height: this.config.height,
      fps: this.config.fps,
      quality: this.config.quality,
      showTimestamp: true,
      showRecordingIndicator: true,
    };

    this.compositor = new FrameCompositor(compositorConfig);
    this.streamer = new MJPEGStreamer({ fps: this.config.fps, quality: this.config.quality });
    this.recorder = new RecordingService({ outputDir: this.config.recordingDir, fps: this.config.fps });
    this.prometheus = createPrometheusClientFromEnv();

    // Initialize K8s client for fallback metrics
    try {
      const appConfig = getConfig();
      this.k8sClient = new K8sClient({
        allowedNamespaces: appConfig.kubernetes.allowedNamespaces,
        allowedActions: ['rollback', 'restart', 'scale', 'apply', 'create'],
        dryRun: false,
      });
      logger.info('K8s client initialized for metrics fallback');
    } catch (error) {
      logger.warn({ error: error instanceof Error ? error.message : 'Unknown' }, 'K8s client not available - pod metrics will use Prometheus only');
    }

    // Forward streamer frame events
    this.streamer.on('frame', (data) => {
      this.emit('frame', data);
      for (const callback of this.frameCallbacks) {
        try {
          callback(data);
        } catch (error) {
          logger.error({ error: error instanceof Error ? error.message : 'Unknown' }, 'Frame callback error');
        }
      }
    });

    logger.info({ config: this.config }, 'VisionService initialized');
  }

  /**
   * Start monitoring a service
   * @param serviceName - The service/deployment name to monitor
   * @param namespace - The Kubernetes namespace (required)
   */
  async startMonitoring(serviceName: string, namespace: string): Promise<void> {
    if (!namespace) {
      throw new Error('namespace is required for startMonitoring');
    }
    if (this.monitoringStates.has(serviceName)) {
      logger.warn({ serviceName }, 'Already monitoring this service');
      return;
    }

    logger.info({ serviceName, namespace }, 'Starting monitoring');

    const intervalMs = 1000 / this.config.fps;
    let frameNumber = 0;

    const captureFrame = async () => {
      try {
        // Fetch metrics from Prometheus
        const metrics = await this.fetchServiceMetrics(serviceName, namespace);

        // Get current annotations and AI message
        const annotations = this.streamer.getAnnotations(serviceName);
        const aiMessage = this.streamer.getAIMessage(serviceName);

        // Composite frame
        const frame = await this.compositor.compositeFrame(metrics, annotations, aiMessage);

        // Create frame data
        const frameData: FrameData = {
          serviceName,
          frame,
          timestamp: new Date(),
          frameNumber: frameNumber++,
          metrics,
        };

        // Broadcast to all connected clients
        this.streamer.broadcastFrame(serviceName, frameData);

        // Add to active recordings
        const recordingId = this.recorder.getActiveRecordingId(serviceName);
        if (recordingId) {
          this.recorder.addFrame(recordingId, frame);
        }
      } catch (error) {
        logger.error(
          { serviceName, error: error instanceof Error ? error.message : 'Unknown' },
          'Frame capture failed'
        );
      }
    };

    // Capture initial frame
    await captureFrame();

    // Set up interval
    const interval = setInterval(captureFrame, intervalMs);

    this.monitoringStates.set(serviceName, {
      serviceName,
      namespace,
      interval,
      frameNumber,
    });

    this.emit('monitoringStarted', serviceName);
    logger.info({ serviceName }, 'Monitoring started');
  }

  /**
   * Stop monitoring a service
   */
  stopMonitoring(serviceName: string): void {
    const state = this.monitoringStates.get(serviceName);
    if (!state) {
      return;
    }

    clearInterval(state.interval);
    this.monitoringStates.delete(serviceName);
    this.streamer.clearAnnotations(serviceName);
    this.streamer.clearFrameBuffer(serviceName);

    this.emit('monitoringStopped', serviceName);
    logger.info({ serviceName }, 'Monitoring stopped');
  }

  /**
   * Add a streaming client
   */
  addStreamClient(response: ServerResponse, serviceName: string): string {
    return this.streamer.addClient(response, serviceName);
  }

  /**
   * Get latest frame for a service
   */
  getLatestFrame(serviceName: string): FrameData | undefined {
    return this.streamer.getLatestFrame(serviceName);
  }

  /**
   * Get recent frames for a service
   */
  getRecentFrames(serviceName: string, count: number = 5): FrameData[] {
    return this.streamer.getRecentFrames(serviceName, count);
  }

  /**
   * Set AI annotations for a service
   */
  setAnnotations(serviceName: string, annotations: AIAnnotation[]): void {
    this.streamer.setAnnotations(serviceName, annotations);
  }

  /**
   * Set AI message for a service
   */
  setAIMessage(serviceName: string, message: string): void {
    this.streamer.setAIMessage(serviceName, message);
  }

  /**
   * Clear annotations for a service
   */
  clearAnnotations(serviceName: string): void {
    this.streamer.clearAnnotations(serviceName);
    this.streamer.clearAIMessage(serviceName);
  }

  /**
   * Start recording a service
   */
  startRecording(serviceName: string, incidentId?: string): string {
    const recordingId = this.recorder.startRecording(serviceName, incidentId);
    this.compositor.startRecording();
    return recordingId;
  }

  /**
   * Stop recording a service
   */
  async stopRecording(serviceName: string): Promise<{ recordingId: string; outputPath?: string }> {
    const recordingId = this.recorder.getActiveRecordingId(serviceName);
    if (!recordingId) {
      throw new Error(`No active recording for ${serviceName}`);
    }

    this.compositor.stopRecording();
    const recording = await this.recorder.stopRecording(recordingId);
    return {
      recordingId: recording.id,
      outputPath: recording.outputPath,
    };
  }

  /**
   * Check if recording a service
   */
  isRecording(serviceName: string): boolean {
    return this.recorder.isRecording(serviceName);
  }

  /**
   * Register a frame callback for Gemini analysis
   */
  onFrame(callback: (data: FrameData) => void): () => void {
    this.frameCallbacks.push(callback);
    return () => {
      const index = this.frameCallbacks.indexOf(callback);
      if (index !== -1) {
        this.frameCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Get list of monitored services
   */
  getMonitoredServices(): string[] {
    return Array.from(this.monitoringStates.keys());
  }

  /**
   * Check if monitoring a service
   */
  isMonitoring(serviceName: string): boolean {
    return this.monitoringStates.has(serviceName);
  }

  /**
   * Get stream client count
   */
  getClientCount(): number {
    return this.streamer.getClientCount();
  }

  /**
   * Fetch service metrics from Prometheus
   */
  private async fetchServiceMetrics(serviceName: string, namespace: string): Promise<ServiceMetrics> {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - this.parseTimeRange(this.config.metricsTimeRange));

    // Query error rate over time
    // Note: App metrics use app= label set by prometheus relabel config
    const errorRateSeries = await this.queryMetricSeries(
      `sum(rate(http_requests_total{source_namespace="${namespace}", app="${serviceName}", status=~"5.."}[5m])) / sum(rate(http_requests_total{source_namespace="${namespace}", app="${serviceName}"}[5m])) * 100 or vector(0)`,
      startTime,
      endTime
    );

    // Query request rate over time
    const requestRateSeries = await this.queryMetricSeries(
      `sum(rate(http_requests_total{source_namespace="${namespace}", app="${serviceName}"}[1m])) or vector(0)`,
      startTime,
      endTime
    );

    // Query latency (P95) over time
    const latencySeries = await this.queryMetricSeries(
      `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{source_namespace="${namespace}", app="${serviceName}"}[5m])) by (le)) * 1000 or vector(0)`,
      startTime,
      endTime
    );

    // Query current CPU and memory from Prometheus
    // Try container metrics (cAdvisor with pod=~) first, fallback to process metrics (app=)
    const cpuResult = await this.prometheus.query(
      `sum(rate(container_cpu_usage_seconds_total{namespace="${namespace}", pod=~"${serviceName}.*"}[5m])) * 100 or avg(rate(process_cpu_seconds_total{source_namespace="${namespace}", app="${serviceName}"}[1m])) * 100 or vector(0)`
    );
    const memResult = await this.prometheus.query(
      `sum(container_memory_working_set_bytes{namespace="${namespace}", pod=~"${serviceName}.*"}) / 1024 / 1024 or avg(process_resident_memory_bytes{source_namespace="${namespace}", app="${serviceName}"}) / 1024 / 1024 or vector(0)`
    );

    // Query pod count from Prometheus (kube-state-metrics)
    const podResult = await this.prometheus.query(
      `count(kube_pod_status_phase{namespace="${namespace}", pod=~"${serviceName}.*", phase="Running"}) or vector(0)`
    );

    // Fallback to K8s API for pod count if Prometheus returns nothing
    // Handle NaN values from Prometheus (e.g., division by zero when no data)
    let podCount = podResult.value;
    let cpuUsage = cpuResult.value ?? 0;
    let memoryUsage = memResult.value ?? 0;

    // Sanitize NaN and Infinity values for display
    // Infinity occurs when container has no memory limits (division by zero)
    if (isNaN(cpuUsage) || !isFinite(cpuUsage)) cpuUsage = 0;
    if (isNaN(memoryUsage) || !isFinite(memoryUsage)) memoryUsage = 0;

    if ((podCount === undefined || podCount === 0) && this.k8sClient) {
      try {
        const pods = await this.k8sClient.getDeploymentPods(serviceName, namespace);
        const runningPods = pods.filter(p => p.status === 'Running');
        podCount = runningPods.length;
        logger.debug({ serviceName, podCount }, 'Using K8s API fallback for pod count');

        // If we got pods, try to estimate CPU/Memory from process metrics in Prometheus
        // These are from prom-client's collectDefaultMetrics() - available in the app
        // Use app= label (set by prometheus relabel config) for matching
        if (cpuUsage === 0) {
          const processCpuResult = await this.prometheus.query(
            `avg(rate(process_cpu_seconds_total{source_namespace="${namespace}", app="${serviceName}"}[1m])) * 100`
          );
          if (processCpuResult.value !== undefined && isFinite(processCpuResult.value)) {
            cpuUsage = Math.min(processCpuResult.value, 100);
          }
        }
        if (memoryUsage === 0) {
          const processMemResult = await this.prometheus.query(
            `avg(process_resident_memory_bytes{source_namespace="${namespace}", app="${serviceName}"}) / 1024 / 1024 / 512 * 100`
          );
          if (processMemResult.value !== undefined && isFinite(processMemResult.value)) {
            // Estimate as % of 512MB assumed limit
            memoryUsage = Math.min(processMemResult.value, 100);
          }
        }
      } catch (error) {
        logger.debug({ error: error instanceof Error ? error.message : 'Unknown', serviceName }, 'K8s API fallback failed');
        podCount = 1; // Default assumption
      }
    }

    // Determine health status
    const healthStatus = this.determineHealthStatus(
      errorRateSeries.current,
      latencySeries.current,
      cpuUsage,
      memoryUsage
    );

    return {
      serviceName,
      namespace,
      timestamp: new Date(),
      errorRate: errorRateSeries,
      requestRate: requestRateSeries,
      latency: latencySeries,
      cpuUsage,
      memoryUsage,
      podCount: Math.round(podCount ?? 1),
      healthStatus,
    };
  }

  /**
   * Query metric series from Prometheus
   */
  private async queryMetricSeries(
    query: string,
    startTime: Date,
    endTime: Date
  ): Promise<MetricSeries> {
    const result = await this.prometheus.queryRange(
      query,
      startTime,
      endTime,
      this.config.metricsStep
    );

    if (!result.success || !result.values || result.values.length === 0) {
      // Return empty series with zeros
      return this.createEmptySeries(startTime, endTime);
    }

    const values = result.values.map((v) => ({
      timestamp: v.timestamp * 1000,
      value: isNaN(v.value) ? 0 : v.value,
    }));

    const numericValues = values.map((v) => v.value);
    const current = numericValues[numericValues.length - 1] ?? 0;
    const min = Math.min(...numericValues);
    const max = Math.max(...numericValues);
    const avg = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;

    return { values, current, min, max, avg };
  }

  /**
   * Create empty metric series
   */
  private createEmptySeries(startTime: Date, endTime: Date): MetricSeries {
    const stepMs = this.parseTimeRange(this.config.metricsStep);
    const values = [];
    let ts = startTime.getTime();
    while (ts <= endTime.getTime()) {
      values.push({ timestamp: ts, value: 0 });
      ts += stepMs;
    }
    return { values, current: 0, min: 0, max: 0, avg: 0 };
  }

  /**
   * Determine health status from metrics
   */
  private determineHealthStatus(
    errorRate: number,
    latency: number,
    cpu: number,
    memory: number
  ): 'healthy' | 'degraded' | 'critical' | 'unknown' {
    // Handle NaN values - sanitize for comparison
    const safeErrorRate = isNaN(errorRate) ? 0 : errorRate;
    const safeLatency = isNaN(latency) ? 0 : latency;
    const safeCpu = isNaN(cpu) ? 0 : cpu;
    const safeMemory = isNaN(memory) ? 0 : memory;

    // If all metrics are NaN, return unknown
    if (isNaN(errorRate) && isNaN(latency) && isNaN(cpu) && isNaN(memory)) {
      return 'unknown';
    }

    // Critical: error rate > 10% OR latency > 2000ms
    if (safeErrorRate > 10 || safeLatency > 2000) {
      return 'critical';
    }

    // Degraded: error rate > 1% OR latency > 500ms OR resources > 85%
    if (safeErrorRate > 1 || safeLatency > 500 || safeCpu > 85 || safeMemory > 85) {
      return 'degraded';
    }

    return 'healthy';
  }

  /**
   * Parse time range string (e.g., "30m", "1h") to milliseconds
   */
  private parseTimeRange(range: string): number {
    const match = range.match(/^(\d+)([smhd])$/);
    if (!match) {
      return 30 * 60 * 1000; // Default 30 minutes
    }

    const value = parseInt(match[1]!, 10);
    const unit = match[2];

    switch (unit) {
      case 's':
        return value * 1000;
      case 'm':
        return value * 60 * 1000;
      case 'h':
        return value * 60 * 60 * 1000;
      case 'd':
        return value * 24 * 60 * 60 * 1000;
      default:
        return 30 * 60 * 1000;
    }
  }

  /**
   * Shutdown the service
   */
  shutdown(): void {
    // Stop all monitoring
    for (const serviceName of this.monitoringStates.keys()) {
      this.stopMonitoring(serviceName);
    }

    // Close all stream connections
    this.streamer.close();

    logger.info('VisionService shutdown');
  }
}

// Singleton instance
let visionServiceInstance: VisionService | null = null;

/**
 * Get or create VisionService singleton
 */
export function getVisionService(config?: Partial<VisionServiceConfig>): VisionService {
  if (!visionServiceInstance) {
    visionServiceInstance = new VisionService(config);
  }
  return visionServiceInstance;
}

/**
 * Create VisionService from environment
 */
export function createVisionServiceFromEnv(): VisionService {
  return new VisionService({
    fps: parseInt(process.env.VISION_FPS ?? '2', 10),
    width: parseInt(process.env.VISION_WIDTH ?? '1280', 10),
    height: parseInt(process.env.VISION_HEIGHT ?? '720', 10),
    quality: parseInt(process.env.VISION_QUALITY ?? '85', 10),
    recordingDir: process.env.VISION_RECORDING_DIR ?? './data/recordings',
    metricsTimeRange: process.env.VISION_METRICS_TIME_RANGE ?? '30m',
    metricsStep: process.env.VISION_METRICS_STEP ?? '30s',
  });
}

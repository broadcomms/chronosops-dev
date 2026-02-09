/**
 * Detection module - Autonomous anomaly detection
 */

export { DetectionStateManager } from './detection-state-manager';
export type { AnomalyFingerprint, DetectionStateConfig } from './detection-state-manager';

export { AnomalyDetector } from './anomaly-detector';
export type {
  AnomalyDetectorConfig,
  DetectedAnomalyEvent,
  FrameFetcher,
  FrameAnalyzer,
  AnomalyDetectorEvents,
} from './anomaly-detector';

// Prometheus metrics client
export {
  PrometheusClient,
  prometheusClient,
  createPrometheusClientFromEnv,
} from './prometheus-client';
export type {
  PrometheusClientConfig,
  PrometheusQueryResult,
  PrometheusRangeResult,
  PrometheusMetricAnomaly,
  MetricCheckResult,
} from './prometheus-client';

// Hybrid anomaly detector (Prometheus + Gemini Vision)
export {
  HybridAnomalyDetector,
  createHybridAnomalyDetectorFromEnv,
} from './hybrid-anomaly-detector';
export type {
  HybridAnomalyDetectorConfig,
  HybridAnomalyEvent,
  HybridAnomalyDetectorEvents,
} from './hybrid-anomaly-detector';

// Vision frame fetcher (unified vision stream integration)
export { VisionFrameFetcher, createVisionFrameFetcher } from './vision-frame-fetcher';

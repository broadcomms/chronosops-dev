/**
 * Vision Module - Unified Vision Stream for ChronosOps
 */

export {
  VisionService,
  getVisionService,
  createVisionServiceFromEnv,
  type VisionServiceConfig,
  type VisionServiceEvents,
} from './vision-service.js';

// Re-export types from @chronosops/vision for convenience
export type {
  AIAnnotation,
  AIAnnotationType,
  FrameData,
  ServiceMetrics,
  MetricSeries,
  Recording,
  RecordingStatus,
  CompositorConfig,
} from '@chronosops/vision';

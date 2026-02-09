/**
 * ChronosOps Vision Package
 *
 * Server-side chart rendering, MJPEG streaming, and video recording
 * for the Unified Vision Stream architecture.
 */

// Types
export * from './types.js';

// Chart rendering
export { renderLineChart, type LineChartOptions } from './chart/line-chart.js';
export {
  renderGauge,
  renderStatusIndicator,
  renderPodCount,
  type GaugeOptions,
  type GaugeConfig,
} from './chart/gauge-chart.js';
export {
  renderServiceDashboard,
  type DashboardConfig,
} from './chart/chart-renderer.js';

// Frame composition
export { FrameCompositor } from './compositor/frame-compositor.js';
export { drawAnnotations, getPulseOffset } from './compositor/ai-annotations.js';

// Streaming
export {
  MJPEGStreamer,
  type MJPEGStreamerConfig,
  type MJPEGStreamerEvents,
} from './stream/mjpeg-streamer.js';
export {
  FrameBuffer,
  FrameBufferManager,
  type FrameBufferConfig,
} from './stream/frame-buffer.js';

// Recording
export {
  RecordingService,
  type RecordingConfig,
} from './recording/recording-service.js';

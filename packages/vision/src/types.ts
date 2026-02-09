/**
 * Vision Types - Shared types for the ChronosOps Vision Pipeline
 */

/**
 * Configuration for the frame compositor
 */
export interface CompositorConfig {
  /** Frame width in pixels (default: 1280) */
  width: number;
  /** Frame height in pixels (default: 720) */
  height: number;
  /** Frames per second (default: 2) */
  fps: number;
  /** Show timestamp overlay */
  showTimestamp: boolean;
  /** Show recording indicator when recording */
  showRecordingIndicator: boolean;
  /** JPEG quality 0-100 (default: 85) */
  quality: number;
}

/**
 * AI annotation types for overlaying on frames
 */
export type AIAnnotationType = 'highlight' | 'arrow' | 'text' | 'box';

/**
 * Position on the frame
 */
export interface Position {
  x: number;
  y: number;
}

/**
 * Base AI annotation interface
 */
export interface AIAnnotation {
  /** Type of annotation */
  type: AIAnnotationType;
  /** Position on frame */
  position: Position;
  /** Type-specific data */
  data: AIAnnotationData;
}

/**
 * Data for different annotation types
 */
export interface AIAnnotationData {
  /** For highlight: radius of the circle */
  radius?: number;
  /** For arrow: starting X coordinate */
  fromX?: number;
  /** For arrow: starting Y coordinate */
  fromY?: number;
  /** For box: width */
  width?: number;
  /** For box: height */
  height?: number;
  /** For box/text: label text */
  label?: string;
  /** For text: the text content */
  text?: string;
  /** Optional color override */
  color?: string;
}

/**
 * Service metrics data from Prometheus
 */
export interface ServiceMetrics {
  serviceName: string;
  namespace: string;
  timestamp: Date;
  errorRate: MetricSeries;
  requestRate: MetricSeries;
  latency: MetricSeries;
  cpuUsage: number;
  memoryUsage: number;
  podCount: number;
  healthStatus: 'healthy' | 'degraded' | 'critical' | 'unknown';
}

/**
 * Time series metric data
 */
export interface MetricSeries {
  values: MetricValue[];
  current: number;
  min: number;
  max: number;
  avg: number;
}

/**
 * Single metric value at a point in time
 */
export interface MetricValue {
  timestamp: number;
  value: number;
}

/**
 * Frame data emitted by the vision pipeline
 */
export interface FrameData {
  serviceName: string;
  frame: Buffer;
  timestamp: Date;
  frameNumber: number;
  metrics?: ServiceMetrics;
}

/**
 * Recording status
 */
export type RecordingStatus = 'idle' | 'recording' | 'processing' | 'complete' | 'failed';

/**
 * Recording metadata
 */
export interface Recording {
  id: string;
  serviceName: string;
  incidentId?: string;
  startedAt: Date;
  endedAt?: Date;
  frameCount: number;
  status: RecordingStatus;
  outputPath?: string;
  error?: string;
}

/**
 * Stream client information
 */
export interface StreamClient {
  id: string;
  serviceName: string;
  connectedAt: Date;
}

/**
 * Chart configuration
 */
export interface ChartConfig {
  width: number;
  height: number;
  backgroundColor: string;
  gridColor: string;
  textColor: string;
  lineColor: string;
  lineWidth: number;
  padding: ChartPadding;
  showGrid: boolean;
  showLabels: boolean;
  title?: string;
}

/**
 * Chart padding
 */
export interface ChartPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Dashboard panel position
 */
export interface PanelPosition {
  row: number;
  col: number;
  rowSpan?: number;
  colSpan?: number;
}

/**
 * Dashboard panel configuration
 */
export interface DashboardPanel {
  id: string;
  title: string;
  type: 'line' | 'gauge' | 'stat';
  position: PanelPosition;
  metricKey: keyof ServiceMetrics;
}

/**
 * Vision service configuration
 */
export interface VisionConfig {
  /** Frames per second */
  fps: number;
  /** Frame width */
  width: number;
  /** Frame height */
  height: number;
  /** Recording output directory */
  recordingDir: string;
  /** JPEG quality */
  quality: number;
  /** Prometheus URL */
  prometheusUrl: string;
}

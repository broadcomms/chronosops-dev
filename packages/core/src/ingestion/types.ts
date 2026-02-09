/**
 * Ingestion Layer Types
 * Types for log parsing, metric processing, and event streaming
 */

// ===========================================
// Log Types
// ===========================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type LogFormat = 'json' | 'plaintext' | 'kubernetes' | 'auto';

export interface NormalizedLog {
  id: string;
  timestamp: Date;
  level: LogLevel;
  source: string;
  message: string;
  metadata: Record<string, unknown>;
  raw: string;
  // Extracted entities
  errorType?: string;
  stackTrace?: string;
  traceId?: string;
  spanId?: string;
  podName?: string;
  containerName?: string;
}

export interface LogGroup {
  startTime: Date;
  endTime: Date;
  logs: NormalizedLog[];
  errorCount: number;
  warnCount: number;
  dominantLevel: LogLevel;
}

export interface ErrorLog extends NormalizedLog {
  level: 'error' | 'fatal';
  errorType: string;
  occurrences: number;
  firstSeen: Date;
  lastSeen: Date;
  affectedPods: string[];
}

export interface ErrorSpike {
  start: Date;
  end: Date;
  count: number;
  baselineRate: number;
  spikeRate: number;
  types: string[];
  samples: NormalizedLog[];
}

export interface LogParserConfig {
  maxLogAge: number;        // ms - ignore logs older than this
  batchSize: number;        // logs per batch for processing
  errorPatterns: RegExp[];  // custom error detection patterns
  spikeThreshold: number;   // multiplier for spike detection (e.g., 2.0 = 2x baseline)
  timeWindowMs: number;     // window size for grouping/spike detection
}

export interface LogParserResult {
  logs: NormalizedLog[];
  errors: ErrorLog[];
  groups: LogGroup[];
  spikes: ErrorSpike[];
  summary: {
    totalLogs: number;
    errorCount: number;
    warnCount: number;
    timeRange: { start: Date; end: Date };
    dominantLevel: LogLevel;
  };
}

// ===========================================
// Metric Types
// ===========================================

export interface Metric {
  name: string;
  timestamp: Date;
  value: number;
  labels: Record<string, string>;
}

export interface MetricAnomaly {
  metric: string;
  timestamp: Date;
  value: number;
  expectedRange: [number, number];
  deviation: number;  // standard deviations from mean
  severity: 'low' | 'medium' | 'high' | 'critical';
  labels: Record<string, string>;
}

export interface MetricSummary {
  name: string;
  labels: Record<string, string>;
  min: number;
  max: number;
  avg: number;
  current: number;
  trend: 'increasing' | 'decreasing' | 'stable' | 'volatile';
  anomalyScore: number;  // 0-1
  dataPoints: number;
}

export interface MetricComparison {
  metric: string;
  currentValue: number;
  baselineValue: number;
  changePercent: number;
  significant: boolean;
  direction: 'up' | 'down' | 'stable';
}

export interface K8sMetrics {
  cpu: MetricSummary;
  memory: MetricSummary;
  requestRate: MetricSummary;
  errorRate: MetricSummary;
  latencyP99: MetricSummary;
}

export interface MetricProcessorConfig {
  prometheusUrl?: string;
  anomalyThreshold: number;      // standard deviations for anomaly detection
  baselineWindowMs: number;      // time window for baseline calculation
  criticalMetrics: string[];     // metrics that trigger critical alerts
  stepMs: number;                // query step size
}

export interface MetricProcessorResult {
  metrics: Metric[];
  summaries: MetricSummary[];
  anomalies: MetricAnomaly[];
  comparisons: MetricComparison[];
}

// ===========================================
// Event Types
// ===========================================

export type InfraEventType =
  | 'deploy'
  | 'scale'
  | 'config_change'
  | 'restart'
  | 'rollback'
  | 'alert'
  | 'git_push'
  | 'k8s_event'
  | 'pod_crash'
  | 'oom_kill';

export interface InfraEvent {
  id: string;
  type: InfraEventType;
  timestamp: Date;
  description: string;
  actor: string;            // who/what triggered it
  target: string;           // what was affected
  metadata: Record<string, unknown>;
  severity: 'info' | 'warning' | 'critical';
}

export interface GitCommit {
  sha: string;
  message: string;
  author: string;
  timestamp: Date;
  files: string[];
}

export interface Deploy {
  id: string;
  revision: number;
  image: string;
  timestamp: Date;
  triggeredBy: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  namespace: string;
  deployment: string;
}

export interface K8sEvent {
  uid: string;
  type: 'Normal' | 'Warning';
  reason: string;
  message: string;
  involvedObject: {
    kind: string;
    name: string;
    namespace: string;
  };
  firstTimestamp: Date;
  lastTimestamp: Date;
  count: number;
  source: {
    component: string;
    host?: string;
  };
}

export interface EventTimeline {
  events: InfraEvent[];
  deployments: Deploy[];
  startTime: Date;
  endTime: Date;
  summary: {
    totalEvents: number;
    deployCount: number;
    warningCount: number;
    criticalCount: number;
  };
}

export interface EventStreamConfig {
  maxEventAge: number;           // ms - ignore events older than this
  correlationWindowMs: number;   // time window for correlating events with incidents
}

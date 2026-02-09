/**
 * Metric Processor
 * Processes time-series metrics from Prometheus for anomaly detection
 */

import { createChildLogger } from '@chronosops/shared';
import type {
  Metric,
  MetricAnomaly,
  MetricSummary,
  MetricComparison,
  K8sMetrics,
  MetricProcessorConfig,
  MetricProcessorResult,
} from './types.js';

const DEFAULT_CONFIG: MetricProcessorConfig = {
  prometheusUrl: process.env.PROMETHEUS_URL ?? 'http://localhost:30090',
  anomalyThreshold: 2.0,        // 2 standard deviations
  baselineWindowMs: 300000,     // 5 minutes
  criticalMetrics: [
    'container_cpu_usage_seconds_total',
    'container_memory_usage_bytes',
    'http_requests_total',
    'http_request_duration_seconds',
    'kube_pod_container_status_restarts_total',
    'kube_deployment_status_replicas_unavailable',
  ],
  stepMs: 15000,                // 15 second step
};

// Prometheus line regex
// Format: metric_name{label="value",label2="value2"} value timestamp?
const PROM_LINE_REGEX = /^(\w+)(\{[^}]+\})?\s+([\d.eE+-]+)(?:\s+(\d+))?$/;

// Label parser regex
const LABEL_REGEX = /(\w+)="([^"]+)"/g;

export class MetricProcessor {
  private config: MetricProcessorConfig;
  private logger = createChildLogger({ component: 'MetricProcessor' });

  constructor(config: Partial<MetricProcessorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Ingest metrics from Prometheus text exposition format
   */
  ingestPrometheusFormat(data: string): Metric[] {
    const lines = data.split('\n');
    const metrics: Metric[] = [];

    for (const line of lines) {
      // Skip comments and empty lines
      if (line.startsWith('#') || !line.trim()) {
        continue;
      }

      const parsed = this.parsePrometheusLine(line);
      if (parsed) {
        metrics.push(parsed);
      }
    }

    this.logger.debug({
      lineCount: lines.length,
      metricsFound: metrics.length,
    }, 'Parsed Prometheus format');

    return metrics;
  }

  /**
   * Parse a single Prometheus line
   */
  private parsePrometheusLine(line: string): Metric | null {
    const match = line.match(PROM_LINE_REGEX);
    if (!match) {
      return null;
    }

    const [, name, labelsStr, valueStr, timestampStr] = match;

    if (!name || !valueStr) {
      return null;
    }

    // Parse labels
    const labels: Record<string, string> = {};
    if (labelsStr) {
      let labelMatch;
      while ((labelMatch = LABEL_REGEX.exec(labelsStr)) !== null) {
        const [, key, value] = labelMatch;
        if (key && value) {
          labels[key] = value;
        }
      }
    }

    // Parse value
    const value = parseFloat(valueStr);
    if (isNaN(value)) {
      return null;
    }

    // Parse timestamp (milliseconds) or use current time
    let timestamp: Date;
    if (timestampStr) {
      timestamp = new Date(parseInt(timestampStr, 10));
    } else {
      timestamp = new Date();
    }

    return { name, timestamp, value, labels };
  }

  /**
   * Query Prometheus API for metrics
   */
  async queryPrometheus(
    query: string,
    start: Date,
    end: Date
  ): Promise<Metric[]> {
    if (!this.config.prometheusUrl) {
      this.logger.warn('Prometheus URL not configured');
      return [];
    }

    const params = new URLSearchParams({
      query,
      start: (start.getTime() / 1000).toString(),
      end: (end.getTime() / 1000).toString(),
      step: (this.config.stepMs / 1000).toString(),
    });

    const url = `${this.config.prometheusUrl}/api/v1/query_range?${params}`;

    this.logger.debug({ query, start: start.toISOString(), end: end.toISOString() }, 'Querying Prometheus');

    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`Prometheus API error: ${response.status}`);
      }

      const data = await response.json() as {
        status: string;
        data: {
          resultType: string;
          result: Array<{
            metric: Record<string, string>;
            values: Array<[number, string]>;
          }>;
        };
      };

      if (data.status !== 'success') {
        throw new Error('Prometheus query failed');
      }

      // Convert to Metric format
      const metrics: Metric[] = [];

      for (const result of data.data.result) {
        const metricName = result.metric.__name__ ?? query;
        const labels = { ...result.metric };
        delete labels.__name__;

        for (const [timestamp, value] of result.values) {
          metrics.push({
            name: metricName,
            timestamp: new Date(timestamp * 1000),
            value: parseFloat(value),
            labels,
          });
        }
      }

      this.logger.info({
        query,
        resultCount: metrics.length,
      }, 'Prometheus query complete');

      return metrics;
    } catch (error) {
      this.logger.error({
        error: (error as Error).message,
        query,
      }, 'Prometheus query failed');
      return [];
    }
  }

  /**
   * Detect anomalies based on statistical deviation
   */
  detectAnomalies(
    metrics: Metric[],
    baselineMetrics?: Metric[]
  ): MetricAnomaly[] {
    const anomalies: MetricAnomaly[] = [];

    // Group metrics by name and labels
    const metricGroups = this.groupMetrics(metrics);
    const baselineGroups = baselineMetrics
      ? this.groupMetrics(baselineMetrics)
      : metricGroups;

    for (const [key, values] of metricGroups) {
      const baseline = baselineGroups.get(key) ?? values;

      // Calculate baseline statistics
      const stats = this.calculateStats(baseline.map((m) => m.value));

      // Check each value against baseline
      for (const metric of values) {
        const zScore = stats.stdDev > 0
          ? (metric.value - stats.mean) / stats.stdDev
          : 0;

        if (Math.abs(zScore) > this.config.anomalyThreshold) {
          const severity = this.scoreAnomalySeverity(
            Math.abs(zScore),
            metric.name
          );

          anomalies.push({
            metric: metric.name,
            timestamp: metric.timestamp,
            value: metric.value,
            expectedRange: [
              stats.mean - stats.stdDev * this.config.anomalyThreshold,
              stats.mean + stats.stdDev * this.config.anomalyThreshold,
            ],
            deviation: zScore,
            severity,
            labels: metric.labels,
          });
        }
      }
    }

    // Sort by deviation (most anomalous first)
    anomalies.sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation));

    this.logger.info({
      anomalyCount: anomalies.length,
      criticalCount: anomalies.filter((a) => a.severity === 'critical').length,
    }, 'Anomaly detection complete');

    return anomalies;
  }

  /**
   * Score anomaly severity based on deviation and metric criticality
   */
  private scoreAnomalySeverity(
    absDeviation: number,
    metricName: string
  ): 'low' | 'medium' | 'high' | 'critical' {
    const isCriticalMetric = this.config.criticalMetrics.some((m) =>
      metricName.includes(m)
    );

    // Adjust thresholds based on metric criticality
    const multiplier = isCriticalMetric ? 0.7 : 1.0;

    if (absDeviation > 4 * multiplier) {
      return 'critical';
    }
    if (absDeviation > 3 * multiplier) {
      return 'high';
    }
    if (absDeviation > 2 * multiplier) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Correlate metrics with a target timestamp
   */
  correlateWithTimestamp(
    metrics: Metric[],
    targetTime: Date,
    windowMs?: number
  ): Metric[] {
    const window = windowMs ?? this.config.baselineWindowMs;
    const targetMs = targetTime.getTime();
    const windowStart = targetMs - window / 2;
    const windowEnd = targetMs + window / 2;

    return metrics.filter((m) => {
      const metricMs = m.timestamp.getTime();
      return metricMs >= windowStart && metricMs <= windowEnd;
    });
  }

  /**
   * Calculate metric summaries for a time period
   */
  summarize(metrics: Metric[]): MetricSummary[] {
    const groups = this.groupMetrics(metrics);
    const summaries: MetricSummary[] = [];

    for (const [, values] of groups) {
      if (values.length === 0) continue;

      const firstMetric = values[0]!;
      const numericValues = values.map((m) => m.value);
      const stats = this.calculateStats(numericValues);

      // Determine trend
      const trend = this.calculateTrend(numericValues);

      // Calculate anomaly score (0-1)
      const anomalyScore = this.calculateAnomalyScore(numericValues, stats);

      summaries.push({
        name: firstMetric.name,
        labels: firstMetric.labels,
        min: stats.min,
        max: stats.max,
        avg: stats.mean,
        current: numericValues[numericValues.length - 1]!,
        trend,
        anomalyScore,
        dataPoints: values.length,
      });
    }

    return summaries;
  }

  /**
   * Get key Kubernetes metrics for a namespace/deployment
   */
  async getK8sMetrics(
    namespace: string,
    deployment: string,
    durationMs?: number
  ): Promise<K8sMetrics | null> {
    if (!this.config.prometheusUrl) {
      this.logger.warn('Prometheus URL not configured, returning null');
      return null;
    }

    const duration = durationMs ?? this.config.baselineWindowMs;
    const end = new Date();
    const start = new Date(end.getTime() - duration);

    const queries = {
      cpu: `rate(container_cpu_usage_seconds_total{namespace="${namespace}", pod=~"${deployment}.*"}[5m])`,
      memory: `container_memory_usage_bytes{namespace="${namespace}", pod=~"${deployment}.*"}`,
      requestRate: `rate(http_requests_total{namespace="${namespace}", deployment="${deployment}"}[5m])`,
      errorRate: `rate(http_requests_total{namespace="${namespace}", deployment="${deployment}", status_code=~"5.."}[5m])`,
      latencyP99: `histogram_quantile(0.99, rate(http_request_duration_seconds_bucket{namespace="${namespace}", deployment="${deployment}"}[5m]))`,
    };

    try {
      const [cpuMetrics, memoryMetrics, requestRateMetrics, errorRateMetrics, latencyMetrics] =
        await Promise.all([
          this.queryPrometheus(queries.cpu, start, end),
          this.queryPrometheus(queries.memory, start, end),
          this.queryPrometheus(queries.requestRate, start, end),
          this.queryPrometheus(queries.errorRate, start, end),
          this.queryPrometheus(queries.latencyP99, start, end),
        ]);

      // Create summaries for each metric type
      const createSummary = (metrics: Metric[], name: string): MetricSummary => {
        if (metrics.length === 0) {
          return {
            name,
            labels: { namespace, deployment },
            min: 0,
            max: 0,
            avg: 0,
            current: 0,
            trend: 'stable',
            anomalyScore: 0,
            dataPoints: 0,
          };
        }
        const summaries = this.summarize(metrics);
        return summaries[0] ?? {
          name,
          labels: { namespace, deployment },
          min: 0,
          max: 0,
          avg: 0,
          current: 0,
          trend: 'stable',
          anomalyScore: 0,
          dataPoints: 0,
        };
      };

      return {
        cpu: createSummary(cpuMetrics, 'cpu_usage'),
        memory: createSummary(memoryMetrics, 'memory_usage'),
        requestRate: createSummary(requestRateMetrics, 'request_rate'),
        errorRate: createSummary(errorRateMetrics, 'error_rate'),
        latencyP99: createSummary(latencyMetrics, 'latency_p99'),
      };
    } catch (error) {
      this.logger.error({
        error: (error as Error).message,
        namespace,
        deployment,
      }, 'Failed to fetch K8s metrics');
      return null;
    }
  }

  /**
   * Compare current metrics to a baseline period
   */
  compareToBaseline(
    current: Metric[],
    baseline: Metric[]
  ): MetricComparison[] {
    const currentSummaries = this.summarize(current);
    const baselineSummaries = this.summarize(baseline);

    const comparisons: MetricComparison[] = [];

    for (const currentSummary of currentSummaries) {
      // Find matching baseline
      const baselineSummary = baselineSummaries.find(
        (b) =>
          b.name === currentSummary.name &&
          JSON.stringify(b.labels) === JSON.stringify(currentSummary.labels)
      );

      if (!baselineSummary) {
        continue;
      }

      const changePercent = baselineSummary.avg !== 0
        ? ((currentSummary.avg - baselineSummary.avg) / baselineSummary.avg) * 100
        : 0;

      // Consider significant if change > 20%
      const significant = Math.abs(changePercent) > 20;

      comparisons.push({
        metric: currentSummary.name,
        currentValue: currentSummary.avg,
        baselineValue: baselineSummary.avg,
        changePercent,
        significant,
        direction: changePercent > 5 ? 'up' : changePercent < -5 ? 'down' : 'stable',
      });
    }

    // Sort by absolute change
    comparisons.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));

    return comparisons;
  }

  /**
   * Run full metric analysis
   */
  analyze(metrics: Metric[], baselineMetrics?: Metric[]): MetricProcessorResult {
    const summaries = this.summarize(metrics);
    const anomalies = this.detectAnomalies(metrics, baselineMetrics);
    const comparisons = baselineMetrics
      ? this.compareToBaseline(metrics, baselineMetrics)
      : [];

    return {
      metrics,
      summaries,
      anomalies,
      comparisons,
    };
  }

  /**
   * Group metrics by name and labels
   */
  private groupMetrics(metrics: Metric[]): Map<string, Metric[]> {
    const groups = new Map<string, Metric[]>();

    for (const metric of metrics) {
      const key = `${metric.name}:${JSON.stringify(metric.labels)}`;
      const existing = groups.get(key) ?? [];
      existing.push(metric);
      groups.set(key, existing);
    }

    return groups;
  }

  /**
   * Calculate basic statistics
   */
  private calculateStats(values: number[]): {
    mean: number;
    stdDev: number;
    min: number;
    max: number;
  } {
    if (values.length === 0) {
      return { mean: 0, stdDev: 0, min: 0, max: 0 };
    }

    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / values.length;

    const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    const stdDev = Math.sqrt(avgSquaredDiff);

    return {
      mean,
      stdDev,
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }

  /**
   * Calculate trend direction
   */
  private calculateTrend(
    values: number[]
  ): 'increasing' | 'decreasing' | 'stable' | 'volatile' {
    if (values.length < 3) {
      return 'stable';
    }

    // Simple linear regression
    const n = values.length;
    const xSum = (n * (n - 1)) / 2; // Sum of 0 to n-1
    const xSquaredSum = (n * (n - 1) * (2 * n - 1)) / 6;
    const ySum = values.reduce((a, b) => a + b, 0);
    const xySum = values.reduce((sum, v, i) => sum + i * v, 0);

    const slope = (n * xySum - xSum * ySum) / (n * xSquaredSum - xSum * xSum);

    // Calculate coefficient of variation for volatility
    const stats = this.calculateStats(values);
    const cv = stats.mean !== 0 ? stats.stdDev / stats.mean : 0;

    // If highly volatile, report as volatile
    if (cv > 0.5) {
      return 'volatile';
    }

    // Determine trend based on slope relative to mean
    const normalizedSlope = stats.mean !== 0 ? slope / stats.mean : 0;

    if (normalizedSlope > 0.05) {
      return 'increasing';
    }
    if (normalizedSlope < -0.05) {
      return 'decreasing';
    }
    return 'stable';
  }

  /**
   * Calculate anomaly score (0-1)
   */
  private calculateAnomalyScore(
    values: number[],
    stats: { mean: number; stdDev: number }
  ): number {
    if (values.length === 0 || stats.stdDev === 0) {
      return 0;
    }

    // Use max deviation as anomaly score
    let maxDeviation = 0;
    for (const value of values) {
      const zScore = Math.abs((value - stats.mean) / stats.stdDev);
      maxDeviation = Math.max(maxDeviation, zScore);
    }

    // Normalize to 0-1 (cap at 5 standard deviations)
    return Math.min(maxDeviation / 5, 1);
  }
}

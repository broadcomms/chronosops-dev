/**
 * Prometheus Client
 * Query Prometheus metrics for anomaly detection
 */

import { createChildLogger } from '@chronosops/shared';

const logger = createChildLogger({ component: 'PrometheusClient' });

export interface PrometheusClientConfig {
  url: string;
  timeout: number;
}

/**
 * Auto-detect Prometheus URL based on environment
 * - In-cluster (GKE): Use internal K8s DNS
 * - Local: Use localhost with NodePort
 */
function getDefaultPrometheusUrl(): string {
  // Explicit env var takes precedence
  if (process.env.PROMETHEUS_URL) {
    return process.env.PROMETHEUS_URL;
  }

  // Detect if running inside Kubernetes cluster
  // KUBERNETES_SERVICE_HOST is automatically set by K8s
  const isInCluster = !!process.env.KUBERNETES_SERVICE_HOST;

  if (isInCluster) {
    // Use internal K8s DNS for in-cluster access
    return process.env.PROMETHEUS_IN_CLUSTER_URL ?? 'http://prometheus.monitoring.svc.cluster.local:9090';
  }

  // Local development - use NodePort
  return 'http://localhost:30090';
}

const DEFAULT_CONFIG: PrometheusClientConfig = {
  url: getDefaultPrometheusUrl(),
  timeout: 10000,
};

export interface PrometheusQueryResult {
  success: boolean;
  value?: number;
  labels?: Record<string, string>;
  error?: string;
}

export interface PrometheusRangeResult {
  success: boolean;
  values?: Array<{ timestamp: number; value: number }>;
  labels?: Record<string, string>;
  error?: string;
}

export interface PrometheusMetricAnomaly {
  app: string;
  deployment: string;  // K8s deployment name (for API calls)
  namespace: string;
  type: 'high_error_rate' | 'high_latency' | 'pod_restart' | 'memory_pressure' | 'cpu_pressure';
  value: number;
  threshold: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}

export interface MetricCheckResult {
  success: boolean;
  anomalies: PrometheusMetricAnomaly[];
  checkedApps: number;
  error?: string;
}

/**
 * Prometheus Client for metrics-based anomaly detection
 */
export class PrometheusClient {
  private config: PrometheusClientConfig;
  private lastConnectionErrorLog: number = 0;
  private static CONNECTION_ERROR_LOG_INTERVAL = 30000; // Only log connection errors every 30 seconds

  constructor(config: Partial<PrometheusClientConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Log connection error with rate limiting to avoid spam
   */
  private logConnectionError(error: string, context: Record<string, unknown>): void {
    const now = Date.now();
    if (now - this.lastConnectionErrorLog > PrometheusClient.CONNECTION_ERROR_LOG_INTERVAL) {
      logger.warn({ error, ...context }, 'Prometheus connection failed (suppressing further errors for 30s)');
      this.lastConnectionErrorLog = now;
    }
  }

  /**
   * Check if Prometheus is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.url}/-/healthy`, {
        signal: AbortSignal.timeout(this.config.timeout),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Execute an instant query
   */
  async query(promql: string): Promise<PrometheusQueryResult> {
    try {
      const url = `${this.config.url}/api/v1/query?query=${encodeURIComponent(promql)}`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }

      const result = (await response.json()) as {
        status: string;
        data: {
          resultType: string;
          result: Array<{
            metric: Record<string, string>;
            value: [number, string];
          }>;
        };
      };

      if (result.status !== 'success' || !result.data.result[0]) {
        return { success: true, value: 0 }; // No data = 0
      }

      const firstResult = result.data.result[0];
      return {
        success: true,
        value: parseFloat(firstResult.value[1]),
        labels: firstResult.metric,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      // Rate-limit connection error logging to avoid spam
      if (errorMessage.includes('fetch failed') || errorMessage.includes('ECONNREFUSED')) {
        this.logConnectionError(errorMessage, { promql });
      } else {
        logger.error({ error: errorMessage, promql }, 'Prometheus query failed');
      }
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Execute a range query
   */
  async queryRange(
    promql: string,
    start: Date,
    end: Date,
    step: string = '15s'
  ): Promise<PrometheusRangeResult> {
    try {
      const url = new URL(`${this.config.url}/api/v1/query_range`);
      url.searchParams.set('query', promql);
      url.searchParams.set('start', (start.getTime() / 1000).toString());
      url.searchParams.set('end', (end.getTime() / 1000).toString());
      url.searchParams.set('step', step);

      const response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }

      const result = (await response.json()) as {
        status: string;
        data: {
          resultType: string;
          result: Array<{
            metric: Record<string, string>;
            values: Array<[number, string]>;
          }>;
        };
      };

      if (result.status !== 'success' || !result.data.result[0]) {
        return { success: true, values: [] };
      }

      const firstResult = result.data.result[0];
      return {
        success: true,
        values: firstResult.values.map(([ts, val]) => ({
          timestamp: ts,
          value: parseFloat(val),
        })),
        labels: firstResult.metric,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      // Rate-limit connection error logging to avoid spam
      if (errorMessage.includes('fetch failed') || errorMessage.includes('ECONNREFUSED')) {
        this.logConnectionError(errorMessage, { promql });
      } else {
        logger.error({ error: errorMessage, promql }, 'Prometheus range query failed');
      }
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Check metrics for all monitored apps
   */
  async checkMetrics(
    apps: Array<{ namespace: string; deployment: string; displayName: string }>
  ): Promise<MetricCheckResult> {
    const anomalies: PrometheusMetricAnomaly[] = [];
    let checkedApps = 0;

    for (const app of apps) {
      try {
        // Check error rate
        const errorRateResult = await this.checkErrorRate(app.namespace, app.deployment);
        if (errorRateResult) {
          anomalies.push({
            ...errorRateResult,
            app: app.displayName,
            deployment: app.deployment,  // K8s deployment name for API calls
            namespace: app.namespace,
          });
        }

        // Check latency
        const latencyResult = await this.checkLatency(app.namespace, app.deployment);
        if (latencyResult) {
          anomalies.push({
            ...latencyResult,
            app: app.displayName,
            deployment: app.deployment,  // K8s deployment name for API calls
            namespace: app.namespace,
          });
        }

        // Check pod restarts
        const restartResult = await this.checkPodRestarts(app.namespace, app.deployment);
        if (restartResult) {
          anomalies.push({
            ...restartResult,
            app: app.displayName,
            deployment: app.deployment,  // K8s deployment name for API calls
            namespace: app.namespace,
          });
        }

        // Check memory pressure
        const memoryResult = await this.checkMemoryPressure(app.namespace, app.deployment);
        if (memoryResult) {
          anomalies.push({
            ...memoryResult,
            app: app.displayName,
            deployment: app.deployment,  // K8s deployment name for API calls
            namespace: app.namespace,
          });
        }

        checkedApps++;
      } catch (error) {
        logger.warn(
          { app: app.displayName, error: error instanceof Error ? error.message : 'Unknown' },
          'Failed to check metrics for app'
        );
      }
    }

    return {
      success: true,
      anomalies,
      checkedApps,
    };
  }

  /**
   * Check error rate for an app (threshold: 5%)
   */
  private async checkErrorRate(
    namespace: string,
    deployment: string
  ): Promise<Omit<PrometheusMetricAnomaly, 'app' | 'deployment' | 'namespace'> | null> {
    const threshold = 0.05; // 5% error rate

    // Query: Error rate = 5xx responses / total responses
    // Using 1m window for faster recovery display after fixes
    // Use source_namespace and pod regex to match VisionService queries (app metrics use relabeled labels)
    const query = `
      sum(rate(http_requests_total{source_namespace="${namespace}", pod=~"${deployment}.*", status=~"5.."}[1m]))
      /
      sum(rate(http_requests_total{source_namespace="${namespace}", pod=~"${deployment}.*"}[1m]))
    `.replace(/\s+/g, ' ').trim();

    const result = await this.query(query);
    if (!result.success || result.value === undefined) {
      return null;
    }

    if (isNaN(result.value) || result.value <= threshold) {
      return null;
    }

    const severity = this.getSeverityFromErrorRate(result.value);
    return {
      type: 'high_error_rate',
      value: result.value,
      threshold,
      severity,
      description: `Error rate ${(result.value * 100).toFixed(1)}% exceeds ${(threshold * 100).toFixed(0)}% threshold`,
    };
  }

  /**
   * Check P99 latency (threshold: 2s)
   */
  private async checkLatency(
    namespace: string,
    deployment: string
  ): Promise<Omit<PrometheusMetricAnomaly, 'app' | 'deployment' | 'namespace'> | null> {
    const threshold = 2; // 2 seconds

    // Using 1m window for faster recovery display after fixes
    // Use source_namespace and pod regex to match VisionService queries (app metrics use relabeled labels)
    const query = `
      histogram_quantile(0.99,
        sum(rate(http_request_duration_seconds_bucket{source_namespace="${namespace}", pod=~"${deployment}.*"}[1m]))
        by (le)
      )
    `.replace(/\s+/g, ' ').trim();

    const result = await this.query(query);
    if (!result.success || result.value === undefined) {
      return null;
    }

    if (isNaN(result.value) || result.value <= threshold) {
      return null;
    }

    const severity = this.getSeverityFromLatency(result.value);
    return {
      type: 'high_latency',
      value: result.value,
      threshold,
      severity,
      description: `P99 latency ${result.value.toFixed(2)}s exceeds ${threshold}s threshold`,
    };
  }

  /**
   * Check pod restart count (threshold: 3 restarts in 15m)
   */
  private async checkPodRestarts(
    namespace: string,
    deployment: string
  ): Promise<Omit<PrometheusMetricAnomaly, 'app' | 'deployment' | 'namespace'> | null> {
    const threshold = 3;

    const query = `
      sum(increase(kube_pod_container_status_restarts_total{namespace="${namespace}", pod=~"${deployment}.*"}[15m]))
    `.replace(/\s+/g, ' ').trim();

    const result = await this.query(query);
    if (!result.success || result.value === undefined) {
      return null;
    }

    if (isNaN(result.value) || result.value < threshold) {
      return null;
    }

    return {
      type: 'pod_restart',
      value: result.value,
      threshold,
      severity: result.value >= 5 ? 'critical' : 'high',
      description: `${Math.floor(result.value)} pod restarts in last 15m exceeds ${threshold} threshold`,
    };
  }

  /**
   * Check memory pressure (threshold: 90% usage)
   */
  private async checkMemoryPressure(
    namespace: string,
    deployment: string
  ): Promise<Omit<PrometheusMetricAnomaly, 'app' | 'deployment' | 'namespace'> | null> {
    const threshold = 0.9; // 90%

    const query = `
      sum(container_memory_usage_bytes{namespace="${namespace}", pod=~"${deployment}.*"})
      /
      sum(container_spec_memory_limit_bytes{namespace="${namespace}", pod=~"${deployment}.*"})
    `.replace(/\s+/g, ' ').trim();

    const result = await this.query(query);
    if (!result.success || result.value === undefined) {
      return null;
    }

    if (isNaN(result.value) || result.value <= threshold) {
      return null;
    }

    return {
      type: 'memory_pressure',
      value: result.value,
      threshold,
      severity: result.value >= 0.95 ? 'critical' : 'high',
      description: `Memory usage ${(result.value * 100).toFixed(1)}% exceeds ${(threshold * 100).toFixed(0)}% threshold`,
    };
  }

  /**
   * Get severity based on error rate
   */
  private getSeverityFromErrorRate(rate: number): 'low' | 'medium' | 'high' | 'critical' {
    if (rate >= 0.5) return 'critical'; // 50%+
    if (rate >= 0.2) return 'high';     // 20%+
    if (rate >= 0.1) return 'medium';   // 10%+
    return 'low';
  }

  /**
   * Get severity based on latency
   */
  private getSeverityFromLatency(seconds: number): 'low' | 'medium' | 'high' | 'critical' {
    if (seconds >= 10) return 'critical';
    if (seconds >= 5) return 'high';
    if (seconds >= 3) return 'medium';
    return 'low';
  }
}

// Singleton instance
export const prometheusClient = new PrometheusClient();

/**
 * Create Prometheus client from environment
 */
export function createPrometheusClientFromEnv(): PrometheusClient {
  return new PrometheusClient({
    url: getDefaultPrometheusUrl(),
    timeout: parseInt(process.env.PROMETHEUS_TIMEOUT ?? '10000', 10),
  });
}

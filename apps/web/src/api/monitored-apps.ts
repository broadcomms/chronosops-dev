/**
 * Monitored Apps API endpoints
 */
import { apiClient } from './client';

export interface MonitoredApp {
  id: string;
  namespace: string;
  deployment: string;
  displayName: string;
  grafanaDashboardUid: string | null;
  grafanaDashboardUrl: string | null;
  isActive: boolean;
  autoMonitored?: boolean;
  developmentCycleId?: string;
  createdAt: string;
  updatedAt: string;
}

export type MetricStatus = 'healthy' | 'warning' | 'critical';

export interface MetricValue {
  value: number;
  unit: string;
  status: MetricStatus;
}

export interface ResourceMetric extends MetricValue {
  limit: number;
}

export interface PodMetric {
  ready: number;
  desired: number;
}

export interface AppMetrics {
  errorRate: MetricValue;
  requestRate: MetricValue;
  latency: MetricValue;
  cpu: ResourceMetric;
  memory: ResourceMetric;
  pods: PodMetric;
  prometheusAvailable: boolean;
  timestamp: string;
}

export interface AppMetricsResponse {
  success: boolean;
  data: AppMetrics;
  error?: string;
}

export interface CreateMonitoredAppInput {
  namespace: string;
  deployment: string;
  displayName: string;
  isActive?: boolean;
}

export interface UpdateMonitoredAppInput {
  displayName?: string;
  isActive?: boolean;
}

export interface MonitoredAppResponse {
  success: boolean;
  data: MonitoredApp;
  error?: string;
}

export interface MonitoredAppListResponse {
  success: boolean;
  data: MonitoredApp[];
  error?: string;
}

/**
 * Monitored Apps API
 */
export const monitoredAppsApi = {
  /**
   * Get all monitored apps
   */
  getAll: () => apiClient<MonitoredAppListResponse>('/api/v1/config/monitored-apps'),

  /**
   * Get active monitored apps only
   */
  getActive: () => apiClient<MonitoredAppListResponse>('/api/v1/config/monitored-apps/active'),

  /**
   * Get a monitored app by ID
   */
  getById: (id: string) =>
    apiClient<MonitoredAppResponse>(`/api/v1/config/monitored-apps/${id}`),

  /**
   * Create a monitored app
   */
  create: (input: CreateMonitoredAppInput) =>
    apiClient<MonitoredAppResponse>('/api/v1/config/monitored-apps', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /**
   * Update a monitored app
   */
  update: (id: string, input: UpdateMonitoredAppInput) =>
    apiClient<MonitoredAppResponse>(`/api/v1/config/monitored-apps/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  /**
   * Delete a monitored app
   */
  delete: (id: string) =>
    apiClient<{ success: boolean }>(`/api/v1/config/monitored-apps/${id}`, {
      method: 'DELETE',
    }),

  /**
   * Get real-time metrics for a monitored app
   */
  getMetrics: (id: string) =>
    apiClient<AppMetricsResponse>(`/api/v1/config/monitored-apps/${id}/metrics`),

  /**
   * Generate Grafana dashboard for an app
   */
  generateDashboard: (id: string) =>
    apiClient<MonitoredAppResponse>(`/api/v1/config/monitored-apps/${id}/generate-dashboard`, {
      method: 'POST',
    }),
};

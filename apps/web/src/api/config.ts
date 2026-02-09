/**
 * Configuration API endpoints
 */
import { apiClient } from './client';
import type {
  KubernetesConfig,
  DashboardConfig,
  ActionSafetyConfig,
  DevelopmentSettingsConfig,
  ConfigurationState,
  ConfigApiResponse,
  TestConnectionResponse,
} from '@chronosops/shared';

/**
 * Configuration API
 */
export const configApi = {
  /**
   * Get all configuration
   */
  getAll: () => apiClient<ConfigApiResponse<ConfigurationState>>('/api/v1/config'),

  /**
   * Get Kubernetes configuration
   */
  getKubernetes: () =>
    apiClient<ConfigApiResponse<KubernetesConfig | null> & { isValid?: boolean; lastTestedAt?: string }>(
      '/api/v1/config/kubernetes'
    ),

  /**
   * Update Kubernetes configuration
   */
  updateKubernetes: (config: KubernetesConfig) =>
    apiClient<ConfigApiResponse<KubernetesConfig>>('/api/v1/config/kubernetes', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),

  /**
   * Test Kubernetes connection
   */
  testKubernetes: (context?: string) =>
    apiClient<TestConnectionResponse>('/api/v1/config/kubernetes/test', {
      method: 'POST',
      body: JSON.stringify({ context }),
    }),

  /**
   * Get Dashboard configuration
   */
  getDashboard: () =>
    apiClient<ConfigApiResponse<DashboardConfig | null> & { isValid?: boolean; lastTestedAt?: string }>(
      '/api/v1/config/dashboard'
    ),

  /**
   * Update Dashboard configuration
   */
  updateDashboard: (config: DashboardConfig) =>
    apiClient<ConfigApiResponse<DashboardConfig>>('/api/v1/config/dashboard', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),

  /**
   * Test Dashboard/Screen Capture connection
   */
  testDashboard: (url?: string) =>
    apiClient<TestConnectionResponse>('/api/v1/config/dashboard/test', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  /**
   * Get Action Safety configuration
   */
  getSafety: () => apiClient<ConfigApiResponse<ActionSafetyConfig>>('/api/v1/config/safety'),

  /**
   * Update Action Safety configuration
   */
  updateSafety: (config: ActionSafetyConfig) =>
    apiClient<ConfigApiResponse<ActionSafetyConfig>>('/api/v1/config/safety', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),

  /**
   * Get Development Settings configuration
   */
  getDevelopment: () => apiClient<ConfigApiResponse<DevelopmentSettingsConfig>>('/api/v1/config/development'),

  /**
   * Update Development Settings configuration
   */
  updateDevelopment: (config: DevelopmentSettingsConfig) =>
    apiClient<ConfigApiResponse<DevelopmentSettingsConfig>>('/api/v1/config/development', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),
};

/**
 * Development API endpoints
 */
import { apiClient, buildQueryString } from './client';
import type {
  DevelopmentCycle,
  DevelopmentCycleStatus,
  CreateDevelopmentCycleRequest,
  GeneratedFile,
  ApiResponse,
} from '../types';

// Query parameters for listing cycles
export interface DevelopmentCycleListParams {
  status?: DevelopmentCycleStatus;
  limit?: number;
  offset?: number;
}

/**
 * Development Cycles API
 */
export const developmentApi = {
  /**
   * List development cycles with optional filtering
   */
  list: (params?: DevelopmentCycleListParams) =>
    apiClient<ApiResponse<DevelopmentCycle[]>>(
      `/api/v1/development${buildQueryString(params as Record<string, string | number | boolean | undefined>)}`
    ),

  /**
   * Get a single development cycle by ID
   */
  get: (id: string) =>
    apiClient<ApiResponse<DevelopmentCycle>>(`/api/v1/development/${id}`),

  /**
   * Create a new development cycle
   */
  create: (data: CreateDevelopmentCycleRequest) =>
    apiClient<ApiResponse<DevelopmentCycle>>('/api/v1/development', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /**
   * Start a development cycle
   */
  start: (id: string) =>
    apiClient<{ message: string; data: { id: string; phase: string; startedAt: string } }>(`/api/v1/development/${id}/start`, {
      method: 'POST',
    }),

  /**
   * Rebuild a completed development cycle (after applying evolutions)
   * Only runs BUILD → DEPLOY → VERIFY, skipping analysis/architecture/coding
   */
  rebuild: (id: string) =>
    apiClient<{ message: string; data: { id: string; phase: string; startedAt: string; isRebuild: boolean } }>(
      `/api/v1/development/${id}/rebuild`,
      { method: 'POST' }
    ),

  /**
   * Get development cycle status
   */
  getStatus: (id: string) =>
    apiClient<ApiResponse<{ phase: string; progress: number; iteration: number }>>(`/api/v1/development/${id}/status`),

  /**
   * Get generated files for a cycle
   */
  getFiles: (id: string) =>
    apiClient<ApiResponse<GeneratedFile[]>>(`/api/v1/development/${id}/files`),

  /**
   * Cancel a running development cycle
   */
  cancel: (id: string) =>
    apiClient<{ message: string }>(`/api/v1/development/${id}/cancel`, {
      method: 'POST',
    }),

  /**
   * Retry the current phase of a development cycle
   * Cancels current operation and restarts from the current phase
   */
  retryPhase: (id: string) =>
    apiClient<{ message: string; phase: string; cycleId: string }>(`/api/v1/development/${id}/retry-phase`, {
      method: 'POST',
    }),

  /**
   * Delete a development cycle and all associated resources
   * (K8s deployment, service, Docker image, DB records)
   */
  delete: (id: string) =>
    apiClient<{
      message: string;
      cleanup: {
        k8sService?: { success: boolean; error?: string };
        k8sDeployment?: { success: boolean; error?: string };
        dockerImage?: { success: boolean; error?: string };
      };
    }>(`/api/v1/development/${id}`, {
      method: 'DELETE',
    }),
};

/**
 * Services API endpoints - Service Registry access
 */
import { apiClient } from './client';
import type { ServiceSummary, ApiResponse } from '../types';

/**
 * Services API
 */
export const servicesApi = {
  /**
   * List available backend services (for frontend service picker)
   */
  listBackends: () =>
    apiClient<ApiResponse<ServiceSummary[]>>('/api/v1/services/backends'),

  /**
   * List all services
   */
  list: (params?: { serviceType?: string; status?: string }) => {
    const query = new URLSearchParams();
    if (params?.serviceType) query.append('serviceType', params.serviceType);
    if (params?.status) query.append('status', params.status);
    const queryStr = query.toString() ? `?${query.toString()}` : '';
    return apiClient<ApiResponse<ServiceSummary[]>>(`/api/v1/services${queryStr}`);
  },

  /**
   * Get service by ID
   */
  get: (id: string) =>
    apiClient<ApiResponse<ServiceSummary>>(`/api/v1/services/${id}`),

  /**
   * Get endpoints for a service
   */
  getEndpoints: (id: string) =>
    apiClient<ApiResponse<Array<{
      method: string;
      path: string;
      description: string;
    }>>>(`/api/v1/services/${id}/endpoints`),
};

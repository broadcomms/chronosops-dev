/**
 * Health and status API endpoints
 */
import { apiClient } from './client';
import { config } from '../config/env';
import type { ConnectionStatus } from '../types';

interface HealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
}

interface ServiceStatus {
  status: 'ok' | 'degraded' | 'error';
  services: {
    gemini: { available: boolean };
    videoWatcher: { available: boolean; config: Record<string, unknown> };
    executor: {
      mode: string;
      available: boolean;
      kubernetes?: boolean;
      simulated?: boolean;
      currentMode?: 'auto' | 'kubernetes' | 'simulated';
      activeExecutor?: 'KubernetesExecutor' | 'SimulatedExecutor';
    };
  };
  timestamp: string;
}

interface DetailedHealth {
  api: boolean;
  websocket: boolean;
  vision: boolean;
  kubernetes: boolean;
  metrics?: {
    cpu: number;
    memory: number;
    podsRunning: number;
    podsTotal: number;
  };
}

/**
 * Health API
 */
export const healthApi = {
  /**
   * Check basic API health
   */
  check: () => apiClient<HealthResponse>('/api/v1/health'),

  /**
   * Get detailed service status
   */
  getServiceStatus: () => apiClient<ServiceStatus>('/api/v1/services/status'),

  /**
   * Get detailed health for all services
   */
  getDetailedHealth: () => apiClient<DetailedHealth>('/api/v1/health/detailed'),

  /**
   * Check vision service health
   */
  checkVision: async (): Promise<boolean> => {
    try {
      const response = await fetch(`${config.apiUrl}/api/v1/vision/health`, {
        method: 'GET',
        mode: 'cors',
      });
      return response.ok;
    } catch {
      return false;
    }
  },
};

/**
 * Check all connection statuses
 */
export async function checkAllConnections(): Promise<ConnectionStatus> {
  const status: ConnectionStatus = {
    api: 'disconnected',
    websocket: 'disconnected',
    vision: 'disconnected',
    kubernetes: 'disconnected',
  };

  // Check API
  try {
    const health = await healthApi.check();
    status.api = health.status === 'ok' ? 'connected' : 'error';
  } catch {
    status.api = 'disconnected';
  }

  // Check vision service
  const visionOk = await healthApi.checkVision();
  status.vision = visionOk ? 'connected' : 'disconnected';

  // Check services (includes K8s status)
  try {
    const services = await healthApi.getServiceStatus();
    // The /api/v1/services/status endpoint returns {kubernetes: 'configured'|'disconnected'|...}
    const k8sStatus = (services as unknown as { kubernetes?: string }).kubernetes;
    status.kubernetes = k8sStatus === 'configured' || k8sStatus === 'connected'
      ? 'connected'
      : 'disconnected';
  } catch {
    status.kubernetes = 'disconnected';
  }

  return status;
}

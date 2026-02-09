/**
 * Hook for monitoring connection status of all services
 */
import { useState, useEffect, useCallback } from 'react';
import { config } from '../config/env';
import type { ConnectionStatus, ServiceStatus } from '../types';

interface UseConnectionStatusResult {
  status: ConnectionStatus;
  refresh: () => Promise<void>;
  isHealthy: boolean;
  updateWebSocketStatus: (wsStatus: ServiceStatus) => void;
}

export function useConnectionStatus(): UseConnectionStatusResult {
  const [status, setStatus] = useState<ConnectionStatus>({
    api: 'disconnected',
    websocket: 'disconnected',
    vision: 'disconnected',
    kubernetes: 'disconnected',
  });

  const checkApiHealth = useCallback(async (): Promise<ServiceStatus> => {
    try {
      const response = await fetch(`${config.apiUrl}/api/v1/health`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok ? 'connected' : 'error';
    } catch {
      return 'disconnected';
    }
  }, []);

  const checkVisionHealth = useCallback(async (): Promise<ServiceStatus> => {
    try {
      const response = await fetch(`${config.apiUrl}/api/v1/vision/health`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok ? 'connected' : 'error';
    } catch {
      return 'disconnected';
    }
  }, []);

  const checkKubernetesHealth = useCallback(async (): Promise<ServiceStatus> => {
    try {
      const response = await fetch(`${config.apiUrl}/api/v1/health/kubernetes`, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const data = await response.json();
        return data.status === 'connected' ? 'connected' : 'disconnected';
      }
      return 'disconnected';
    } catch {
      return 'disconnected';
    }
  }, []);

  const refresh = useCallback(async () => {
    const [api, vision, kubernetes] = await Promise.all([
      checkApiHealth(),
      checkVisionHealth(),
      checkKubernetesHealth(),
    ]);

    setStatus((prev) => ({
      ...prev,
      api,
      vision,
      kubernetes,
    }));
  }, [checkApiHealth, checkVisionHealth, checkKubernetesHealth]);

  // Update WebSocket status from context
  const updateWebSocketStatus = useCallback((wsStatus: ServiceStatus) => {
    setStatus((prev) => ({
      ...prev,
      websocket: wsStatus,
    }));
  }, []);

  useEffect(() => {
    // Initial check
    refresh();

    // Poll health at interval
    const interval = setInterval(refresh, config.polling.healthInterval);

    return () => clearInterval(interval);
  }, [refresh]);

  const isHealthy =
    status.api === 'connected' &&
    status.websocket === 'connected' &&
    status.vision === 'connected';

  return { status, refresh, isHealthy, updateWebSocketStatus };
}

// Export the updater for WebSocket context to use
export type { UseConnectionStatusResult };

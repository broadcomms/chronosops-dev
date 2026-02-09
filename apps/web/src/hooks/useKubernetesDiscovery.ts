/**
 * React Query hooks for Kubernetes Discovery API
 */
import { useQuery } from '@tanstack/react-query';
import { kubernetesApi } from '../api/kubernetes';

// Query keys
export const kubernetesKeys = {
  all: ['kubernetes'] as const,
  status: () => [...kubernetesKeys.all, 'status'] as const,
  namespaces: () => [...kubernetesKeys.all, 'namespaces'] as const,
  deployments: (namespace: string) => [...kubernetesKeys.all, 'deployments', namespace] as const,
};

/**
 * Hook to get Kubernetes connection status
 */
export function useKubernetesStatus() {
  return useQuery({
    queryKey: kubernetesKeys.status(),
    queryFn: async () => {
      const response = await kubernetesApi.getStatus();
      return {
        connected: response.connected,
        message: response.message,
        error: response.error,
      };
    },
    staleTime: 10000, // Check every 10 seconds
    retry: false, // Don't retry if cluster not available
  });
}

/**
 * Hook to list all namespaces in the cluster
 */
export function useKubernetesNamespaces() {
  return useQuery({
    queryKey: kubernetesKeys.namespaces(),
    queryFn: async () => {
      const response = await kubernetesApi.listNamespaces();
      if (!response.success) {
        throw new Error(response.error || 'Failed to list namespaces');
      }
      return response.data;
    },
    staleTime: 30000, // Cache for 30 seconds
  });
}

/**
 * Hook to list deployments in a namespace
 */
export function useKubernetesDeployments(namespace: string) {
  return useQuery({
    queryKey: kubernetesKeys.deployments(namespace),
    queryFn: async () => {
      const response = await kubernetesApi.listDeployments(namespace);
      if (!response.success) {
        throw new Error(response.error || 'Failed to list deployments');
      }
      return response.data;
    },
    enabled: !!namespace, // Only run if namespace is provided
    staleTime: 30000, // Cache for 30 seconds
  });
}

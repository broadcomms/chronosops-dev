/**
 * Kubernetes Discovery API endpoints
 */
import { apiClient } from './client';

export interface NamespaceInfo {
  name: string;
  status: 'Active' | 'Terminating';
  createdAt: string;
}

export interface DeploymentInfo {
  name: string;
  namespace: string;
  replicas: number;
  availableReplicas: number;
  readyReplicas: number;
  revision: number;
  image: string;
  createdAt: string;
  status: 'available' | 'progressing' | 'failed';
}

export interface KubernetesStatusResponse {
  success: boolean;
  connected: boolean;
  message: string;
  error?: string;
}

export interface KubernetesListResponse<T> {
  success: boolean;
  data: T[];
  error?: string;
  message?: string;
}

/**
 * Kubernetes Discovery API
 */
export const kubernetesApi = {
  /**
   * Get K8s connection status
   */
  getStatus: () => apiClient<KubernetesStatusResponse>('/api/v1/kubernetes/status'),

  /**
   * List all namespaces in the cluster
   */
  listNamespaces: () =>
    apiClient<KubernetesListResponse<NamespaceInfo>>('/api/v1/kubernetes/namespaces'),

  /**
   * List deployments in a namespace
   */
  listDeployments: (namespace: string) =>
    apiClient<KubernetesListResponse<DeploymentInfo>>(
      `/api/v1/kubernetes/deployments?namespace=${encodeURIComponent(namespace)}`
    ),
};

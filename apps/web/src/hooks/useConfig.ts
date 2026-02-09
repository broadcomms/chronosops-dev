/**
 * React Query hooks for Configuration API
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { configApi } from '../api/config';
import type {
  KubernetesConfig,
  DashboardConfig,
  ActionSafetyConfig,
  DevelopmentSettingsConfig,
} from '@chronosops/shared';

// Query keys
export const configKeys = {
  all: ['config'] as const,
  kubernetes: () => [...configKeys.all, 'kubernetes'] as const,
  dashboard: () => [...configKeys.all, 'dashboard'] as const,
  safety: () => [...configKeys.all, 'safety'] as const,
  development: () => [...configKeys.all, 'development'] as const,
};

/**
 * Hook to get all configuration
 */
export function useConfiguration() {
  return useQuery({
    queryKey: configKeys.all,
    queryFn: async () => {
      const response = await configApi.getAll();
      return response.data;
    },
    staleTime: 30000, // Consider fresh for 30 seconds
  });
}

/**
 * Hook to get Kubernetes configuration
 */
export function useKubernetesConfig() {
  return useQuery({
    queryKey: configKeys.kubernetes(),
    queryFn: async () => {
      const response = await configApi.getKubernetes();
      return {
        config: response.data,
        isValid: response.isValid ?? false,
        lastTestedAt: response.lastTestedAt,
      };
    },
    staleTime: 30000,
  });
}

/**
 * Hook to update Kubernetes configuration
 */
export function useUpdateKubernetesConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (config: KubernetesConfig) => configApi.updateKubernetes(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: configKeys.all });
      queryClient.invalidateQueries({ queryKey: configKeys.kubernetes() });
    },
  });
}

/**
 * Hook to test Kubernetes connection
 */
export function useTestKubernetesConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (context?: string) => configApi.testKubernetes(context),
    onSuccess: () => {
      // Refresh config to get updated validation status
      queryClient.invalidateQueries({ queryKey: configKeys.kubernetes() });
    },
  });
}

/**
 * Hook to get Dashboard configuration
 */
export function useDashboardConfig() {
  return useQuery({
    queryKey: configKeys.dashboard(),
    queryFn: async () => {
      const response = await configApi.getDashboard();
      return {
        config: response.data,
        isValid: response.isValid ?? false,
        lastTestedAt: response.lastTestedAt,
      };
    },
    staleTime: 30000,
  });
}

/**
 * Hook to update Dashboard configuration
 */
export function useUpdateDashboardConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (config: DashboardConfig) => configApi.updateDashboard(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: configKeys.all });
      queryClient.invalidateQueries({ queryKey: configKeys.dashboard() });
    },
  });
}

/**
 * Hook to test Dashboard/Screen Capture connection
 */
export function useTestDashboardConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (url?: string) => configApi.testDashboard(url),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: configKeys.dashboard() });
    },
  });
}

/**
 * Hook to get Action Safety configuration
 */
export function useSafetyConfig() {
  return useQuery({
    queryKey: configKeys.safety(),
    queryFn: async () => {
      const response = await configApi.getSafety();
      return response.data;
    },
    staleTime: 30000,
  });
}

/**
 * Hook to update Action Safety configuration
 */
export function useUpdateSafetyConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (config: ActionSafetyConfig) => configApi.updateSafety(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: configKeys.all });
      queryClient.invalidateQueries({ queryKey: configKeys.safety() });
    },
  });
}

/**
 * Hook to get Development Settings configuration
 */
export function useDevelopmentConfig() {
  return useQuery({
    queryKey: configKeys.development(),
    queryFn: async () => {
      const response = await configApi.getDevelopment();
      return response.data;
    },
    staleTime: 30000,
  });
}

/**
 * Hook to update Development Settings configuration
 */
export function useUpdateDevelopmentConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (config: DevelopmentSettingsConfig) => configApi.updateDevelopment(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: configKeys.all });
      queryClient.invalidateQueries({ queryKey: configKeys.development() });
    },
  });
}

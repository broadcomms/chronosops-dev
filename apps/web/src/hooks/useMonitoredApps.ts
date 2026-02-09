/**
 * React Query hooks for Monitored Apps API
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { monitoredAppsApi } from '../api/monitored-apps';
import type { CreateMonitoredAppInput, UpdateMonitoredAppInput } from '../api/monitored-apps';

// Query keys
export const monitoredAppsKeys = {
  all: ['monitored-apps'] as const,
  active: () => [...monitoredAppsKeys.all, 'active'] as const,
  byId: (id: string) => [...monitoredAppsKeys.all, id] as const,
};

/**
 * Hook to get all monitored apps
 */
export function useMonitoredApps() {
  return useQuery({
    queryKey: monitoredAppsKeys.all,
    queryFn: async () => {
      const response = await monitoredAppsApi.getAll();
      if (!response.success) {
        throw new Error(response.error || 'Failed to fetch monitored apps');
      }
      // Ensure we always return an array
      return Array.isArray(response.data) ? response.data : [];
    },
    staleTime: 30000, // Cache for 30 seconds
    // Removed initialData to ensure fresh fetch on mount
  });
}

/**
 * Hook to get active monitored apps only
 * @param options.refetchInterval - Optional interval in ms to refetch data
 */
export function useActiveMonitoredApps(options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: monitoredAppsKeys.active(),
    queryFn: async () => {
      const response = await monitoredAppsApi.getActive();
      if (!response.success) {
        throw new Error(response.error || 'Failed to fetch active monitored apps');
      }
      // Ensure we always return an array
      return Array.isArray(response.data) ? response.data : [];
    },
    staleTime: 30000, // Cache for 30 seconds
    refetchInterval: options?.refetchInterval,
    // Removed initialData to ensure fresh fetch on mount
    // The component handles empty/loading states
  });
}

/**
 * Hook to add a monitored app
 */
export function useAddMonitoredApp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateMonitoredAppInput) => {
      const response = await monitoredAppsApi.create(input);

      // If app already exists (409), treat as success - it's already monitored
      if (!response.success && response.error?.includes('already exists')) {
        // Invalidate cache to get fresh data
        await queryClient.invalidateQueries({ queryKey: monitoredAppsKeys.all });
        // Return success - the app is already monitored, which is the desired state
        return { success: true, data: response.data, alreadyMonitored: true };
      }

      if (!response.success) {
        throw new Error(response.error || 'Failed to add monitored app');
      }

      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: monitoredAppsKeys.all });
    },
    onError: () => {
      // On any error, refresh the cache to get current state
      queryClient.invalidateQueries({ queryKey: monitoredAppsKeys.all });
    },
  });
}

/**
 * Hook to update a monitored app
 */
export function useUpdateMonitoredApp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateMonitoredAppInput }) =>
      monitoredAppsApi.update(id, input),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: monitoredAppsKeys.all });
      queryClient.invalidateQueries({ queryKey: monitoredAppsKeys.byId(id) });
    },
  });
}

/**
 * Hook to remove a monitored app
 */
export function useRemoveMonitoredApp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => monitoredAppsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: monitoredAppsKeys.all });
    },
  });
}

/**
 * Hook to generate Grafana dashboard for an app
 */
export function useGenerateDashboard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => monitoredAppsApi.generateDashboard(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: monitoredAppsKeys.all });
      queryClient.invalidateQueries({ queryKey: monitoredAppsKeys.byId(id) });
    },
  });
}

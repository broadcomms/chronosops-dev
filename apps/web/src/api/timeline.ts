/**
 * Timeline API endpoints and hooks
 * Provides unified history view across all ChronosOps entities
 */
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { apiClient, buildQueryString } from './client';
import type {
  UnifiedTimelineEvent,
  UnifiedTimelineResponse,
  TimelineEntityType,
  TimelineFilterState,
} from '@chronosops/shared';

// Re-export types for consumers
export type { UnifiedTimelineEvent, UnifiedTimelineResponse, TimelineEntityType, TimelineFilterState };

// Query parameters for timeline
export interface TimelineQueryParams {
  limit?: number;
  cursor?: string;
  startDate?: string;
  endDate?: string;
  entityTypes?: TimelineEntityType[];
  status?: string;
  search?: string;
}

// Timeline statistics response
export interface TimelineStats {
  totalEvents: number;
  byEntityType: Record<TimelineEntityType, number>;
  recentActivity: {
    last24Hours: number;
    last7Days: number;
    last30Days: number;
  };
}

/**
 * Convert TimelineQueryParams to query string format
 */
function buildTimelineQueryString(params?: TimelineQueryParams): string {
  if (!params) return '';
  
  const queryParams: Record<string, string | number | boolean | undefined> = {
    limit: params.limit,
    cursor: params.cursor,
    startDate: params.startDate,
    endDate: params.endDate,
    status: params.status,
    search: params.search,
  };
  
  // Convert entityTypes array to comma-separated string
  if (params.entityTypes && params.entityTypes.length > 0) {
    queryParams.entityTypes = params.entityTypes.join(',');
  }
  
  return buildQueryString(queryParams);
}

/**
 * Timeline API endpoints
 */
export const timelineApi = {
  /**
   * Get unified timeline
   */
  list: (params?: TimelineQueryParams) =>
    apiClient<UnifiedTimelineResponse>(
      `/api/v1/timeline${buildTimelineQueryString(params)}`
    ),

  /**
   * Get timeline statistics
   */
  stats: () =>
    apiClient<TimelineStats>('/api/v1/timeline/stats'),

  /**
   * Get specific entity details
   */
  getEntity: (entityType: TimelineEntityType, entityId: string) =>
    apiClient<UnifiedTimelineEvent>(`/api/v1/timeline/entity/${entityType}/${entityId}`),
};

// Query keys for cache management
export const timelineKeys = {
  all: ['timeline'] as const,
  lists: () => [...timelineKeys.all, 'list'] as const,
  list: (params?: TimelineQueryParams) => [...timelineKeys.lists(), params] as const,
  stats: () => [...timelineKeys.all, 'stats'] as const,
  entity: (entityType: TimelineEntityType, entityId: string) => 
    [...timelineKeys.all, 'entity', entityType, entityId] as const,
};

/**
 * Hook to fetch unified timeline with pagination
 */
export function useUnifiedTimeline(params?: Omit<TimelineQueryParams, 'cursor'>) {
  return useInfiniteQuery({
    queryKey: timelineKeys.list(params),
    queryFn: async ({ pageParam }) => {
      const queryParams: TimelineQueryParams = {
        ...params,
        cursor: pageParam as string | undefined,
      };
      return timelineApi.list(queryParams);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => {
      return lastPage.hasMore ? lastPage.cursor : undefined;
    },
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // Refetch every minute
  });
}

/**
 * Hook to fetch timeline statistics
 */
export function useTimelineStats() {
  return useQuery({
    queryKey: timelineKeys.stats(),
    queryFn: timelineApi.stats,
    staleTime: 60000, // 1 minute
    refetchInterval: 120000, // Refetch every 2 minutes
  });
}

/**
 * Hook to fetch a specific entity from timeline
 */
export function useTimelineEntity(entityType: TimelineEntityType, entityId: string) {
  return useQuery({
    queryKey: timelineKeys.entity(entityType, entityId),
    queryFn: () => timelineApi.getEntity(entityType, entityId),
    enabled: !!entityType && !!entityId,
    staleTime: 30000,
  });
}

/**
 * Hook to manage timeline filter state
 * Returns filter state and utilities for managing it
 */
export function createTimelineFilterParams(filters: TimelineFilterState): TimelineQueryParams {
  const params: TimelineQueryParams = {};
  
  // Entity type filters
  const enabledTypes = Object.entries(filters.entityTypes)
    .filter(([, enabled]) => enabled)
    .map(([type]) => type as TimelineEntityType);
  
  if (enabledTypes.length > 0 && enabledTypes.length < 6) {
    params.entityTypes = enabledTypes;
  }
  
  // Date range filters
  if (filters.dateRange.start) {
    params.startDate = filters.dateRange.start.toISOString();
  }
  if (filters.dateRange.end) {
    params.endDate = filters.dateRange.end.toISOString();
  }
  
  // Status filter
  if (filters.status && filters.status !== 'all') {
    params.status = filters.status;
  }
  
  // Search query
  if (filters.searchQuery && filters.searchQuery.trim()) {
    params.search = filters.searchQuery.trim();
  }
  
  return params;
}

/**
 * Default filter state with all entity types enabled
 */
export const defaultFilterState: TimelineFilterState = {
  entityTypes: {
    incident: true,
    development_cycle: true,
    code_evolution: true,
    learned_pattern: true,
    action: true,
    reconstruction: true,
  },
  dateRange: {
    start: null,
    end: null,
  },
  status: null,
  searchQuery: '',
};

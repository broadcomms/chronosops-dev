/**
 * History - Unified Timeline View
 * Shows all ChronosOps activities: incidents, development, evolutions, patterns, actions, reconstructions
 */
import { useState, useMemo, useCallback } from 'react';
import { 
  BookOpen, 
  RefreshCw, 
  ChevronDown,
  Loader2,
} from 'lucide-react';
import { PageLayout, Section, Card } from '../components/layout/PageLayout';
import { 
  TimelineFilters,
  TimelineEventCard,
  TimelineEventCardSkeleton,
  TimelineStatsBar,
  EntityTypeBreakdown,
} from '../components/history';
import {
  useUnifiedTimeline,
  useTimelineStats,
  createTimelineFilterParams,
  defaultFilterState,
} from '../api/timeline';
import type { TimelineFilterState } from '@chronosops/shared';

export function History() {
  // Filter state
  const [filters, setFilters] = useState<TimelineFilterState>(defaultFilterState);
  
  // Convert filters to query params
  const queryParams = useMemo(() => 
    createTimelineFilterParams(filters), 
    [filters]
  );
  
  // Fetch unified timeline with infinite scroll
  const {
    data: timelineData,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useUnifiedTimeline(queryParams);
  
  // Fetch timeline stats
  const { data: stats, isLoading: statsLoading } = useTimelineStats();
  
  // Flatten pages into single array
  const events = useMemo(() => 
    timelineData?.pages.flatMap(page => page.events) ?? [],
    [timelineData]
  );
  
  // Handle filter changes
  const handleFiltersChange = useCallback((newFilters: TimelineFilterState) => {
    setFilters(newFilters);
  }, []);
  
  // Loading state
  if (isLoading && events.length === 0) {
    return (
      <PageLayout title="History">
        <Section description="Unified timeline of all ChronosOps activities">
          <div className="space-y-4">
            <TimelineFilters 
              filters={filters} 
              onFiltersChange={handleFiltersChange}
              isLoading={true}
            />
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <TimelineEventCardSkeleton key={i} />
              ))}
            </div>
          </div>
        </Section>
      </PageLayout>
    );
  }
  
  // Error state
  if (isError) {
    return (
      <PageLayout title="History">
        <Section description="Unified timeline of all ChronosOps activities">
          <Card>
            <div className="text-center py-12">
              <div className="text-red-400 text-4xl mb-4">⚠️</div>
              <p className="text-red-400 font-medium">Failed to load timeline</p>
              <p className="text-sm text-gray-500 mt-2">
                {error instanceof Error ? error.message : 'Unknown error occurred'}
              </p>
              <button
                onClick={() => refetch()}
                className="mt-4 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm flex items-center gap-2 mx-auto"
              >
                <RefreshCw size={14} />
                Retry
              </button>
            </div>
          </Card>
        </Section>
      </PageLayout>
    );
  }
  
  // Empty state
  if (events.length === 0) {
    return (
      <PageLayout title="History">
        <Section description="Unified timeline of all ChronosOps activities">
          <div className="space-y-4">
            <TimelineFilters 
              filters={filters} 
              onFiltersChange={handleFiltersChange}
            />
            <Card>
              <div className="text-center py-12 text-gray-500">
                <BookOpen size={48} className="mx-auto mb-4 opacity-50" />
                <p>No events found</p>
                <p className="text-sm text-gray-600 mt-2">
                  {Object.values(filters.entityTypes).some(v => !v)
                    ? 'Try adjusting your filters to see more events'
                    : 'ChronosOps activities will appear here as they occur'}
                </p>
              </div>
            </Card>
          </div>
        </Section>
      </PageLayout>
    );
  }
  
  return (
    <PageLayout title="History">
      <Section description="Unified timeline of all ChronosOps activities">
        <div className="space-y-6">
          {/* Stats Overview */}
          {stats && (
            <div className="space-y-3">
              <TimelineStatsBar stats={stats} isLoading={statsLoading} />
              <EntityTypeBreakdown byEntityType={stats.byEntityType} />
            </div>
          )}
          
          {/* Filters */}
          <TimelineFilters 
            filters={filters} 
            onFiltersChange={handleFiltersChange}
            isLoading={isLoading}
          />
          
          {/* Timeline Events */}
          <div className="space-y-4">
            {events.map((event, index) => (
              <TimelineEventCard 
                key={event.id} 
                event={event}
                showConnector={true}
                isLast={index === events.length - 1 && !hasNextPage}
              />
            ))}
          </div>
          
          {/* Load More */}
          {hasNextPage && (
            <div className="flex justify-center pt-4">
              <button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="flex items-center gap-2 px-6 py-3 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg text-sm transition-colors"
              >
                {isFetchingNextPage ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Loading more...
                  </>
                ) : (
                  <>
                    <ChevronDown size={16} />
                    Load More Events
                  </>
                )}
              </button>
            </div>
          )}
          
          {/* End of timeline indicator */}
          {!hasNextPage && events.length > 0 && (
            <div className="text-center py-4 text-gray-500 text-sm">
              <div className="w-8 h-px bg-gray-700 mx-auto mb-3" />
              End of timeline • {events.length} events total
            </div>
          )}
        </div>
      </Section>
    </PageLayout>
  );
}

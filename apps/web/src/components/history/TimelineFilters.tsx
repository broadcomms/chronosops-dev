/**
 * Timeline Filters Component
 * Provides filtering controls for the unified timeline view
 */
import { useState, useCallback } from 'react';
import { 
  Filter, 
  Search, 
  Calendar, 
  X, 
  ChevronDown, 
  ChevronUp,
  RotateCcw,
} from 'lucide-react';
import type { TimelineFilterState, TimelineEntityType } from '@chronosops/shared';
import { ENTITY_CONFIG } from './EntityIcon';
import { defaultFilterState } from '../../api/timeline';

interface TimelineFiltersProps {
  filters: TimelineFilterState;
  onFiltersChange: (filters: TimelineFilterState) => void;
  isLoading?: boolean;
}

export function TimelineFilters({ 
  filters, 
  onFiltersChange, 
  isLoading 
}: TimelineFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Toggle entity type filter
  const toggleEntityType = useCallback((entityType: TimelineEntityType) => {
    const currentValue = filters.entityTypes[entityType];
    onFiltersChange({
      ...filters,
      entityTypes: {
        ...filters.entityTypes,
        [entityType]: !currentValue,
      },
    });
  }, [filters, onFiltersChange]);
  
  // Update search query
  const updateSearch = useCallback((query: string) => {
    onFiltersChange({
      ...filters,
      searchQuery: query,
    });
  }, [filters, onFiltersChange]);
  
  // Set date range
  const updateDateRange = useCallback((start: Date | null, end: Date | null) => {
    onFiltersChange({
      ...filters,
      dateRange: { start, end },
    });
  }, [filters, onFiltersChange]);
  
  // Quick date range presets
  const setQuickDateRange = useCallback((preset: 'today' | 'week' | 'month' | 'all') => {
    const now = new Date();
    let start: Date | null = null;
    
    switch (preset) {
      case 'today':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'all':
        start = null;
        break;
    }
    
    updateDateRange(start, null);
  }, [updateDateRange]);
  
  // Reset all filters
  const resetFilters = useCallback(() => {
    onFiltersChange(defaultFilterState);
  }, [onFiltersChange]);
  
  // Check if any filters are active
  const hasActiveFilters = 
    filters.searchQuery.trim() !== '' ||
    filters.dateRange.start !== null ||
    filters.dateRange.end !== null ||
    Object.values(filters.entityTypes).some(v => !v);
  
  // Count enabled entity types
  const enabledCount = Object.values(filters.entityTypes).filter(Boolean).length;
  
  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
      {/* Compact Filter Bar */}
      <div className="p-3 flex items-center gap-3">
        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={filters.searchQuery}
            onChange={(e) => updateSearch(e.target.value)}
            placeholder="Search timeline events..."
            className="w-full pl-9 pr-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-cyan-500/50"
            disabled={isLoading}
          />
          {filters.searchQuery && (
            <button
              onClick={() => updateSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
            >
              <X size={14} />
            </button>
          )}
        </div>
        
        {/* Quick Date Filters */}
        <div className="flex items-center gap-1">
          {(['today', 'week', 'month', 'all'] as const).map((preset) => (
            <button
              key={preset}
              onClick={() => setQuickDateRange(preset)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                (preset === 'all' && !filters.dateRange.start) ||
                (preset === 'today' && filters.dateRange.start && 
                  new Date().getTime() - filters.dateRange.start.getTime() < 24 * 60 * 60 * 1000) ||
                (preset === 'week' && filters.dateRange.start &&
                  new Date().getTime() - filters.dateRange.start.getTime() >= 6 * 24 * 60 * 60 * 1000 &&
                  new Date().getTime() - filters.dateRange.start.getTime() < 8 * 24 * 60 * 60 * 1000) ||
                (preset === 'month' && filters.dateRange.start &&
                  new Date().getTime() - filters.dateRange.start.getTime() >= 29 * 24 * 60 * 60 * 1000)
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600 border border-transparent'
              }`}
              disabled={isLoading}
            >
              {preset === 'all' ? 'All Time' : preset.charAt(0).toUpperCase() + preset.slice(1)}
            </button>
          ))}
        </div>
        
        {/* Expand/Collapse Button */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-gray-700 text-gray-300 hover:bg-gray-600 rounded transition-colors"
        >
          <Filter size={14} />
          <span>Filters</span>
          {enabledCount < 6 && (
            <span className="ml-1 px-1.5 py-0.5 bg-cyan-500/20 text-cyan-400 rounded text-xs">
              {enabledCount}
            </span>
          )}
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        
        {/* Reset Button */}
        {hasActiveFilters && (
          <button
            onClick={resetFilters}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors"
            title="Reset filters"
          >
            <RotateCcw size={14} />
          </button>
        )}
      </div>
      
      {/* Expanded Filters Panel */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-0 border-t border-gray-700">
          <div className="pt-3">
            <div className="text-xs text-gray-500 mb-2">Event Types</div>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(ENTITY_CONFIG) as TimelineEntityType[]).map((entityType) => {
                const config = ENTITY_CONFIG[entityType];
                const isEnabled = filters.entityTypes[entityType];
                const IconComponent = config.icon;
                
                return (
                  <button
                    key={entityType}
                    onClick={() => toggleEntityType(entityType)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all ${
                      isEnabled
                        ? `${config.bgColor} ${config.color} border ${config.borderColor}`
                        : 'bg-gray-800 text-gray-500 border border-gray-700 opacity-60'
                    }`}
                    disabled={isLoading}
                  >
                    <IconComponent size={14} />
                    <span>{config.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          
          {/* Custom Date Range (future enhancement) */}
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
            <Calendar size={14} />
            <span>Custom date range picker coming soon</span>
          </div>
        </div>
      )}
    </div>
  );
}

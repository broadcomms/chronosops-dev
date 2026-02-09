/**
 * TimelineViewer - Display reconstructed incident timeline
 */
import { memo } from 'react';
import { format } from 'date-fns';
import {
  Clock,
  AlertTriangle,
  AlertCircle,
  Info,
  Circle,
} from 'lucide-react';
import type { ReconstructionTimelineEntry } from '../../types';

interface TimelineViewerProps {
  entries: ReconstructionTimelineEntry[];
  className?: string;
  onEntryClick?: (entry: ReconstructionTimelineEntry) => void;
}

const significanceConfig: Record<ReconstructionTimelineEntry['significance'], {
  icon: typeof AlertTriangle;
  color: string;
  bgColor: string;
  borderColor: string;
}> = {
  low: {
    icon: Info,
    color: 'text-gray-400',
    bgColor: 'bg-gray-500/10',
    borderColor: 'border-gray-500/30',
  },
  medium: {
    icon: Circle,
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/10',
    borderColor: 'border-yellow-500/30',
  },
  high: {
    icon: AlertCircle,
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10',
    borderColor: 'border-orange-500/30',
  },
  critical: {
    icon: AlertTriangle,
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/30',
  },
};

const categoryColors: Record<string, string> = {
  detection: 'text-observe',
  diagnosis: 'text-orient',
  action: 'text-act',
  verification: 'text-verify',
  resolution: 'text-green-400',
  error: 'text-red-400',
  warning: 'text-yellow-400',
  info: 'text-blue-400',
};

interface TimelineEntryProps {
  entry: ReconstructionTimelineEntry;
  isLast: boolean;
  onClick?: () => void;
}

const TimelineEntry = memo(function TimelineEntry({ entry, isLast, onClick }: TimelineEntryProps) {
  // Handle various significance formats from backend
  const normalizedSignificance = (entry.significance?.toLowerCase() ?? 'low') as keyof typeof significanceConfig;
  const config = significanceConfig[normalizedSignificance] || significanceConfig.low;
  const Icon = config.icon;
  const categoryColor = categoryColors[(entry.category ?? 'info').toLowerCase()] || 'text-gray-400';

  return (
    <div
      className={`relative ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      {/* Connector line */}
      {!isLast && (
        <div className="absolute left-4 top-10 bottom-0 w-0.5 bg-gray-700" />
      )}

      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={`p-2 rounded-lg ${config.bgColor} ${config.color} flex-shrink-0`}>
          <Icon size={16} />
        </div>

        {/* Content */}
        <div className={`flex-1 pb-4 border ${config.borderColor} ${config.bgColor} rounded-lg p-3 hover:border-opacity-60 transition-colors`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-medium ${categoryColor} uppercase`}>
                  {entry.category}
                </span>
                <span className={`px-1.5 py-0.5 text-xs rounded ${config.bgColor} ${config.color}`}>
                  {normalizedSignificance.toUpperCase()}
                </span>
              </div>
              <h4 className="text-sm font-medium text-white mt-1">{entry.summary}</h4>
            </div>
            <div className="flex items-center gap-1 text-xs text-gray-500 flex-shrink-0">
              <Clock size={12} />
              {format(new Date(entry.timestamp), 'HH:mm:ss')}
            </div>
          </div>

          <p className="text-xs text-gray-400 mt-2">{entry.details ?? ''}</p>

          {(entry.relatedEntities?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {entry.relatedEntities.map((entity, i) => (
                <span
                  key={i}
                  className="px-1.5 py-0.5 text-xs bg-purple-500/10 text-purple-400 rounded"
                >
                  {entity}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export const TimelineViewer = memo(function TimelineViewer({
  entries,
  className = '',
  onEntryClick,
}: TimelineViewerProps) {
  if (entries.length === 0) {
    return (
      <div className={`bg-gray-800/50 border border-gray-700 rounded-lg p-4 ${className}`}>
        <div className="flex items-center gap-2 mb-4">
          <Clock size={18} className="text-gray-400" />
          <h3 className="text-sm font-medium text-gray-300">Reconstructed Timeline</h3>
        </div>
        <div className="text-center py-8 text-gray-500">
          <Clock size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">No timeline entries</p>
        </div>
      </div>
    );
  }

  // Sort by timestamp
  const sortedEntries = [...entries].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Group by significance for stats (normalize to lowercase)
  const stats = {
    critical: entries.filter((e) => e.significance?.toLowerCase() === 'critical').length,
    high: entries.filter((e) => e.significance?.toLowerCase() === 'high').length,
    medium: entries.filter((e) => e.significance?.toLowerCase() === 'medium').length,
    low: entries.filter((e) => e.significance?.toLowerCase() === 'low' || !e.significance).length,
  };

  return (
    <div className={`bg-gray-800/50 border border-gray-700 rounded-lg p-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clock size={18} className="text-blue-400" />
          <h3 className="text-sm font-medium text-gray-300">Reconstructed Timeline</h3>
          <span className="text-xs text-gray-500">({entries.length} events)</span>
        </div>
        <div className="flex items-center gap-2">
          {stats.critical > 0 && (
            <span className="px-2 py-0.5 text-xs bg-red-500/10 text-red-400 rounded">
              {stats.critical} Critical
            </span>
          )}
          {stats.high > 0 && (
            <span className="px-2 py-0.5 text-xs bg-orange-500/10 text-orange-400 rounded">
              {stats.high} High
            </span>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="space-y-1">
        {sortedEntries.map((entry, index) => (
          <TimelineEntry
            key={`${entry.timestamp}-${index}`}
            entry={entry}
            isLast={index === sortedEntries.length - 1}
            onClick={onEntryClick ? () => onEntryClick(entry) : undefined}
          />
        ))}
      </div>
    </div>
  );
});

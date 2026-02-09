/**
 * PatternLibrary - Display and manage learned patterns
 */
import { memo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import {
  Brain,
  Search,
  Compass,
  Wrench,
  Shield,
  ChevronDown,
  ChevronRight,
  Trash2,
  Power,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { intelligenceApi } from '../../api/intelligence';
import type { LearnedPattern, PatternType } from '../../types';

interface PatternLibraryProps {
  patterns: LearnedPattern[];
  className?: string;
}

const patternTypeConfig: Record<PatternType, {
  icon: typeof Brain;
  color: string;
  bgColor: string;
  label: string;
}> = {
  detection: {
    icon: Search,
    color: 'text-observe',
    bgColor: 'bg-observe/10',
    label: 'Detection',
  },
  diagnostic: {
    icon: Compass,
    color: 'text-orient',
    bgColor: 'bg-orient/10',
    label: 'Diagnostic',
  },
  resolution: {
    icon: Wrench,
    color: 'text-act',
    bgColor: 'bg-act/10',
    label: 'Resolution',
  },
  prevention: {
    icon: Shield,
    color: 'text-verify',
    bgColor: 'bg-verify/10',
    label: 'Prevention',
  },
};

interface PatternCardProps {
  pattern: LearnedPattern;
  isExpanded: boolean;
  onToggle: () => void;
}

const PatternCard = memo(function PatternCard({
  pattern,
  isExpanded,
  onToggle,
}: PatternCardProps) {
  const queryClient = useQueryClient();
  const config = patternTypeConfig[pattern.type];
  const Icon = config.icon;

  const deactivateMutation = useMutation({
    mutationFn: () => intelligenceApi.deactivatePattern(pattern.id, 'User deactivated'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['intelligence-patterns'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => intelligenceApi.deletePattern(pattern.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['intelligence-patterns'] });
    },
  });

  const getConfidenceColor = (confidence: number): string => {
    if (confidence >= 0.8) return 'text-green-400';
    if (confidence >= 0.6) return 'text-yellow-400';
    return 'text-orange-400';
  };

  return (
    <div className={`border border-gray-700 rounded-lg overflow-hidden ${!pattern.isActive ? 'opacity-60' : ''}`}>
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between bg-gray-800/50 hover:bg-gray-800 transition-colors"
      >
        <div className="flex items-center gap-3">
          {isExpanded ? (
            <ChevronDown size={16} className="text-gray-400" />
          ) : (
            <ChevronRight size={16} className="text-gray-400" />
          )}
          <div className={`p-1.5 rounded ${config.bgColor}`}>
            <Icon size={16} className={config.color} />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-white">{pattern.name}</span>
              <span className={`px-1.5 py-0.5 text-xs rounded ${config.bgColor} ${config.color}`}>
                {config.label}
              </span>
              {!pattern.isActive && (
                <span className="px-1.5 py-0.5 text-xs bg-gray-700 text-gray-400 rounded">
                  Inactive
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
              <span className={getConfidenceColor(pattern.confidence)}>
                {Math.round(pattern.confidence * 100)}% confidence
              </span>
              <span>Matched {pattern.timesMatched}x</span>
              {pattern.successRate !== null && (
                <span className="text-green-400">
                  {Math.round(pattern.successRate * 100)}% success
                </span>
              )}
            </div>
          </div>
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-gray-700 p-4">
          <p className="text-sm text-gray-400 mb-4">{pattern.description}</p>

          {/* Trigger Conditions */}
          <div className="mb-4">
            <h4 className="text-xs font-medium text-gray-400 mb-2">Trigger Conditions</h4>
            <ul className="space-y-1">
              {pattern.triggerConditions.map((condition, i) => (
                <li key={i} className="text-xs text-gray-500 flex items-start gap-2">
                  <span className={config.color}>•</span>
                  {condition}
                </li>
              ))}
            </ul>
          </div>

          {/* Recommended Actions */}
          <div className="mb-4">
            <h4 className="text-xs font-medium text-gray-400 mb-2">Recommended Actions</h4>
            <ul className="space-y-1">
              {pattern.recommendedActions.map((action, i) => (
                <li key={i} className="text-xs text-gray-500 flex items-start gap-2">
                  <CheckCircle size={12} className="text-green-400 mt-0.5 flex-shrink-0" />
                  {action}
                </li>
              ))}
            </ul>
          </div>

          {/* Exceptions */}
          {pattern.exceptions.length > 0 && (
            <div className="mb-4">
              <h4 className="text-xs font-medium text-gray-400 mb-2">Exceptions</h4>
              <ul className="space-y-1">
                {pattern.exceptions.map((exception, i) => (
                  <li key={i} className="text-xs text-gray-500 flex items-start gap-2">
                    <XCircle size={12} className="text-red-400 mt-0.5 flex-shrink-0" />
                    {exception}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Applicability */}
          <div className="mb-4 p-2 bg-gray-900/50 rounded">
            <h4 className="text-xs font-medium text-gray-400 mb-1">Applicability</h4>
            <p className="text-xs text-gray-500">{pattern.applicability}</p>
          </div>

          {/* Metadata */}
          <div className="flex items-center justify-between text-xs text-gray-500 pt-3 border-t border-gray-700">
            <span>
              Created {formatDistanceToNow(new Date(pattern.createdAt), { addSuffix: true })}
            </span>
            <div className="flex items-center gap-2">
              {pattern.isActive && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deactivateMutation.mutate();
                  }}
                  disabled={deactivateMutation.isPending}
                  className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-yellow-400 transition-colors"
                  title="Deactivate"
                >
                  <Power size={14} />
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm('Delete this pattern?')) {
                    deleteMutation.mutate();
                  }
                }}
                disabled={deleteMutation.isPending}
                className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-red-400 transition-colors"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export const PatternLibrary = memo(function PatternLibrary({
  patterns,
  className = '',
}: PatternLibraryProps) {
  const [expandedPatterns, setExpandedPatterns] = useState<Set<string>>(new Set());
  const [filterType, setFilterType] = useState<PatternType | 'all'>('all');
  const [showInactive, setShowInactive] = useState(false);

  const togglePattern = (patternId: string) => {
    setExpandedPatterns((prev) => {
      const next = new Set(prev);
      if (next.has(patternId)) {
        next.delete(patternId);
      } else {
        next.add(patternId);
      }
      return next;
    });
  };

  // Apply filters
  const filteredPatterns = patterns.filter((p) => {
    if (filterType !== 'all' && p.type !== filterType) return false;
    if (!showInactive && !p.isActive) return false;
    return true;
  });

  // Count by type
  const countByType: Record<PatternType, number> = {
    detection: patterns.filter((p) => p.type === 'detection').length,
    diagnostic: patterns.filter((p) => p.type === 'diagnostic').length,
    resolution: patterns.filter((p) => p.type === 'resolution').length,
    prevention: patterns.filter((p) => p.type === 'prevention').length,
  };

  return (
    <div className={`bg-gray-800/50 border border-gray-700 rounded-lg ${className}`}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Brain size={18} className="text-purple-400" />
            <h3 className="text-sm font-medium text-gray-300">Pattern Library</h3>
            <span className="text-xs text-gray-500">({filteredPatterns.length} patterns)</span>
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-400">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded border-gray-600 bg-gray-800"
            />
            Show Inactive
          </label>
        </div>

        {/* Type Filters */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setFilterType('all')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              filterType === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-400 hover:text-white'
            }`}
          >
            All ({patterns.length})
          </button>
          {(Object.keys(patternTypeConfig) as PatternType[]).map((type) => {
            const config = patternTypeConfig[type];
            return (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={`px-2 py-1 text-xs rounded transition-colors flex items-center gap-1 ${
                  filterType === type
                    ? `${config.bgColor} ${config.color}`
                    : 'bg-gray-700 text-gray-400 hover:text-white'
                }`}
              >
                <config.icon size={12} />
                {config.label} ({countByType[type]})
              </button>
            );
          })}
        </div>
      </div>

      {/* Patterns List */}
      <div className="p-4 space-y-3 max-h-[600px] overflow-y-auto">
        {filteredPatterns.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Brain size={32} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">No patterns found</p>
            <p className="text-xs mt-1">
              {filterType !== 'all' ? 'Try adjusting filters' : 'Learn patterns from resolved incidents'}
            </p>
          </div>
        ) : (
          filteredPatterns.map((pattern) => (
            <PatternCard
              key={pattern.id}
              pattern={pattern}
              isExpanded={expandedPatterns.has(pattern.id)}
              onToggle={() => togglePattern(pattern.id)}
            />
          ))
        )}
      </div>
    </div>
  );
});

/**
 * HypothesisComparison - Side-by-side hypothesis comparison
 * Shows multiple hypotheses with confidence scores
 */
import { memo, useMemo } from 'react';
import { Lightbulb, Trophy } from 'lucide-react';
import type { Hypothesis, HypothesisStatus } from '../../types';

interface HypothesisComparisonProps {
  hypotheses: Hypothesis[];
  className?: string;
  onSelect?: (hypothesis: Hypothesis) => void;
  selectedId?: string;
}

const statusColors: Record<HypothesisStatus, { bg: string; text: string; label: string }> = {
  proposed: { bg: 'bg-blue-500/10', text: 'text-blue-400', label: 'Proposed' },
  testing: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', label: 'Testing' },
  confirmed: { bg: 'bg-green-500/10', text: 'text-green-400', label: 'Confirmed' },
  rejected: { bg: 'bg-red-500/10', text: 'text-red-400', label: 'Rejected' },
};

export const HypothesisComparison = memo(function HypothesisComparison({
  hypotheses,
  className = '',
  onSelect,
  selectedId,
}: HypothesisComparisonProps) {
  // Sort hypotheses by confidence (highest first)
  const sortedHypotheses = useMemo(() => {
    return [...hypotheses].sort((a, b) => b.confidence - a.confidence);
  }, [hypotheses]);

  // Get the top hypothesis
  const topHypothesis = sortedHypotheses[0];

  if (hypotheses.length === 0) {
    return (
      <div className={`bg-gray-800/50 border border-gray-700 rounded-lg p-4 ${className}`}>
        <h3 className="text-sm font-medium text-gray-300 mb-4">Hypotheses</h3>
        <div className="text-center py-8">
          <Lightbulb size={48} className="mx-auto mb-3 opacity-50 text-gray-500" />
          <p className="text-gray-500 text-sm">No hypotheses generated yet</p>
          <p className="text-gray-600 text-xs mt-1">
            AI will generate hypotheses during the Orient phase
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-gray-800/50 border border-gray-700 rounded-lg p-4 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-300">Hypotheses</h3>
        <span className="text-xs text-gray-500">{hypotheses.length} generated</span>
      </div>

      {/* Top hypothesis highlight */}
      {topHypothesis && (
        <div className="mb-4 p-4 rounded-lg bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/30">
          <div className="flex items-center gap-2 mb-2">
            <Trophy size={18} className="text-yellow-400" />
            <span className="text-sm font-medium text-blue-400">Top Hypothesis</span>
            <span
              className={`ml-auto px-2 py-0.5 rounded text-xs font-medium ${statusColors[topHypothesis.status].bg} ${statusColors[topHypothesis.status].text}`}
            >
              {statusColors[topHypothesis.status].label}
            </span>
          </div>
          <p className="text-sm text-gray-300 mb-3">{topHypothesis.rootCause}</p>
          <div className="flex items-center gap-4">
            <ConfidenceBar confidence={topHypothesis.confidence} />
            {topHypothesis.suggestedActions?.length > 0 && (
              <span className="text-xs text-gray-500">
                Action: {topHypothesis.suggestedActions[0]}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Other hypotheses */}
      {sortedHypotheses.length > 1 && (
        <div className="space-y-3 max-h-64 overflow-y-auto">
          {sortedHypotheses.slice(1).map((hypothesis) => {
            const isSelected = selectedId === hypothesis.id;
            const colors = statusColors[hypothesis.status];

            return (
              <div
                key={hypothesis.id}
                className={`
                  p-3 rounded-lg border transition-all
                  ${isSelected ? 'bg-blue-500/10 border-blue-500/50' : 'bg-gray-900/50 border-gray-700/50'}
                  ${onSelect ? 'cursor-pointer hover:border-gray-600' : ''}
                `}
                onClick={() => onSelect?.(hypothesis)}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span
                    className={`flex-shrink-0 px-2 py-0.5 rounded text-xs font-medium ${colors.bg} ${colors.text}`}
                  >
                    {colors.label}
                  </span>
                </div>
                <p className="text-xs text-gray-400 line-clamp-3 mb-2">
                  {hypothesis.rootCause}
                </p>
                <ConfidenceBar confidence={hypothesis.confidence} size="sm" />
              </div>
            );
          })}
        </div>
      )}

      {/* Comparison view toggle (if 2+ hypotheses) */}
      {sortedHypotheses.length >= 2 && (
        <div className="mt-4 pt-4 border-t border-gray-700">
          <h4 className="text-xs font-medium text-gray-400 mb-3">
            Confidence Comparison
          </h4>
          <div className="space-y-2">
            {sortedHypotheses.map((h, index) => (
              <div key={h.id} className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-32 truncate" title={h.rootCause}>
                  Hypothesis {index + 1}
                </span>
                <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all"
                    style={{ width: `${h.confidence * 100}%` }}
                  />
                </div>
                <span className="text-xs text-gray-400 w-10 text-right">
                  {Math.round(h.confidence * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

interface ConfidenceBarProps {
  confidence: number;
  size?: 'sm' | 'md';
}

function ConfidenceBar({ confidence, size = 'md' }: ConfidenceBarProps) {
  const percentage = Math.round(confidence * 100);
  const barHeight = size === 'sm' ? 'h-1.5' : 'h-2';

  return (
    <div className="flex items-center gap-2 flex-1">
      <div className={`flex-1 ${barHeight} bg-gray-700 rounded-full overflow-hidden`}>
        <div
          className={`h-full rounded-full transition-all ${
            percentage >= 80
              ? 'bg-green-500'
              : percentage >= 50
              ? 'bg-yellow-500'
              : 'bg-red-500'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-xs text-gray-400 w-10">{percentage}%</span>
    </div>
  );
}

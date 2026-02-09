/**
 * Hypothesis Panel
 * Displays AI-generated hypotheses during the DECIDING phase
 */

export interface HypothesisItem {
  id: string;
  rootCause: string;
  confidence: number;
  supportingEvidence: string[];
  suggestedActions: Array<{
    type: string;
    target: string;
    riskLevel: 'low' | 'medium' | 'high';
  }>;
}

interface HypothesisPanelProps {
  hypotheses: HypothesisItem[];
  selectedHypothesis?: string;
  isGenerating?: boolean;
}

const RISK_COLORS = {
  low: 'text-green-400 bg-green-400/10',
  medium: 'text-yellow-400 bg-yellow-400/10',
  high: 'text-red-400 bg-red-400/10',
};

export function HypothesisPanel({ hypotheses, selectedHypothesis, isGenerating }: HypothesisPanelProps) {
  if (hypotheses.length === 0 && !isGenerating) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-gray-300">AI Hypotheses</span>
        {isGenerating && (
          <span className="flex items-center gap-1 text-purple-400">
            <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Thinking...
          </span>
        )}
      </div>

      <div className="space-y-2">
        {hypotheses.map((hypothesis, index) => {
          const isSelected = hypothesis.id === selectedHypothesis;
          const isTop = index === 0;

          return (
            <div
              key={hypothesis.id}
              className={`rounded-lg border p-3 transition-all ${
                isSelected
                  ? 'border-purple-500/50 bg-purple-500/10'
                  : isTop
                    ? 'border-yellow-500/30 bg-yellow-500/5'
                    : 'border-gray-800 bg-gray-800/30'
              }`}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  {isTop && !isSelected && (
                    <span className="rounded bg-yellow-500/20 px-1.5 py-0.5 text-xs text-yellow-400">
                      Top
                    </span>
                  )}
                  {isSelected && (
                    <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-xs text-purple-400">
                      Selected
                    </span>
                  )}
                  <span className="text-sm font-medium text-gray-200">
                    {hypothesis.rootCause}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="h-1.5 w-12 overflow-hidden rounded-full bg-gray-700">
                    <div
                      className={`h-full transition-all ${
                        hypothesis.confidence >= 0.8
                          ? 'bg-green-500'
                          : hypothesis.confidence >= 0.5
                            ? 'bg-yellow-500'
                            : 'bg-red-500'
                      }`}
                      style={{ width: `${hypothesis.confidence * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500">
                    {Math.round(hypothesis.confidence * 100)}%
                  </span>
                </div>
              </div>

              {/* Supporting Evidence */}
              {hypothesis.supportingEvidence?.length > 0 && (
                <div className="mt-2">
                  <span className="text-xs text-gray-500">Supporting evidence:</span>
                  <ul className="mt-1 space-y-0.5">
                    {hypothesis.supportingEvidence.slice(0, 3).map((ev, i) => (
                      <li key={i} className="text-xs text-gray-400 truncate">
                        - {ev}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Suggested Actions */}
              {hypothesis.suggestedActions?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {hypothesis.suggestedActions.map((action, i) => (
                    <span
                      key={i}
                      className={`rounded px-1.5 py-0.5 text-xs ${RISK_COLORS[action.riskLevel]}`}
                    >
                      {action.type}: {action.target}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {isGenerating && hypotheses.length === 0 && (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-gray-800 bg-gray-800/30 p-4">
            <div className="relative">
              <div className="h-6 w-6 rounded-full border-2 border-purple-500/30 border-t-purple-500 animate-spin" />
            </div>
            <span className="text-sm text-gray-400">
              Deep reasoning in progress...
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

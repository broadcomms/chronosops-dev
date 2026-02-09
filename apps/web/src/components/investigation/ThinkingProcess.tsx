/**
 * ThinkingProcess - Visualize AI reasoning and thought states
 * Shows Gemini's thinking process with token usage
 * Falls back to timeline events when thought states aren't available
 */
import { memo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Brain, Circle, Key } from 'lucide-react';
import type { ThoughtState, OODAState, TimelineEvent } from '../../types';

interface ThinkingProcessProps {
  thoughts: ThoughtState[];
  currentPhase: OODAState;
  className?: string;
  timeline?: TimelineEvent[];
}

const phaseColors: Record<OODAState, string> = {
  IDLE: 'text-gray-400',
  OBSERVING: 'text-observe',
  ORIENTING: 'text-orient',
  DECIDING: 'text-decide',
  ACTING: 'text-act',
  VERIFYING: 'text-blue-400',
  DONE: 'text-green-400',
  FAILED: 'text-red-400',
};

const phaseBgColors: Record<OODAState, string> = {
  IDLE: 'bg-gray-500/10 border-gray-500/30',
  OBSERVING: 'bg-observe/10 border-observe/30',
  ORIENTING: 'bg-orient/10 border-orient/30',
  DECIDING: 'bg-decide/10 border-decide/30',
  ACTING: 'bg-act/10 border-act/30',
  VERIFYING: 'bg-blue-500/10 border-blue-500/30',
  DONE: 'bg-green-500/10 border-green-500/30',
  FAILED: 'bg-red-500/10 border-red-500/30',
};

export const ThinkingProcess = memo(function ThinkingProcess({
  thoughts,
  currentPhase,
  className = '',
  timeline = [],
}: ThinkingProcessProps) {
  // Sort thoughts by creation time (most recent first)
  const sortedThoughts = [...thoughts].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // Get the latest thought for the current phase
  const currentThought = sortedThoughts.find((t) => t.phase === currentPhase);

  // Calculate total tokens used
  const totalTokens = sortedThoughts.reduce(
    (sum, t) => sum + (t.tokensUsed || 0),
    0
  );

  // Fall back to timeline events when thoughts are empty
  if (sortedThoughts.length === 0) {
    // Filter timeline for meaningful AI activity events (most recent first)
    const aiEvents = timeline.filter(e =>
      ['evidence', 'hypothesis', 'verification', 'action'].includes(e.type) ||
      (e.type === 'phase_change' && e.description)
    ).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (aiEvents.length === 0) {
      return (
        <div className={`bg-gray-800/50 border border-gray-700 rounded-lg p-4 ${className}`}>
          <h3 className="text-sm font-medium text-gray-300 mb-4">AI Reasoning</h3>
          <div className="text-center py-8">
            <Brain size={48} className="mx-auto mb-3 opacity-50 text-gray-500" />
            <p className="text-gray-500 text-sm">Waiting for AI analysis...</p>
            <p className="text-gray-600 text-xs mt-1">
              Thought process will appear here
            </p>
          </div>
        </div>
      );
    }

    // Show timeline-based activity
    return (
      <div className={`bg-gray-800/50 border border-gray-700 rounded-lg p-4 ${className}`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-gray-300">AI Reasoning</h3>
          <span className="text-xs text-gray-500">
            {aiEvents.length} activities
          </span>
        </div>

        {/* Current phase indicator */}
        {currentPhase !== 'IDLE' && currentPhase !== 'DONE' && currentPhase !== 'FAILED' && (
          <div className={`mb-4 p-3 rounded-lg border ${phaseBgColors[currentPhase]}`}>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              <span className={`text-sm font-medium ${phaseColors[currentPhase]}`}>
                Currently: {currentPhase}
              </span>
            </div>
          </div>
        )}

        <div className="space-y-3 max-h-60 overflow-y-auto">
          {aiEvents.map((event) => (
            <div
              key={event.id}
              className={`p-3 rounded-lg border ${phaseBgColors[event.phase as OODAState] || 'bg-gray-700/50 border-gray-600'}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-medium ${phaseColors[event.phase as OODAState] || 'text-gray-400'}`}>
                  {event.phase || event.type.toUpperCase()}
                </span>
                <span className="text-xs text-gray-500">
                  {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                </span>
              </div>
              <p className="text-sm text-gray-300">{event.title}</p>
              {event.description && (
                <p className="text-xs text-gray-400 mt-1 line-clamp-2">{event.description}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-gray-800/50 border border-gray-700 rounded-lg p-4 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-300">AI Reasoning</h3>
        <span className="text-xs text-gray-500">
          {totalTokens.toLocaleString()} tokens used
        </span>
      </div>

      {/* Current thinking indicator */}
      {currentThought && (
        <div
          className={`mb-4 p-3 rounded-lg border ${phaseBgColors[currentPhase]}`}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
            <span className={`text-sm font-medium ${phaseColors[currentPhase]}`}>
              Currently: {currentPhase}
            </span>
          </div>
          {currentThought.summary && (
            <p className="text-sm text-gray-300">{currentThought.summary}</p>
          )}
          {currentThought.tokensUsed && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all"
                  style={{
                    width: `${Math.min(
                      100,
                      (currentThought.tokensUsed / currentThought.thinkingBudget) * 100
                    )}%`,
                  }}
                />
              </div>
              <span className="text-xs text-gray-500">
                {currentThought.tokensUsed} / {currentThought.thinkingBudget}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Thought history */}
      <div className="space-y-3 max-h-80 overflow-y-auto">
        {sortedThoughts.map((thought) => (
          <div
            key={thought.id}
            className={`p-3 rounded-lg border ${phaseBgColors[thought.phase]}`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs font-medium ${phaseColors[thought.phase]}`}>
                {thought.phase}
              </span>
              {thought.tokensUsed && (
                <span className="text-xs text-gray-500">
                  {thought.tokensUsed.toLocaleString()} tokens
                </span>
              )}
            </div>

            {thought.summary && (
              <p className="text-sm text-gray-300 mb-2">{thought.summary}</p>
            )}

            {/* Insights */}
            {thought.insights && thought.insights.length > 0 && (
              <div className="space-y-1">
                {thought.insights.map((insight, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2 text-xs text-gray-400"
                  >
                    <Circle size={6} className="text-blue-400 mt-1.5" />
                    <span>{insight}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Signature indicator */}
            {thought.signatureHash && (
              <div className="mt-2 flex items-center gap-1 text-xs text-gray-600">
                <Key size={12} />
                <span>Thought signature: {thought.signatureHash.slice(0, 8)}...</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});

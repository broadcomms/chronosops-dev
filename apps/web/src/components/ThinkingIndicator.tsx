/**
 * Thinking Indicator
 * Shows animated indicator when Gemini AI is reasoning
 */

interface ThinkingIndicatorProps {
  phase: string;
  isActive: boolean;
}

const PHASE_DESCRIPTIONS: Record<string, { action: string; detail: string }> = {
  OBSERVING: {
    action: 'Analyzing dashboard...',
    detail: 'Gemini Vision is examining screenshots for anomalies',
  },
  ORIENTING: {
    action: 'Correlating evidence...',
    detail: 'Processing logs, metrics, and visual data',
  },
  DECIDING: {
    action: 'Generating hypotheses...',
    detail: 'Using thinking budgets for deep reasoning',
  },
  ACTING: {
    action: 'Executing remediation...',
    detail: 'Running Kubernetes actions',
  },
  VERIFYING: {
    action: 'Verifying fix...',
    detail: 'Re-analyzing dashboard to confirm resolution',
  },
};

export function ThinkingIndicator({ phase, isActive }: ThinkingIndicatorProps) {
  if (!isActive) return null;

  const phaseInfo = PHASE_DESCRIPTIONS[phase] ?? {
    action: 'Processing...',
    detail: 'AI is working',
  };

  return (
    <div className="flex items-start gap-3 rounded-lg border border-purple-500/30 bg-purple-500/10 p-3">
      {/* Animated brain/thinking icon */}
      <div className="relative flex-shrink-0">
        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 p-1.5">
          <svg
            className="h-full w-full text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
          </svg>
        </div>
        {/* Pulsing ring */}
        <div className="absolute inset-0 animate-ping rounded-full bg-purple-500/40" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-purple-300">{phaseInfo.action}</span>
          <span className="flex gap-0.5">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-purple-400" style={{ animationDelay: '0ms' }} />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-purple-400" style={{ animationDelay: '150ms' }} />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-purple-400" style={{ animationDelay: '300ms' }} />
          </span>
        </div>
        <p className="mt-0.5 text-sm text-purple-400/70">{phaseInfo.detail}</p>
      </div>
    </div>
  );
}

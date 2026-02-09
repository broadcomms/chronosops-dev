/**
 * Evidence Panel
 * Displays evidence collection in real-time during investigation
 */

export interface EvidenceItem {
  id: string;
  type: 'log' | 'metric' | 'frame_analysis' | 'deployment' | 'timeline' | 'correlation';
  source: string;
  confidence: number;
  summary: string;
  timestamp: string;
}

interface EvidencePanelProps {
  evidence: EvidenceItem[];
  isLoading?: boolean;
}

const TYPE_ICONS: Record<string, { icon: JSX.Element; color: string }> = {
  log: {
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    color: 'text-blue-400 bg-blue-400/10',
  },
  metric: {
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
    color: 'text-green-400 bg-green-400/10',
  },
  frame_analysis: {
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    ),
    color: 'text-purple-400 bg-purple-400/10',
  },
  deployment: {
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
      </svg>
    ),
    color: 'text-orange-400 bg-orange-400/10',
  },
  timeline: {
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    color: 'text-cyan-400 bg-cyan-400/10',
  },
  correlation: {
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
    ),
    color: 'text-pink-400 bg-pink-400/10',
  },
};

export function EvidencePanel({ evidence, isLoading }: EvidencePanelProps) {
  if (evidence.length === 0 && !isLoading) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-800/30 p-4 text-center text-sm text-gray-500">
        No evidence collected yet
      </div>
    );
  }

  return (
    <div className="space-y-2" data-evidence-panel>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-gray-300">Evidence Collected</span>
        <span className="text-gray-500">{evidence.length} items</span>
      </div>

      <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-gray-800 bg-gray-800/30 p-2">
        {evidence.map((item, index) => {
          const typeInfo = TYPE_ICONS[item.type] ?? TYPE_ICONS.log;
          const isNew = index === 0;

          return (
            <div
              key={item.id}
              className={`flex items-start gap-2 rounded p-2 transition-all ${
                isNew ? 'animate-pulse bg-gray-700/50' : 'bg-gray-800/50'
              }`}
            >
              <div className={`rounded p-1 ${typeInfo.color}`}>
                {typeInfo.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-200 truncate">
                    {item.summary}
                  </span>
                  <span className="flex-shrink-0 text-xs text-gray-500">
                    {Math.round(item.confidence * 100)}%
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span>{item.source}</span>
                  <span>|</span>
                  <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
                </div>
              </div>
            </div>
          );
        })}

        {isLoading && (
          <div className="flex items-center gap-2 p-2 text-sm text-gray-500">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-500 border-t-transparent" />
            <span>Collecting more evidence...</span>
          </div>
        )}
      </div>
    </div>
  );
}

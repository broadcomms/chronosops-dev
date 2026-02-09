/**
 * Postmortem Preview
 * Shows a preview of the auto-generated postmortem after investigation completes
 */

export interface PostmortemData {
  summary: string;
  rootCauseAnalysis: string;
  timeline: Array<{
    timestamp: string;
    event: string;
    phase: string;
  }>;
  actionsTaken: Array<{
    action: string;
    result: string;
    duration: number;
  }>;
  lessonsLearned: string[];
  preventionRecommendations: string[];
}

interface PostmortemPreviewProps {
  postmortem: PostmortemData | null;
  isGenerating?: boolean;
}

export function PostmortemPreview({ postmortem, isGenerating }: PostmortemPreviewProps) {
  if (isGenerating) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-800/30 p-4">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-500 border-t-purple-500" />
          <span className="text-sm text-gray-400">Generating postmortem report...</span>
        </div>
      </div>
    );
  }

  if (!postmortem) {
    return null;
  }

  return (
    <div className="space-y-4 rounded-lg border border-gray-800 bg-gray-800/30 p-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-700 pb-3">
        <div className="flex items-center gap-2">
          <svg className="h-5 w-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span className="font-medium text-gray-200">Postmortem Report</span>
        </div>
        <span className="text-xs text-gray-500">Auto-generated</span>
      </div>

      {/* Summary */}
      <div>
        <h4 className="text-sm font-medium text-gray-300">Summary</h4>
        <p className="mt-1 text-sm text-gray-400">{postmortem.summary}</p>
      </div>

      {/* Root Cause */}
      <div>
        <h4 className="text-sm font-medium text-gray-300">Root Cause Analysis</h4>
        <p className="mt-1 text-sm text-gray-400">{postmortem.rootCauseAnalysis}</p>
      </div>

      {/* Timeline */}
      {postmortem.timeline?.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-2">Timeline</h4>
          <div className="space-y-1">
            {postmortem.timeline.slice(0, 5).map((event, index) => (
              <div key={index} className="flex items-start gap-2 text-xs">
                <span className="flex-shrink-0 text-gray-500 w-16">
                  {new Date(event.timestamp).toLocaleTimeString()}
                </span>
                <span className="text-gray-400">{event.event}</span>
              </div>
            ))}
            {postmortem.timeline?.length > 5 && (
              <span className="text-xs text-gray-500">
                +{postmortem.timeline.length - 5} more events
              </span>
            )}
          </div>
        </div>
      )}

      {/* Actions Taken */}
      {postmortem.actionsTaken?.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-2">Actions Taken</h4>
          <div className="space-y-2">
            {postmortem.actionsTaken.map((action, index) => (
              <div key={index} className="rounded bg-gray-700/50 p-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-200">{action.action}</span>
                  <span className="text-xs text-gray-500">
                    {(action.duration / 1000).toFixed(1)}s
                  </span>
                </div>
                <span className="text-xs text-green-400">{action.result}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lessons Learned */}
      {postmortem.lessonsLearned?.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-2">Lessons Learned</h4>
          <ul className="space-y-1">
            {postmortem.lessonsLearned.map((lesson, index) => (
              <li key={index} className="flex items-start gap-2 text-xs text-gray-400">
                <span className="text-yellow-400">-</span>
                {lesson}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Prevention */}
      {postmortem.preventionRecommendations?.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-2">Prevention Recommendations</h4>
          <ul className="space-y-1">
            {postmortem.preventionRecommendations.map((rec, index) => (
              <li key={index} className="flex items-start gap-2 text-xs text-gray-400">
                <span className="text-blue-400">-</span>
                {rec}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

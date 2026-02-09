/**
 * Action Log
 * Displays executed remediation actions during the ACTING phase
 */

export interface ActionItem {
  id: string;
  type: 'rollback' | 'restart' | 'scale';
  target: string;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  result?: string;
  duration?: number;
  timestamp: string;
}

interface ActionLogProps {
  actions: ActionItem[];
  isExecuting?: boolean;
}

const ACTION_ICONS: Record<string, JSX.Element> = {
  rollback: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
    </svg>
  ),
  restart: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  ),
  scale: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
    </svg>
  ),
};

const STATUS_STYLES = {
  pending: 'bg-gray-500/20 text-gray-400',
  executing: 'bg-yellow-500/20 text-yellow-400 animate-pulse',
  completed: 'bg-green-500/20 text-green-400',
  failed: 'bg-red-500/20 text-red-400',
};

export function ActionLog({ actions, isExecuting }: ActionLogProps) {
  if (actions.length === 0 && !isExecuting) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-gray-300">Remediation Actions</span>
        {isExecuting && (
          <span className="flex items-center gap-1 text-yellow-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-yellow-400" />
            Executing...
          </span>
        )}
      </div>

      <div className="space-y-2">
        {actions.map((action) => (
          <div
            key={action.id}
            className={`flex items-start gap-3 rounded-lg border p-3 transition-all ${
              action.status === 'executing'
                ? 'border-yellow-500/30 bg-yellow-500/5'
                : action.status === 'completed'
                  ? 'border-green-500/30 bg-green-500/5'
                  : action.status === 'failed'
                    ? 'border-red-500/30 bg-red-500/5'
                    : 'border-gray-800 bg-gray-800/30'
            }`}
          >
            {/* Icon */}
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-lg ${STATUS_STYLES[action.status]}`}
            >
              {ACTION_ICONS[action.type] ?? ACTION_ICONS.restart}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-200 capitalize">
                  {action.type}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-xs ${STATUS_STYLES[action.status]}`}
                >
                  {action.status}
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">{action.target}</p>

              {action.result && (
                <p className={`text-xs mt-1 ${
                  action.status === 'completed' ? 'text-green-400' : 'text-red-400'
                }`}>
                  {action.result}
                </p>
              )}

              <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                <span>{new Date(action.timestamp).toLocaleTimeString()}</span>
                {action.duration && (
                  <>
                    <span>|</span>
                    <span>{(action.duration / 1000).toFixed(1)}s</span>
                  </>
                )}
              </div>
            </div>

            {/* Spinner for executing */}
            {action.status === 'executing' && (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-yellow-500/30 border-t-yellow-500" />
            )}
          </div>
        ))}

        {isExecuting && actions.every((a) => a.status !== 'executing') && (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-gray-800 bg-gray-800/30 p-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-500/30 border-t-gray-500" />
            <span className="text-sm text-gray-400">Preparing action...</span>
          </div>
        )}
      </div>
    </div>
  );
}

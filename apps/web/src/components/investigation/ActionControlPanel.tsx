/**
 * ActionControlPanel - Remediation action controls
 * Shows action status, progress, and allows manual intervention
 */
import { memo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  RotateCcw,
  RefreshCw,
  TrendingUp,
  Wrench,
  Server,
  Bot,
  Activity,
  Zap,
  Shield,
  ChevronUp,
  ChevronDown,
  Code2,
  type LucideIcon,
} from 'lucide-react';
import type { Action, ActionType, ActionStatus } from '../../types';

type ExecutionMode = 'kubernetes' | 'simulated' | 'auto';

interface ActionControlPanelProps {
  actions: Action[];
  className?: string;
  onExecuteAction?: (actionId: string) => void;
  onCancelAction?: (actionId: string) => void;
  dryRunMode?: boolean;
  executionMode?: ExecutionMode;
}

const actionTypeConfig: Record<ActionType, { label: string; icon: LucideIcon }> = {
  rollback: { label: 'Rollback', icon: RotateCcw },
  restart: { label: 'Restart', icon: RefreshCw },
  scale: { label: 'Scale', icon: TrendingUp },
  code_fix: { label: 'Code Fix', icon: Code2 },
  manual: { label: 'Manual', icon: Wrench },
};

const statusColors: Record<ActionStatus, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-gray-500/10', text: 'text-gray-400', label: 'Pending' },
  executing: { bg: 'bg-blue-500/10', text: 'text-blue-400', label: 'Executing' },
  completed: { bg: 'bg-green-500/10', text: 'text-green-400', label: 'Completed' },
  failed: { bg: 'bg-red-500/10', text: 'text-red-400', label: 'Failed' },
};

const executionModeConfig: Record<ExecutionMode, { label: string; color: string; icon: LucideIcon }> = {
  kubernetes: { label: 'Kubernetes', color: 'text-blue-400 bg-blue-500/10 border-blue-500/30', icon: Server },
  simulated: { label: 'Simulated', color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30', icon: Bot },
  auto: { label: 'Auto-detect', color: 'text-purple-400 bg-purple-500/10 border-purple-500/30', icon: Activity },
};

export const ActionControlPanel = memo(function ActionControlPanel({
  actions,
  className = '',
  onExecuteAction,
  onCancelAction,
  dryRunMode = false,
  executionMode = 'simulated',
}: ActionControlPanelProps) {
  const [expandedActionId, setExpandedActionId] = useState<string | null>(null);

  // Sort actions by created time (most recent first)
  const sortedActions = [...actions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // Get currently executing action
  const executingAction = sortedActions.find((a) => a.status === 'executing');

  if (actions.length === 0) {
    return (
      <div className={`bg-gray-800/50 border border-gray-700 rounded-lg p-4 ${className}`}>
        <h3 className="text-sm font-medium text-gray-300 mb-4">Remediation Actions</h3>
        <div className="text-center py-8">
          <div className="mb-3 opacity-50">
            <Zap size={48} className="mx-auto text-gray-500" />
          </div>
          <p className="text-gray-500 text-sm">No actions planned yet</p>
          <p className="text-gray-600 text-xs mt-1">
            Actions will be suggested during the Decide phase
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-gray-800/50 border border-gray-700 rounded-lg p-4 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-300">Remediation Actions</h3>
        <div className="flex items-center gap-2">
          {/* Execution Mode Indicator */}
          {(() => {
            const modeConfig = executionModeConfig[executionMode];
            const ModeIcon = modeConfig.icon;
            return (
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium border flex items-center gap-1 ${modeConfig.color}`}
              >
                <ModeIcon size={12} />
                {modeConfig.label}
              </span>
            );
          })()}
          {dryRunMode && (
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-orange-500/10 text-orange-400 border border-orange-500/30">
              Dry Run
            </span>
          )}
        </div>
      </div>

      {/* Currently executing action */}
      {executingAction && (
        <div className="mb-4 p-4 rounded-lg bg-blue-500/10 border border-blue-500/30">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              <span className="text-sm font-medium text-blue-400">Executing Action</span>
            </div>
            {onCancelAction && (
              <button
                onClick={() => onCancelAction(executingAction.id)}
                className="text-xs text-red-400 hover:text-red-300 transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 mb-2">
            {(() => {
              const typeConfig = actionTypeConfig[executingAction.type];
              const TypeIcon = typeConfig.icon;
              return (
                <>
                  <TypeIcon size={20} className="text-blue-400" />
                  <span className="text-white font-medium">{typeConfig.label}</span>
                </>
              );
            })()}
            <span className="text-gray-400">on</span>
            <code className="text-sm text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded">
              {executingAction.target}
            </code>
          </div>
          {/* Progress bar */}
          <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full animate-pulse w-2/3" />
          </div>
        </div>
      )}

      {/* Action list */}
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {sortedActions.map((action) => {
          const isExpanded = expandedActionId === action.id;
          const colors = statusColors[action.status];
          const typeConfig = actionTypeConfig[action.type];
          const TypeIcon = typeConfig.icon;

          return (
            <div
              key={action.id}
              className={`rounded-lg border transition-all ${
                action.status === 'executing'
                  ? 'bg-blue-500/5 border-blue-500/30'
                  : 'bg-gray-900/50 border-gray-700/50'
              }`}
            >
              {/* Action header */}
              <div
                className="p-3 cursor-pointer"
                onClick={() => setExpandedActionId(isExpanded ? null : action.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <TypeIcon size={18} className="text-gray-400" />
                    <span className="text-sm text-gray-200">{typeConfig.label}</span>
                    <code className="text-xs text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
                      {action.target}
                    </code>
                  </div>
                  <div className="flex items-center gap-2">
                    {action.dryRun && (
                      <span className="text-xs text-yellow-500">DRY RUN</span>
                    )}
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${colors.bg} ${colors.text}`}
                    >
                      {colors.label}
                    </span>
                    {isExpanded ? (
                      <ChevronUp size={14} className="text-gray-500" />
                    ) : (
                      <ChevronDown size={14} className="text-gray-500" />
                    )}
                  </div>
                </div>
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div className="px-3 pb-3 border-t border-gray-700/50">
                  <div className="pt-3 space-y-2">
                    {/* Parameters */}
                    {Object.keys(action.parameters).length > 0 && (
                      <div>
                        <span className="text-xs text-gray-500">Parameters:</span>
                        <pre className="mt-1 text-xs text-gray-400 bg-gray-800 p-2 rounded overflow-x-auto">
                          {JSON.stringify(action.parameters, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* Result */}
                    {action.result && (
                      <div>
                        <span className="text-xs text-gray-500">Result:</span>
                        <p className="mt-1 text-sm text-gray-300">{action.result}</p>
                      </div>
                    )}

                    {/* Timestamps */}
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span>
                        Created:{' '}
                        {formatDistanceToNow(new Date(action.createdAt), {
                          addSuffix: true,
                        })}
                      </span>
                      {action.executedAt && (
                        <span>
                          Executed:{' '}
                          {formatDistanceToNow(new Date(action.executedAt), {
                            addSuffix: true,
                          })}
                        </span>
                      )}
                      {action.completedAt && (
                        <span>
                          Completed:{' '}
                          {formatDistanceToNow(new Date(action.completedAt), {
                            addSuffix: true,
                          })}
                        </span>
                      )}
                    </div>

                    {/* Manual execute button for pending actions */}
                    {action.status === 'pending' && onExecuteAction && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onExecuteAction(action.id);
                        }}
                        className="mt-2 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                      >
                        Execute Now
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Safety Controls Panel */}
      <div className="mt-4 pt-3 border-t border-gray-700">
        <div className="flex items-center gap-2 mb-2">
          <Shield size={14} className="text-green-400" />
          <span className="text-xs font-medium text-gray-400">Safety Controls Active</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-1.5 text-gray-500">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
            <span>Action cooldowns</span>
          </div>
          <div className="flex items-center gap-1.5 text-gray-500">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
            <span>Rate limiting</span>
          </div>
          <div className="flex items-center gap-1.5 text-gray-500">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
            <span>Audit logging</span>
          </div>
          <div className="flex items-center gap-1.5 text-gray-500">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
            <span>Namespace scoping</span>
          </div>
        </div>
      </div>
    </div>
  );
});

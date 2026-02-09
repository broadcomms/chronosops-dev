/**
 * Code Evolution Link
 * Shows when a code evolution was triggered by an incident investigation
 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Code2, ExternalLink, CheckCircle, AlertCircle, Clock, Loader2 } from 'lucide-react';
import { evolutionsApi } from '../../api/evolutions';
import { config } from '../../config/env';
import type { Action } from '../../types';

interface CodeEvolutionLinkProps {
  incidentId: string;
  actions: Action[];
  className?: string;
}

export function CodeEvolutionLink({ actions, className = '' }: CodeEvolutionLinkProps) {
  // Find code_fix actions
  const codeFixActions = actions.filter(a => a.type === 'code_fix');

  if (codeFixActions.length === 0) {
    return null;
  }

  // Get evolution IDs from actions
  const evolutionIds = codeFixActions
    .map(a => a.parameters?.evolutionId as string)
    .filter(Boolean);

  if (evolutionIds.length === 0) {
    return null;
  }

  return (
    <div className={`bg-purple-500/10 border border-purple-500/30 rounded-lg p-4 ${className}`}>
      <div className="flex items-center gap-2 mb-3">
        <Code2 size={18} className="text-purple-400" />
        <h3 className="font-medium text-purple-300">Code Evolution Triggered</h3>
      </div>

      <p className="text-sm text-gray-400 mb-3">
        The investigation triggered AI-powered code evolution to fix the root cause.
      </p>

      <div className="space-y-2">
        {evolutionIds.map(evolutionId => {
          const action = codeFixActions.find(a => a.parameters?.evolutionId === evolutionId);
          if (!action) return null;
          return (
            <EvolutionStatusCard
              key={evolutionId}
              evolutionId={evolutionId}
              action={action}
            />
          );
        })}
      </div>
    </div>
  );
}

interface EvolutionStatusCardProps {
  evolutionId: string;
  action: Action;
}

function EvolutionStatusCard({ evolutionId, action }: EvolutionStatusCardProps) {
  const developmentCycleId = action.parameters?.developmentCycleId as string;

  // Fetch evolution details (optional - for enhanced display)
  const { data: evolutionData } = useQuery({
    queryKey: ['evolution', developmentCycleId, evolutionId],
    queryFn: () => developmentCycleId ? evolutionsApi.get(developmentCycleId, evolutionId) : null,
    enabled: !!developmentCycleId && !!evolutionId,
    refetchInterval: config.polling.incidentRefresh,
  });

  const evolution = evolutionData?.data;

  const statusConfig: Record<string, { icon: React.ReactNode; text: string; color: string }> = {
    pending: {
      icon: <Clock size={14} />,
      text: 'Pending',
      color: 'text-gray-400',
    },
    analyzing: {
      icon: <Loader2 size={14} className="animate-spin" />,
      text: 'Analyzing code...',
      color: 'text-blue-400',
    },
    generating: {
      icon: <Loader2 size={14} className="animate-spin" />,
      text: 'Generating fix...',
      color: 'text-purple-400',
    },
    review: {
      icon: <Clock size={14} />,
      text: 'Awaiting review',
      color: 'text-yellow-400',
    },
    approved: {
      icon: <CheckCircle size={14} />,
      text: 'Approved',
      color: 'text-green-400',
    },
    applied: {
      icon: <CheckCircle size={14} />,
      text: 'Fix applied',
      color: 'text-green-400',
    },
    rejected: {
      icon: <AlertCircle size={14} />,
      text: 'Rejected',
      color: 'text-red-400',
    },
    failed: {
      icon: <AlertCircle size={14} />,
      text: 'Failed',
      color: 'text-red-400',
    },
    reverted: {
      icon: <AlertCircle size={14} />,
      text: 'Reverted',
      color: 'text-orange-400',
    },
  };

  const status = evolution?.status ?? 'pending';
  const statusDisplay = statusConfig[status] ?? statusConfig.pending;

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 ${statusDisplay.color}`}>
            {statusDisplay.icon}
            <span className="text-sm font-medium">{statusDisplay.text}</span>
          </div>

          {typeof evolution?.filesAffected === 'number' && evolution.filesAffected > 0 && (
            <span className="text-xs text-gray-500">
              {evolution.filesAffected} file{evolution.filesAffected !== 1 ? 's' : ''} affected
            </span>
          )}
        </div>

        {developmentCycleId && (
          <Link
            to={`/development/${developmentCycleId}/evolutions/${evolutionId}`}
            className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300"
          >
            View Evolution
            <ExternalLink size={12} />
          </Link>
        )}
      </div>

      {/* Fix description */}
      {typeof action.parameters?.fixDescription === 'string' && action.parameters.fixDescription && (
        <p className="text-xs text-gray-500 mt-2 line-clamp-2">
          {action.parameters.fixDescription.substring(0, 150)}
          {action.parameters.fixDescription.length > 150 ? '...' : ''}
        </p>
      )}

      {/* Result message */}
      {action.result && (
        <div className="mt-2 text-xs text-gray-400 bg-gray-900/50 rounded px-2 py-1">
          {action.result}
        </div>
      )}
    </div>
  );
}

/**
 * ActiveIncidentBanner - Alert banner for active incidents
 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { incidentsApi } from '../../api/incidents';
import type { OODAState } from '../../types';

const phaseLabels: Record<OODAState, string> = {
  IDLE: 'Idle',
  OBSERVING: 'Observing',
  ORIENTING: 'Orienting',
  DECIDING: 'Deciding',
  ACTING: 'Acting',
  VERIFYING: 'Verifying',
  DONE: 'Done',
  FAILED: 'Failed',
};

interface ActiveIncidentBannerProps {
  className?: string;
}

export function ActiveIncidentBanner({ className = '' }: ActiveIncidentBannerProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['incidents', 'active'],
    queryFn: () => incidentsApi.list({ status: 'investigating' }),
    refetchInterval: 5000,
  });

  const activeIncidents = data?.data || [];

  if (isLoading) {
    return null; // Don't show loading state for banner
  }

  if (activeIncidents.length === 0) {
    return null;
  }

  // Show the most recent/critical incident
  const primaryIncident = activeIncidents.sort((a, b) => {
    // Sort by severity first (critical > high > medium > low)
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (severityDiff !== 0) return severityDiff;
    // Then by start time (most recent first)
    return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
  })[0];

  const severityStyles = {
    critical: 'bg-red-500/20 border-red-500/50 text-red-400',
    high: 'bg-orange-500/20 border-orange-500/50 text-orange-400',
    medium: 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400',
    low: 'bg-blue-500/20 border-blue-500/50 text-blue-400',
  };

  return (
    <div
      className={`border rounded-lg p-4 ${severityStyles[primaryIncident.severity]} ${className}`}
    >
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          {/* Pulsing indicator */}
          <div className="relative">
            <span className="absolute inline-flex h-4 w-4 animate-ping rounded-full bg-current opacity-50" />
            <span className="relative inline-flex h-4 w-4 rounded-full bg-current" />
          </div>

          {/* Incident info */}
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">{primaryIncident.title}</h3>
              <span className="text-xs uppercase px-1.5 py-0.5 rounded bg-current/20">
                {primaryIncident.severity}
              </span>
            </div>
            <p className="text-sm opacity-80 mt-0.5">
              {phaseLabels[primaryIncident.state]} &bull; {primaryIncident.namespace}
              {activeIncidents.length > 1 && (
                <span className="ml-2 opacity-70">
                  +{activeIncidents.length - 1} more
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Action */}
        <Link
          to={`/incidents/${primaryIncident.id}`}
          className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-medium transition-colors"
        >
          View Investigation
        </Link>
      </div>
    </div>
  );
}

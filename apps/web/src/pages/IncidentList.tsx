/**
 * Incident List - All incidents view with filtering
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { ChevronRight, AlertTriangle, Inbox } from 'lucide-react';
import { PageLayout, Section, Card } from '../components/layout/PageLayout';
import { incidentsApi } from '../api/incidents';
import { config } from '../config/env';
import type { Incident, IncidentSeverity, OODAState } from '../types';

function SeverityBadge({ severity }: { severity: IncidentSeverity }) {
  const colors: Record<IncidentSeverity, string> = {
    low: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    medium: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
    high: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
    critical: 'bg-red-500/10 text-red-400 border-red-500/30',
  };

  return (
    <span className={`px-2 py-0.5 text-xs rounded border ${colors[severity]}`}>
      {severity.toUpperCase()}
    </span>
  );
}

function StateBadge({ state }: { state: OODAState }) {
  const colors: Record<OODAState, string> = {
    IDLE: 'bg-gray-500/10 text-gray-400',
    OBSERVING: 'bg-observe/10 text-observe',
    ORIENTING: 'bg-orient/10 text-orient',
    DECIDING: 'bg-decide/10 text-decide',
    ACTING: 'bg-act/10 text-act',
    VERIFYING: 'bg-cyan-500/10 text-cyan-400',
    DONE: 'bg-green-500/10 text-green-400',
    FAILED: 'bg-red-500/10 text-red-400',
  };

  return (
    <span className={`px-2 py-0.5 text-xs rounded ${colors[state]}`}>
      {state}
    </span>
  );
}

function IncidentRow({ incident }: { incident: Incident }) {
  const isActive = !['DONE', 'FAILED', 'IDLE'].includes(incident.state);

  return (
    <Link
      to={`/incidents/${incident.id}`}
      className="block border-b border-gray-800 last:border-0 hover:bg-gray-800/50 transition-colors"
    >
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            {isActive && (
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse flex-shrink-0" />
            )}
            <h3 className="text-sm font-medium text-white truncate">{incident.title}</h3>
            <SeverityBadge severity={incident.severity} />
            <StateBadge state={incident.state} />
          </div>
          <div className="mt-1 flex items-center gap-4 text-xs text-gray-500">
            <span>
              <code className="text-purple-400">{incident.namespace}</code>
            </span>
            <span>
              Started {formatDistanceToNow(new Date(incident.startedAt), { addSuffix: true })}
            </span>
            {incident.resolvedAt && (
              <span className="text-green-400">
                Resolved {formatDistanceToNow(new Date(incident.resolvedAt), { addSuffix: true })}
              </span>
            )}
          </div>
        </div>
        <div className="ml-4 text-gray-500">
          <ChevronRight size={18} />
        </div>
      </div>
    </Link>
  );
}

type FilterStatus = 'all' | 'active' | 'resolved' | 'failed';

export function IncidentList() {
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [filterSeverity, setFilterSeverity] = useState<IncidentSeverity | 'all'>('all');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['incidents'],
    queryFn: () => incidentsApi.list(),
    refetchInterval: config.polling.incidentRefresh,
  });

  const allIncidents = data?.data ?? [];

  // Apply filters
  const incidents = allIncidents.filter((incident) => {
    // Status filter
    if (filterStatus === 'active') {
      if (['DONE', 'FAILED', 'IDLE'].includes(incident.state)) return false;
    } else if (filterStatus === 'resolved') {
      if (incident.state !== 'DONE') return false;
    } else if (filterStatus === 'failed') {
      if (incident.state !== 'FAILED') return false;
    }

    // Severity filter
    if (filterSeverity !== 'all' && incident.severity !== filterSeverity) {
      return false;
    }

    return true;
  });

  // Count by status
  const activeCount = allIncidents.filter(
    (i) => !['DONE', 'FAILED', 'IDLE'].includes(i.state)
  ).length;
  const resolvedCount = allIncidents.filter((i) => i.state === 'DONE').length;
  const failedCount = allIncidents.filter((i) => i.state === 'FAILED').length;

  return (
    <PageLayout title="Incidents">
      <Section>
        {/* Header with filters */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {/* Status filter */}
            <div className="flex bg-gray-800 rounded-lg p-1">
              {[
                { value: 'all', label: 'All', count: allIncidents.length },
                { value: 'active', label: 'Active', count: activeCount },
                { value: 'resolved', label: 'Resolved', count: resolvedCount },
                { value: 'failed', label: 'Failed', count: failedCount },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => setFilterStatus(option.value as FilterStatus)}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    filterStatus === option.value
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {option.label}
                  <span className="ml-1 opacity-70">({option.count})</span>
                </button>
              ))}
            </div>

            {/* Severity filter */}
            <select
              value={filterSeverity}
              onChange={(e) => setFilterSeverity(e.target.value as IncidentSeverity | 'all')}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-300"
            >
              <option value="all">All Severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              className="px-3 py-1.5 text-sm border border-gray-700 rounded-lg hover:bg-gray-800 transition-colors text-gray-400"
            >
              Refresh
            </button>
            <Link
              to="/"
              className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex items-center gap-1"
            >
              <AlertTriangle size={14} />
              Report Incident
            </Link>
          </div>
        </div>

        <Card padding="none">
          {isLoading && (
            <div className="py-12 text-center text-gray-500">
              <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
              <p>Loading incidents...</p>
            </div>
          )}

          {error && (
            <div className="py-12 text-center text-red-500">
              <AlertTriangle size={48} className="mx-auto mb-3 opacity-50" />
              <p>Failed to load incidents</p>
              <p className="text-sm text-gray-500 mt-2">
                {error instanceof Error ? error.message : 'Unknown error'}
              </p>
              <button
                onClick={() => refetch()}
                className="mt-4 px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {!isLoading && !error && incidents.length === 0 && (
            <div className="py-12 text-center text-gray-500">
              <Inbox size={48} className="mx-auto mb-4 opacity-50" />
              <p>No incidents found</p>
              <p className="text-sm text-gray-600 mt-2">
                {filterStatus !== 'all' || filterSeverity !== 'all'
                  ? 'Try adjusting your filters'
                  : 'Create an incident or wait for auto-detection'}
              </p>
            </div>
          )}

          {!isLoading && !error && incidents.length > 0 && (
            <div>
              {/* Table header */}
              <div className="px-4 py-2 border-b border-gray-700 bg-gray-800/50">
                <div className="flex items-center text-xs text-gray-500 font-medium">
                  <span className="flex-1">Incident</span>
                  <span className="w-32 text-right">Started</span>
                </div>
              </div>
              {incidents.map((incident) => (
                <IncidentRow key={incident.id} incident={incident} />
              ))}
            </div>
          )}
        </Card>
      </Section>
    </PageLayout>
  );
}

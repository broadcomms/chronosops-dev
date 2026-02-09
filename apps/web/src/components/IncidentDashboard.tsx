import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, useCallback } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { ThinkingIndicator } from './ThinkingIndicator';
import { EvidencePanel, type EvidenceItem } from './EvidencePanel';
import { HypothesisPanel, type HypothesisItem } from './HypothesisPanel';
import { ActionLog, type ActionItem } from './ActionLog';
import { PostmortemPreview, type PostmortemData } from './PostmortemPreview';
import { FailedIncidentPanel } from './investigation/FailedIncidentPanel';

interface Incident {
  id: string;
  title: string;
  description?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: string;
  state: string;
  namespace: string;
  startedAt: string;
  createdAt: string;
}

interface FailureDetails {
  phase: string;
  retryAttempts: number;
  lastAction?: ActionItem;
  lastVerificationResult?: {
    success: boolean;
    details: string;
  };
  timestamp: string;
}

interface InvestigationState {
  phase: string;
  evidence: EvidenceItem[];
  hypotheses: HypothesisItem[];
  actions: ActionItem[];
  postmortem: PostmortemData | null;
  isComplete: boolean;
  isFailed: boolean;
  failReason?: string;
  failureDetails?: FailureDetails;
  duration?: number;
}

async function fetchIncidents(): Promise<{ data: Incident[] }> {
  const response = await fetch('/api/v1/incidents');
  if (!response.ok) {
    throw new Error('Failed to fetch incidents');
  }
  return response.json();
}

const PHASE_COLORS: Record<string, string> = {
  IDLE: 'bg-gray-500',
  OBSERVING: 'bg-observe',
  ORIENTING: 'bg-orient',
  DECIDING: 'bg-decide',
  ACTING: 'bg-act',
  VERIFYING: 'bg-verify',
  DONE: 'bg-green-500',
  FAILED: 'bg-red-500',
};

const SEVERITY_COLORS: Record<string, string> = {
  low: 'text-blue-400 bg-blue-400/10',
  medium: 'text-yellow-400 bg-yellow-400/10',
  high: 'text-orange-400 bg-orange-400/10',
  critical: 'text-red-400 bg-red-400/10',
};

const ACTIVE_PHASES = ['OBSERVING', 'ORIENTING', 'DECIDING', 'ACTING', 'VERIFYING'];

export function IncidentDashboard() {
  const queryClient = useQueryClient();
  const { lastMessage, send } = useWebSocket();
  const [selectedIncident, setSelectedIncident] = useState<string | null>(null);
  const [investigations, setInvestigations] = useState<Map<string, InvestigationState>>(new Map());

  const { data, isLoading, error } = useQuery({
    queryKey: ['incidents'],
    queryFn: fetchIncidents,
    refetchInterval: 5000,
  });

  // Handle WebSocket messages
  useEffect(() => {
    if (!lastMessage) return;

    const { type, payload } = lastMessage as { type: string; payload?: Record<string, unknown> };

    if (type === 'phase:change' && payload) {
      const { incidentId, phase } = payload as { incidentId: string; phase: string };
      setInvestigations((prev) => {
        const next = new Map(prev);
        const current = next.get(incidentId) ?? createEmptyState();
        next.set(incidentId, { ...current, phase });
        return next;
      });
      // Refetch incidents to update state
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
    }

    if (type === 'incident:update' && payload) {
      const { incidentId, update } = payload as { incidentId: string; update: Record<string, unknown> };
      const updateType = update?.type as string;

      setInvestigations((prev) => {
        const next = new Map(prev);
        const current = next.get(incidentId) ?? createEmptyState();

        switch (updateType) {
          case 'evidence_collected': {
            const evidence = update.evidence as EvidenceItem;
            next.set(incidentId, {
              ...current,
              evidence: [evidence, ...current.evidence],
            });
            break;
          }
          case 'hypothesis_generated': {
            const hypothesis = update.hypothesis as HypothesisItem;
            next.set(incidentId, {
              ...current,
              hypotheses: [...current.hypotheses, hypothesis],
            });
            break;
          }
          case 'action_executed': {
            const action = update.action as ActionItem;
            const result = update.result as { success: boolean; message?: string };
            next.set(incidentId, {
              ...current,
              actions: [...current.actions, {
                ...action,
                status: result.success ? 'completed' : 'failed',
                result: result.message,
              }],
            });
            break;
          }
          case 'completed': {
            const result = update.result as { postmortem?: PostmortemData } | undefined;
            next.set(incidentId, {
              ...current,
              isComplete: true,
              duration: update.duration as number,
              postmortem: result?.postmortem ?? null,
            });
            queryClient.invalidateQueries({ queryKey: ['incidents'] });
            break;
          }
          case 'failed': {
            const failureDetails = update.failureDetails as FailureDetails | undefined;
            next.set(incidentId, {
              ...current,
              isFailed: true,
              failReason: update.reason as string,
              failureDetails: failureDetails ? {
                phase: failureDetails.phase,
                retryAttempts: failureDetails.retryAttempts,
                lastAction: failureDetails.lastAction,
                lastVerificationResult: failureDetails.lastVerificationResult,
                timestamp: failureDetails.timestamp,
              } : undefined,
            });
            queryClient.invalidateQueries({ queryKey: ['incidents'] });
            break;
          }
        }

        return next;
      });
    }
  }, [lastMessage, queryClient]);

  // Subscribe to incident channel when selected
  useEffect(() => {
    if (selectedIncident) {
      send({ type: 'subscribe', payload: { channel: `incident:${selectedIncident}` } });
    }
    return () => {
      if (selectedIncident) {
        send({ type: 'unsubscribe', payload: { channel: `incident:${selectedIncident}` } });
      }
    };
  }, [selectedIncident, send]);

  const startInvestigation = useCallback(async (incidentId: string) => {
    try {
      const response = await fetch(`/api/v1/incidents/${incidentId}/investigate`, {
        method: 'POST',
      });
      if (response.ok) {
        setInvestigations((prev) => {
          const next = new Map(prev);
          next.set(incidentId, createEmptyState());
          return next;
        });
        setSelectedIncident(incidentId);
        queryClient.invalidateQueries({ queryKey: ['incidents'] });
      }
    } catch (err) {
      // Error handled silently
    }
  }, [queryClient]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-observe border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-500/10 p-4 text-red-400">
        Failed to load incidents. Is the API server running?
      </div>
    );
  }

  const incidents = data?.data ?? [];

  if (incidents.length === 0) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-800/50 p-8 text-center">
        <h2 className="text-lg font-medium text-gray-300">No incidents</h2>
        <p className="mt-2 text-gray-500">
          When incidents are created, they will appear here.
        </p>
      </div>
    );
  }

  const selectedIncidentData = selectedIncident
    ? incidents.find((i) => i.id === selectedIncident)
    : null;
  const investigationState = selectedIncident
    ? investigations.get(selectedIncident)
    : null;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Incidents List */}
      <div className="lg:col-span-1 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Incidents</h2>
          <span className="text-sm text-gray-500">{incidents.length} total</span>
        </div>

        <div className="space-y-2">
          {incidents.map((incident) => (
            <IncidentCard
              key={incident.id}
              incident={incident}
              isSelected={selectedIncident === incident.id}
              investigationPhase={investigations.get(incident.id)?.phase}
              onSelect={() => setSelectedIncident(incident.id)}
              onInvestigate={() => startInvestigation(incident.id)}
            />
          ))}
        </div>
      </div>

      {/* Investigation Details */}
      <div className="lg:col-span-2 space-y-4">
        {selectedIncidentData ? (
          <>
            {/* Incident Header */}
            <div className="rounded-lg border border-gray-800 bg-gray-800/50 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-medium">{selectedIncidentData.title}</h3>
                  {selectedIncidentData.description && (
                    <p className="mt-1 text-sm text-gray-400">
                      {selectedIncidentData.description}
                    </p>
                  )}
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-xs font-medium ${SEVERITY_COLORS[selectedIncidentData.severity]}`}
                >
                  {selectedIncidentData.severity}
                </span>
              </div>

              {/* OODA Progress */}
              <div className="mt-4">
                <OODAProgress
                  currentState={investigationState?.phase ?? selectedIncidentData.state}
                />
              </div>
            </div>

            {/* Thinking Indicator */}
            {investigationState && ACTIVE_PHASES.includes(investigationState.phase) && (
              <ThinkingIndicator
                phase={investigationState.phase}
                isActive={!investigationState.isComplete && !investigationState.isFailed}
              />
            )}

            {/* Investigation Panels */}
            {investigationState && (
              <div className="grid gap-4 md:grid-cols-2">
                <EvidencePanel
                  evidence={investigationState.evidence}
                  isLoading={investigationState.phase === 'OBSERVING'}
                />
                <HypothesisPanel
                  hypotheses={investigationState.hypotheses}
                  isGenerating={investigationState.phase === 'DECIDING'}
                />
              </div>
            )}

            {/* Action Log */}
            {investigationState && investigationState.actions.length > 0 && (
              <ActionLog
                actions={investigationState.actions}
                isExecuting={investigationState.phase === 'ACTING'}
              />
            )}

            {/* Postmortem Preview */}
            {investigationState?.isComplete && (
              <PostmortemPreview
                postmortem={investigationState.postmortem}
                isGenerating={false}
              />
            )}

            {/* Failed State */}
            {investigationState?.isFailed && (
              <FailedIncidentPanel
                incidentId={selectedIncidentData.id}
                failReason={investigationState.failReason ?? 'Unknown error occurred'}
                failureDetails={investigationState.failureDetails}
                onRetryInvestigation={() => startInvestigation(selectedIncidentData.id)}
                onViewEvidence={() => {
                  // Scroll to evidence panel
                  document.querySelector('[data-evidence-panel]')?.scrollIntoView({ behavior: 'smooth' });
                }}
              />
            )}

            {/* Completion Summary */}
            {investigationState?.isComplete && (
              <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4">
                <div className="flex items-center gap-2 text-green-400">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="font-medium">Investigation Complete</span>
                </div>
                {investigationState.duration && (
                  <p className="mt-1 text-sm text-green-400/70">
                    Resolved in {(investigationState.duration / 1000).toFixed(1)} seconds
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="rounded-lg border border-gray-800 bg-gray-800/50 p-8 text-center">
            <svg className="mx-auto h-12 w-12 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <h3 className="mt-4 text-lg font-medium text-gray-300">
              Select an incident
            </h3>
            <p className="mt-2 text-sm text-gray-500">
              Choose an incident from the list to view details and start an investigation
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function createEmptyState(): InvestigationState {
  return {
    phase: 'OBSERVING',
    evidence: [],
    hypotheses: [],
    actions: [],
    postmortem: null,
    isComplete: false,
    isFailed: false,
  };
}

interface IncidentCardProps {
  incident: Incident;
  isSelected: boolean;
  investigationPhase?: string;
  onSelect: () => void;
  onInvestigate: () => void;
}

function IncidentCard({
  incident,
  isSelected,
  investigationPhase,
  onSelect,
  onInvestigate,
}: IncidentCardProps) {
  const isInvestigating = investigationPhase && ACTIVE_PHASES.includes(investigationPhase);

  return (
    <div
      className={`cursor-pointer rounded-lg border p-3 transition-all ${
        isSelected
          ? 'border-observe/50 bg-observe/10'
          : 'border-gray-800 bg-gray-800/50 hover:border-gray-700'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2">
        <div
          className={`h-2 w-2 rounded-full ${
            isInvestigating
              ? 'animate-pulse ' + PHASE_COLORS[investigationPhase!]
              : PHASE_COLORS[incident.state] ?? 'bg-gray-500'
          }`}
        />
        <span className="text-sm font-medium truncate flex-1">{incident.title}</span>
        <span
          className={`rounded px-1.5 py-0.5 text-xs ${SEVERITY_COLORS[incident.severity]}`}
        >
          {incident.severity}
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
        <span>{investigationPhase ?? incident.state}</span>
        {!isInvestigating && incident.status === 'active' && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onInvestigate();
            }}
            className="rounded bg-observe/20 px-2 py-1 text-observe hover:bg-observe/30 transition-colors"
          >
            Investigate
          </button>
        )}
        {isInvestigating && (
          <span className="flex items-center gap-1 text-observe">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-observe" />
            In progress
          </span>
        )}
      </div>
    </div>
  );
}

function OODAProgress({ currentState }: { currentState: string }) {
  const phases = ['OBSERVING', 'ORIENTING', 'DECIDING', 'ACTING', 'VERIFYING'];
  const currentIndex = phases.indexOf(currentState);

  return (
    <div className="flex items-center gap-1">
      {phases.map((phase, index) => {
        const isActive = index === currentIndex;
        const isComplete = index < currentIndex || currentState === 'DONE';
        const isFailed = currentState === 'FAILED';

        return (
          <div key={phase} className="flex items-center">
            <div
              className={`flex h-7 items-center rounded px-2 text-xs font-medium transition-all ${
                isActive
                  ? `${PHASE_COLORS[phase]} text-white shadow-lg shadow-${phase.toLowerCase()}/20`
                  : isComplete
                    ? 'bg-gray-700 text-gray-300'
                    : isFailed
                      ? 'bg-red-500/20 text-red-400'
                      : 'bg-gray-800 text-gray-500'
              }`}
            >
              {phase[0]}
              {isActive && (
                <span className="ml-1 hidden sm:inline">{phase.slice(1).toLowerCase()}</span>
              )}
            </div>
            {index < phases.length - 1 && (
              <div
                className={`h-0.5 w-3 ${isComplete ? 'bg-gray-600' : 'bg-gray-800'}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

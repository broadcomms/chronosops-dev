/**
 * Investigation View - Full incident investigation dashboard
 * Shows video, timeline, AI reasoning, evidence, and actions
 */
import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Timer, Brain, Clock, ArrowLeft, MoreHorizontal, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { PageLayout, Section, Grid, Card } from '../components/layout/PageLayout';
import { Dropdown, DropdownItem, DropdownSeparator } from '../components/ui/Dropdown';
import {
  VideoPlayer,
  IncidentTimeline,
  ThinkingProcess,
  EvidenceExplorer,
  HypothesisComparison,
  ActionControlPanel,
  CodeEvolutionLink,
} from '../components/investigation';
import { incidentsApi } from '../api/incidents';
import { healthApi } from '../api/health';
import { intelligenceApi } from '../api/intelligence';
import { useSafetyConfig } from '../hooks/useConfig';
import { config } from '../config/env';
import type { OODAState } from '../types';

const OODA_PHASES: OODAState[] = ['OBSERVING', 'ORIENTING', 'DECIDING', 'ACTING', 'VERIFYING'];

// Phase-specific colors for glow effect
const PHASE_COLORS: Record<string, { bg: string; text: string; glow: string }> = {
  OBSERVING: { bg: 'bg-observe', text: 'text-white', glow: 'shadow-observe/50' },
  ORIENTING: { bg: 'bg-orient', text: 'text-white', glow: 'shadow-orient/50' },
  DECIDING: { bg: 'bg-decide', text: 'text-white', glow: 'shadow-decide/50' },
  ACTING: { bg: 'bg-act', text: 'text-white', glow: 'shadow-act/50' },
  VERIFYING: { bg: 'bg-verify', text: 'text-white', glow: 'shadow-verify/50' },
};

// Investigation Timer - Shows elapsed time since investigation started
function InvestigationTimer({ startTime, isActive }: { startTime: Date | null; isActive: boolean }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startTime || !isActive) return;

    const updateElapsed = () => {
      setElapsed(Math.floor((Date.now() - startTime.getTime()) / 1000));
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [startTime, isActive]);

  if (!startTime) return null;

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${
      isActive
        ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
        : 'bg-green-500/10 border-green-500/30 text-green-400'
    }`}>
      <Timer size={18} />
      <div className="text-sm">
        <span className="font-mono font-bold">{timeString}</span>
        <span className="ml-1 text-xs opacity-70">
          {isActive ? 'elapsed' : 'total time'}
        </span>
      </div>
    </div>
  );
}

function OODAProgress({ currentPhase }: { currentPhase: OODAState }) {
  const currentIndex = OODA_PHASES.indexOf(currentPhase);
  const isComplete = currentPhase === 'DONE';
  const isFailed = currentPhase === 'FAILED';

  return (
    <div className="flex items-center gap-2">
      {OODA_PHASES.map((phase, index) => {
        const isActive = phase === currentPhase;
        const isCompleted = isComplete || index < currentIndex;
        const phaseColor = PHASE_COLORS[phase];

        return (
          <div key={phase} className="flex items-center">
            <div
              className={`
                px-3 py-1 rounded text-xs font-medium transition-all
                ${isActive && !isFailed ? `${phaseColor.bg} ${phaseColor.text} scale-110 shadow-lg ${phaseColor.glow} animate-pulse` : ''}
                ${isCompleted && !isActive ? 'bg-green-500/20 text-green-400 border border-green-500/30' : ''}
                ${!isActive && !isCompleted ? 'bg-gray-800 text-gray-500' : ''}
                ${isFailed && isActive ? 'bg-red-500 text-white shadow-lg shadow-red-500/50' : ''}
              `}
            >
              {phase}
            </div>
            {index < OODA_PHASES.length - 1 && (
              <div
                className={`w-4 h-0.5 mx-1 ${
                  isCompleted ? 'bg-green-500' : 'bg-gray-700'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function InvestigationView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);

  // Fetch safety config for dry run mode display
  const { data: safetyConfig } = useSafetyConfig();

  // Mutation for starting investigation
  const investigateMutation = useMutation({
    mutationFn: () => incidentsApi.investigate(id!),
    onSuccess: () => {
      toast.success('Investigation started');
      queryClient.invalidateQueries({ queryKey: ['incident', id] });
    },
    onError: (err) => {
      console.error('Investigation start error:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to start investigation: ${errorMessage}`);
    },
  });

  // Mutation for deleting incident
  const deleteMutation = useMutation({
    mutationFn: () => incidentsApi.delete(id!),
    onSuccess: () => {
      toast.success('Incident deleted');
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      navigate('/incidents');
    },
    onError: (err) => {
      console.error('Delete error:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to delete incident: ${errorMessage}`);
    },
  });

  // Mutation for learning patterns
  const learnPatternsMutation = useMutation({
    mutationFn: async () => {
      // Fetch postmortem to get root cause
      const postmortem = await incidentsApi.getPostmortem(id!);
      const incident = await incidentsApi.get(id!);
      const actions = await incidentsApi.getActions(id!);

      return intelligenceApi.learnPatterns({
        incidentId: id!,
        title: incident.data.title,
        description: incident.data.description ?? undefined,
        severity: incident.data.severity as 'low' | 'medium' | 'high' | 'critical',
        rootCause: postmortem.data?.rootCauseAnalysis ?? undefined,
        resolution: postmortem.data?.summary ?? undefined,
        actionsTaken: actions.data?.map(a => ({
          type: a.type,
          target: a.target,
          success: a.status === 'completed',
        })),
      });
    },
    onSuccess: (result) => {
      const patternsCount = result.data?.patternsStored ?? 0;
      toast.success(`Learned ${patternsCount} pattern${patternsCount !== 1 ? 's' : ''} from incident`);
      queryClient.invalidateQueries({ queryKey: ['intelligence-patterns'] });
      queryClient.invalidateQueries({ queryKey: ['intelligence-stats'] });
    },
    onError: (err) => {
      console.error('Learn patterns error:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to learn patterns: ${errorMessage}`);
    },
  });

  // Mutation for reconstructing timeline
  const reconstructMutation = useMutation({
    mutationFn: async () => {
      const incident = await incidentsApi.get(id!);
      const timeline = await incidentsApi.getTimeline(id!);
      const evidenceResponse = await incidentsApi.getEvidence(id!);
      const evidenceItems = evidenceResponse.data ?? [];

      // Build time range from first and last timeline events
      const timelineEvents = timeline.data ?? [];
      const start = timelineEvents.length > 0 ? timelineEvents[0]!.timestamp : incident.data.startedAt;
      const end = timelineEvents.length > 0 ? timelineEvents[timelineEvents.length - 1]!.timestamp : new Date().toISOString();

      // Convert evidence to reconstruction format
      const logs: Array<{
        timestamp: string;
        level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
        service: string;
        message: string;
        metadata?: Record<string, unknown>;
      }> = [];

      const metrics: Array<{
        timestamp: string;
        metric: string;
        value: number;
        labels?: Record<string, string>;
      }> = [];

      const events: Array<{
        timestamp: string;
        type: 'Normal' | 'Warning';
        reason: string;
        object: string;
        message: string;
        namespace: string;
      }> = [];

      const screenshots: Array<{
        timestamp: string;
        description: string;
        base64Data?: string;
      }> = [];

      for (const ev of evidenceItems) {
        const content = ev.content as Record<string, unknown>;

        if (ev.type === 'log') {
          logs.push({
            timestamp: ev.timestamp,
            level: (content.level as 'debug' | 'info' | 'warn' | 'error' | 'fatal') || 'info',
            service: ev.source || 'unknown',
            message: (content.message as string) || JSON.stringify(content),
            metadata: content.metadata as Record<string, unknown>,
          });
        } else if (ev.type === 'metric') {
          metrics.push({
            timestamp: ev.timestamp,
            metric: (content.name as string) || (content.metric as string) || 'unknown',
            value: (content.value as number) || 0,
            labels: content.labels as Record<string, string>,
          });
        } else if (ev.type === 'k8s_event') {
          events.push({
            timestamp: ev.timestamp,
            type: ((content.type as string)?.includes('Warning') ? 'Warning' : 'Normal') as 'Normal' | 'Warning',
            reason: (content.reason as string) || 'Unknown',
            object: (content.object as string) || (content.involvedObject as string) || 'unknown',
            message: (content.message as string) || '',
            namespace: incident.data.namespace,
          });
        } else if (ev.type === 'video_frame') {
          // Collect video frames as screenshots for reconstruction
          // Evidence can have description in multiple places depending on source
          const description = ev.metadata?.analysisText ||
            (content.analysis as string) ||
            (content.description as string) ||
            'Dashboard frame captured';

          // Include any panel states or anomaly information in the description
          const panelStates = ev.metadata?.panelStates || content.panelStates;
          const anomalyType = content.anomalyType as string;
          let fullDescription = description;
          if (anomalyType) {
            fullDescription += ` [Anomaly: ${anomalyType}]`;
          }
          if (panelStates && typeof panelStates === 'object') {
            const panelSummary = Object.entries(panelStates as Record<string, unknown>)
              .map(([panel, state]) => `${panel}: ${JSON.stringify(state)}`)
              .join('; ');
            if (panelSummary) {
              fullDescription += ` [Panels: ${panelSummary}]`;
            }
          }

          screenshots.push({
            timestamp: ev.timestamp,
            description: fullDescription,
            base64Data: ev.metadata?.frameImage as string | undefined,
          });
        }
      }

      return intelligenceApi.reconstruct({
        incidentId: id,
        timeRange: {
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
        },
        logs: logs.length > 0 ? logs : undefined,
        metrics: metrics.length > 0 ? metrics : undefined,
        events: events.length > 0 ? events : undefined,
        screenshots: screenshots.length > 0 ? screenshots : undefined,
        additionalContext: `Incident: ${incident.data.title}. Namespace: ${incident.data.namespace}. Severity: ${incident.data.severity}. Total evidence items: ${evidenceItems.length}. Video frames collected: ${screenshots.length}`,
      });
    },
    onSuccess: (result) => {
      toast.success('Timeline reconstructed');
      queryClient.invalidateQueries({ queryKey: ['intelligence-reconstructions'] });
      // Navigate to reconstruction detail page
      if (result.data?.id) {
        navigate(`/intelligence/reconstructions/${result.data.id}`);
      }
    },
    onError: (err) => {
      console.error('Reconstruct error:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to reconstruct timeline: ${errorMessage}`);
    },
  });

  // Fetch incident data
  const { data: incidentData, isLoading: incidentLoading, error: incidentError } = useQuery({
    queryKey: ['incident', id],
    queryFn: () => incidentsApi.get(id!),
    enabled: !!id,
    refetchInterval: config.polling.incidentRefresh,
  });

  // Fetch evidence
  const { data: evidenceData } = useQuery({
    queryKey: ['incident', id, 'evidence'],
    queryFn: () => incidentsApi.getEvidence(id!),
    enabled: !!id,
    refetchInterval: config.polling.incidentRefresh,
  });

  // Fetch hypotheses
  const { data: hypothesesData } = useQuery({
    queryKey: ['incident', id, 'hypotheses'],
    queryFn: () => incidentsApi.getHypotheses(id!),
    enabled: !!id,
    refetchInterval: config.polling.incidentRefresh,
  });

  // Fetch actions
  const { data: actionsData } = useQuery({
    queryKey: ['incident', id, 'actions'],
    queryFn: () => incidentsApi.getActions(id!),
    enabled: !!id,
    refetchInterval: config.polling.incidentRefresh,
  });

  // Fetch timeline
  const { data: timelineData } = useQuery({
    queryKey: ['incident', id, 'timeline'],
    queryFn: () => incidentsApi.getTimeline(id!),
    enabled: !!id,
    refetchInterval: config.polling.incidentRefresh,
  });

  // Fetch thinking states
  const { data: thinkingData } = useQuery({
    queryKey: ['incident', id, 'thinking'],
    queryFn: () => incidentsApi.getThinking(id!),
    enabled: !!id,
    refetchInterval: config.polling.incidentRefresh,
  });

  // Fetch service status for execution mode
  const { data: serviceStatus } = useQuery({
    queryKey: ['services', 'status'],
    queryFn: () => healthApi.getServiceStatus(),
    staleTime: 30000, // Cache for 30 seconds
  });

  const incident = incidentData?.data;
  const evidence = evidenceData?.data || [];
  const hypotheses = hypothesesData?.data || [];
  const actions = actionsData?.data || [];
  const timeline = timelineData?.data || [];
  const thoughts = thinkingData?.data || [];

  if (incidentLoading) {
    return (
      <PageLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-gray-400">Loading investigation...</p>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (incidentError || !incident) {
    return (
      <PageLayout>
        <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
          <div className="text-6xl mb-4 opacity-50">❌</div>
          <h2 className="text-xl font-semibold mb-2">Incident Not Found</h2>
          <p className="text-gray-500 mb-4">
            The incident you're looking for doesn't exist or has been deleted.
          </p>
          <Link
            to="/incidents"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            Back to Incidents
          </Link>
        </div>
      </PageLayout>
    );
  }

  const severityColors = {
    critical: 'bg-red-500/10 text-red-400 border-red-500/30',
    high: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
    medium: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
    low: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  };

  // Expandable description logic
  const descriptionTruncateLength = 200;
  const shouldTruncateDescription = incident.description && incident.description.length > descriptionTruncateLength;

  return (
    <PageLayout>
      {/* Header Card */}
      <Section>
        <Card padding="none" className="relative z-10">
          {/* Row 1: Navigation + Title */}
          <div className="flex items-center gap-4 p-4 border-b border-gray-700">
            <Link
              to="/incidents"
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-400 hover:text-white border border-gray-700 rounded-lg hover:bg-gray-800 transition shrink-0"
            >
              <ArrowLeft size={16} />
              Back
            </Link>
            <h1
              className="text-xl font-semibold line-clamp-2 min-w-0"
              title={incident.title}
            >
              {incident.title}
            </h1>
          </div>

          {/* Row 2: Metadata + Actions */}
          <div className="flex items-center justify-between gap-4 p-4">
            {/* Metadata Badges */}
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="px-2 py-1 text-xs rounded bg-purple-500/10 text-purple-400 border border-purple-500/30 font-mono shrink-0">
                {incident.namespace}
              </span>
              <span className={`px-2 py-1 text-xs rounded border shrink-0 ${severityColors[incident.severity]}`}>
                {incident.severity.toUpperCase()}
              </span>
              {incident.state === 'DONE' && (
                <span className="px-2 py-1 text-xs rounded bg-green-500/10 text-green-400 border border-green-500/30 shrink-0">
                  RESOLVED
                </span>
              )}
              {incident.state === 'FAILED' && (
                <span className="px-2 py-1 text-xs rounded bg-red-500/10 text-red-400 border border-red-500/30 shrink-0">
                  FAILED
                </span>
              )}
              <span className="text-xs text-gray-500 shrink-0">
                Started {new Date(incident.startedAt).toLocaleString()}
              </span>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Primary Action: Start Investigation */}
              {incident.state === 'IDLE' && incident.status !== 'resolved' && (
                <button
                  onClick={() => investigateMutation.mutate()}
                  disabled={investigateMutation.isPending}
                  className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg transition flex items-center gap-2"
                >
                  {investigateMutation.isPending ? (
                    <>
                      <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Starting...
                    </>
                  ) : (
                    'Start Investigation'
                  )}
                </button>
              )}

              {/* Primary Action: View Postmortem (when done) */}
              {incident.state === 'DONE' && (
                <Link
                  to={`/history/${incident.id}/postmortem`}
                  className="px-3 py-1.5 text-sm bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition"
                >
                  View Postmortem
                </Link>
              )}

              {/* More Actions Dropdown */}
              <Dropdown
                trigger={
                  <button className="px-2 py-1.5 text-sm border border-gray-700 rounded-lg hover:bg-gray-800 transition flex items-center gap-1 text-gray-400 hover:text-white">
                    <MoreHorizontal size={18} />
                  </button>
                }
              >
                {/* Learn Patterns - only for resolved incidents */}
                {incident.state === 'DONE' && (
                  <DropdownItem
                    onClick={() => learnPatternsMutation.mutate()}
                    disabled={learnPatternsMutation.isPending}
                  >
                    {learnPatternsMutation.isPending ? (
                      <>
                        <div className="w-4 h-4 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
                        Learning...
                      </>
                    ) : (
                      <>
                        <Brain size={16} className="text-green-400" />
                        Learn Patterns
                      </>
                    )}
                  </DropdownItem>
                )}

                {/* Reconstruct - for done or failed incidents */}
                {(incident.state === 'DONE' || incident.state === 'FAILED') && (
                  <DropdownItem
                    onClick={() => reconstructMutation.mutate()}
                    disabled={reconstructMutation.isPending}
                  >
                    {reconstructMutation.isPending ? (
                      <>
                        <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                        Reconstructing...
                      </>
                    ) : (
                      <>
                        <Clock size={16} className="text-blue-400" />
                        Reconstruct Timeline
                      </>
                    )}
                  </DropdownItem>
                )}

                {(incident.state === 'DONE' || incident.state === 'FAILED') && <DropdownSeparator />}

                {/* Delete - always available */}
                <DropdownItem
                  onClick={() => setShowDeleteConfirm(true)}
                  className="text-red-400 hover:text-red-300"
                >
                  <Trash2 size={16} />
                  Delete Incident
                </DropdownItem>
              </Dropdown>
            </div>
          </div>
        </Card>

        {/* Description - Expandable (outside card) */}
        {incident.description && (
          <div className="mt-3 text-sm text-gray-400">
            <p className={!descriptionExpanded && shouldTruncateDescription ? 'line-clamp-2' : ''}>
              {incident.description}
            </p>
            {shouldTruncateDescription && (
              <button
                onClick={() => setDescriptionExpanded(!descriptionExpanded)}
                className="mt-1 text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
              >
                {descriptionExpanded ? (
                  <>
                    <ChevronUp size={14} />
                    Show less
                  </>
                ) : (
                  <>
                    <ChevronDown size={14} />
                    Show more
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* OODA Progress with Timer */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 mt-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-400">Investigation Progress</span>
              <InvestigationTimer
                startTime={incidentData?.investigation?.startedAt ? new Date(incidentData.investigation.startedAt) : null}
                isActive={incident.state !== 'IDLE' && incident.state !== 'DONE' && incident.state !== 'FAILED'}
              />
            </div>
            <OODAProgress currentPhase={incident.state} />
          </div>
        </div>
      </Section>

      {/* Main Content - Video and AI Reasoning */}
      <Grid cols={2}>
        <div className="min-h-80">
          <VideoPlayer
            incidentId={incident.id}
            monitoredAppId={incident.monitoredAppId}
            className="w-full"
          />
        </div>
        <ThinkingProcess
          thoughts={thoughts}
          currentPhase={incident.state}
          timeline={timeline}
          className="h-80 overflow-auto"
        />
      </Grid>

      {/* Evidence and Hypotheses/Actions - Above Timeline */}
      <Grid cols={2}>
        <EvidenceExplorer
          evidence={evidence}
          className="max-h-[500px]"
        />
        <div className="space-y-4">
          <HypothesisComparison
            hypotheses={hypotheses}
          />
          <ActionControlPanel
            actions={actions}
            dryRunMode={safetyConfig?.dryRunMode ?? false}
            executionMode={
              serviceStatus?.services?.executor?.activeExecutor === 'KubernetesExecutor'
                ? 'kubernetes'
                : serviceStatus?.services?.executor?.activeExecutor === 'SimulatedExecutor'
                  ? 'simulated'
                  : (serviceStatus?.services?.executor?.currentMode as 'kubernetes' | 'simulated' | 'auto') || 'auto'
            }
          />
          <CodeEvolutionLink
            incidentId={incident.id}
            actions={actions}
          />
        </div>
      </Grid>

      {/* Investigation Timeline - Chronological order */}
      <Section className="mt-6">
        <IncidentTimeline
          events={timeline}
          currentPhase={incident.state}
        />
      </Section>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-white mb-2">Delete Incident?</h3>
            <p className="text-gray-400 mb-6">
              This will permanently delete the incident and all related data including evidence,
              hypotheses, actions, timeline events, and postmortem. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm border border-gray-600 rounded-lg hover:bg-gray-800 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  deleteMutation.mutate();
                  setShowDeleteConfirm(false);
                }}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 disabled:bg-red-600/50 text-white rounded-lg transition flex items-center gap-2"
              >
                {deleteMutation.isPending ? (
                  <>
                    <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Deleting...
                  </>
                ) : (
                  'Delete'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
}

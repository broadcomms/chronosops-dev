/**
 * DevelopmentDetail - Comprehensive view of a development cycle with all artifacts
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow, format } from 'date-fns';
import {
  ArrowLeft,
  Play,
  XCircle,
  RefreshCw,
  Clock,
  AlertTriangle,
  CheckCircle,
  Tag,
  User,
  Zap,
  FileCode,
  ExternalLink,
  Trash2,
  Timer,
  Edit3,
  Eye,
} from 'lucide-react';
import { PageLayout, Section, Card } from '../components/layout/PageLayout';
import {
  CycleProgress,
  CodePreview,
  BuildLogs,
  DeploymentStatus,
  RequirementAnalysis,
  ArchitectureViewer,
  AIReasoningPanel,
} from '../components/development';
import { AIVisionFeed } from '../components/vision';
import { EditableCodeViewer } from '../components/editor';
import { developmentApi } from '../api/development';
import { config } from '../config/env';
import type { DevelopmentPhase, DevelopmentCycleStatus, DevelopmentError } from '../types';
import {
  useLockInfo,
  useAcquireLock,
  useReleaseLock,
  useLockHeartbeat,
  useUpdateFile,
  useEvolutions,
  useCreateEvolution,
  useAnalyzeEvolution,
  useGenerateEvolution,
  useApproveEvolution,
  useRejectEvolution,
  useApplyEvolution,
  useRevertEvolution,
  useCycleVersions,
  useRestoreVersion,
  useUserId,
  useGitStatus,
} from '../hooks/useRegenerativeCode';

// Helper to derive status from phase
function getStatusFromPhase(phase: DevelopmentPhase): DevelopmentCycleStatus {
  switch (phase) {
    case 'IDLE':
      return 'pending';
    case 'COMPLETED':
      return 'completed';
    case 'FAILED':
      return 'failed';
    default:
      return 'running';
  }
}

// Phase status indicator with clickable dropdown for running phases
function PhaseStatusBadge({
  phase,
  cycleId,
  onRetry,
  onCancel,
  isActionPending = false
}: {
  phase: DevelopmentPhase;
  cycleId?: string;
  onRetry?: () => void;
  onCancel?: () => void;
  isActionPending?: boolean;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const status = getStatusFromPhase(phase);
  const badgeConfig = {
    pending: { bg: 'bg-gray-500/10', text: 'text-gray-400', icon: Clock },
    running: { bg: 'bg-blue-500/10', text: 'text-blue-400', icon: RefreshCw },
    completed: { bg: 'bg-green-500/10', text: 'text-green-400', icon: CheckCircle },
    failed: { bg: 'bg-red-500/10', text: 'text-red-400', icon: XCircle },
    cancelled: { bg: 'bg-orange-500/10', text: 'text-orange-400', icon: XCircle },
  };
  const style = badgeConfig[status];
  const Icon = style.icon;
  const isRunning = status === 'running';
  const isClickable = isRunning && cycleId && (onRetry || onCancel);

  return (
    <div className="relative">
      <button
        onClick={() => isClickable && setShowMenu(!showMenu)}
        disabled={!isClickable || isActionPending}
        className={`px-3 py-1.5 text-sm rounded-lg flex items-center gap-2 ${style.bg} ${style.text} ${
          isClickable ? 'cursor-pointer hover:ring-2 hover:ring-blue-500/30 transition-all' : ''
        } ${isActionPending ? 'opacity-50' : ''}`}
        title={isClickable ? 'Click to retry or cancel' : undefined}
      >
        <Icon size={14} className={status === 'running' ? 'animate-spin' : ''} />
        {phase}
        {isClickable && (
          <span className="ml-1 text-xs opacity-70">▼</span>
        )}
      </button>

      {/* Dropdown menu */}
      {showMenu && isClickable && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowMenu(false)}
          />
          {/* Menu */}
          <div className="absolute top-full left-0 mt-1 z-50 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px]">
            {onRetry && (
              <button
                onClick={() => {
                  setShowMenu(false);
                  onRetry();
                }}
                className="w-full px-4 py-2 text-left text-sm text-blue-400 hover:bg-gray-700 flex items-center gap-2"
              >
                <RefreshCw size={14} />
                Retry Phase
              </button>
            )}
            {onCancel && (
              <button
                onClick={() => {
                  setShowMenu(false);
                  onCancel();
                }}
                className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-gray-700 flex items-center gap-2"
              >
                <XCircle size={14} />
                Cancel Cycle
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Error display component
function ErrorDisplay({ error }: { error: DevelopmentError | string | null }) {
  if (!error) return null;

  const errorObj = typeof error === 'string'
    ? { message: error, phase: null, details: undefined, stack: undefined }
    : error;

  return (
    <Card className="border-red-500/30 bg-red-500/5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="text-red-400 flex-shrink-0 mt-0.5" size={20} />
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-red-400">Development Failed</h4>
            {errorObj.phase && (
              <span className="text-xs text-red-400/70">During: {errorObj.phase}</span>
            )}
          </div>
          <p className="text-sm text-gray-400 mt-1">{errorObj.message}</p>
          {errorObj.details && (
            <p className="text-xs text-gray-500 mt-2">{errorObj.details}</p>
          )}
          {errorObj.stack && (
            <pre className="mt-2 p-2 bg-red-900/20 rounded text-xs text-gray-500 overflow-x-auto">
              {errorObj.stack}
            </pre>
          )}
        </div>
      </div>
    </Card>
  );
}

// Development Timer - Shows elapsed time since cycle started
function DevelopmentTimer({
  startTime,
  endTime,
  isActive,
}: {
  startTime: Date | null;
  endTime: Date | null;
  isActive: boolean;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startTime) return;

    // If completed/failed, show total time
    if (endTime) {
      setElapsed(Math.floor((endTime.getTime() - startTime.getTime()) / 1000));
      return;
    }

    // If not active, don't update
    if (!isActive) return;

    const updateElapsed = () => {
      setElapsed(Math.floor((Date.now() - startTime.getTime()) / 1000));
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [startTime, endTime, isActive]);

  if (!startTime) return null;

  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;

  const timeString = hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    : `${minutes}:${seconds.toString().padStart(2, '0')}`;

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${
        isActive
          ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
          : endTime
            ? 'bg-green-500/10 border-green-500/30 text-green-400'
            : 'bg-gray-500/10 border-gray-500/30 text-gray-400'
      }`}
    >
      <Timer size={16} />
      <div className="text-sm">
        <span className="font-mono font-bold">{timeString}</span>
        <span className="ml-1 text-xs opacity-70">
          {isActive ? 'elapsed' : 'total time'}
        </span>
      </div>
    </div>
  );
}

export function DevelopmentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editedFiles, setEditedFiles] = useState<Record<string, string>>({});
  const userId = useUserId();

  const { data: cycleData, isLoading, error, refetch } = useQuery({
    queryKey: ['development-cycle', id],
    queryFn: () => developmentApi.get(id!),
    enabled: !!id,
    refetchInterval: config.polling.incidentRefresh,
  });

  const { data: filesData } = useQuery({
    queryKey: ['development-files', id],
    queryFn: () => developmentApi.getFiles(id!),
    enabled: !!id,
    refetchInterval: config.polling.incidentRefresh,
  });

  // Edit Lock hooks
  const { data: lockInfo } = useLockInfo(id, userId);
  const acquireLockMutation = useAcquireLock(id);
  const releaseLockMutation = useReleaseLock(id);
  const updateFileMutation = useUpdateFile(id);

  // Heartbeat management
  const lockId = lockInfo?.data?.lock?.id;
  const isLockOwner = lockInfo?.data?.isOwnLock ?? false;
  useLockHeartbeat(id, lockId, userId, isLockOwner && editMode);

  // Evolution hooks
  const { data: evolutionsData, refetch: refetchEvolutions } = useEvolutions(id);
  const createEvolutionMutation = useCreateEvolution(id);
  const analyzeEvolutionMutation = useAnalyzeEvolution(id);
  const generateEvolutionMutation = useGenerateEvolution(id);
  const approveEvolutionMutation = useApproveEvolution(id);
  const rejectEvolutionMutation = useRejectEvolution(id);
  const applyEvolutionMutation = useApplyEvolution(id);
  const revertEvolutionMutation = useRevertEvolution(id);

  // Version hooks
  const { data: versionsData, refetch: refetchVersions } = useCycleVersions(id);
  const restoreVersionMutation = useRestoreVersion(id);

  // Git hooks
  const { data: gitStatusData } = useGitStatus(id);

  const startMutation = useMutation({
    mutationFn: () => developmentApi.start(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['development-cycle', id] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => developmentApi.cancel(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['development-cycle', id] });
    },
  });

  const retryPhaseMutation = useMutation({
    mutationFn: () => developmentApi.retryPhase(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['development-cycle', id] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => developmentApi.delete(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['development-cycles'] });
      navigate('/development');
    },
  });

  // Handle entering edit mode
  const handleEnterEditMode = useCallback(async () => {
    if (!id || !userId) return;
    
    try {
      await acquireLockMutation.mutateAsync({
        userId,
        userName: userId.split('-')[0], // Simple name extraction
      });
      setEditMode(true);
      setEditedFiles({});
    } catch (err) {
      console.error('Failed to acquire lock:', err);
    }
  }, [id, userId, acquireLockMutation]);

  // Handle exiting edit mode
  const handleExitEditMode = useCallback(async () => {
    if (!id || !lockId || !userId) return;
    
    try {
      await releaseLockMutation.mutateAsync({ lockId, userId });
      setEditMode(false);
      setEditedFiles({});
    } catch (err) {
      console.error('Failed to release lock:', err);
    }
  }, [id, lockId, userId, releaseLockMutation]);

  // Handle file content change
  const handleFileChange = useCallback((path: string, content: string) => {
    setEditedFiles(prev => ({ ...prev, [path]: content }));
  }, []);

  // Handle discard changes
  const handleDiscardChanges = useCallback(() => {
    setEditedFiles({});
  }, []);

  const cycle = cycleData?.data;
  const files = filesData?.data ?? cycle?.files ?? [];
  const evolutions = evolutionsData?.data ?? [];
  const versions = versionsData?.data ?? [];
  const gitStatus = gitStatusData?.data?.status ?? null;

  // Handle save - need to find fileId from path (moved after files is defined)
  const handleSave = useCallback(async (path: string, content: string) => {
    if (!id || !userId) return;
    
    // Find the file ID from the path
    const file = files.find(f => f.path === path);
    if (!file) {
      console.error('File not found:', path);
      return;
    }
    
    try {
      await updateFileMutation.mutateAsync({
        fileId: file.id,
        content,
        userId,
      });
      // Remove from edited files after successful save
      setEditedFiles(prev => {
        const updated = { ...prev };
        delete updated[path];
        return updated;
      });
      // Refresh files list
      queryClient.invalidateQueries({ queryKey: ['development-files', id] });
      refetchVersions();
    } catch (err) {
      console.error('Failed to save file:', err);
    }
  }, [id, userId, files, updateFileMutation, queryClient, refetchVersions]);

  if (isLoading) {
    return (
      <PageLayout>
        <div className="py-12 text-center text-gray-500">
          <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p>Loading development cycle...</p>
        </div>
      </PageLayout>
    );
  }

  if (error || !cycle) {
    return (
      <PageLayout>
        <div className="py-12 text-center text-red-500">
          <AlertTriangle size={48} className="mx-auto mb-3 opacity-50" />
          <p>Failed to load development cycle</p>
          <Link to="/development" className="mt-4 text-blue-400 hover:underline">
            Back to Dashboard
          </Link>
        </div>
      </PageLayout>
    );
  }

  const status = getStatusFromPhase(cycle.phase);

  return (
    <PageLayout>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link
            to="/development"
            className="p-2 rounded-lg hover:bg-gray-800 transition-colors"
          >
            <ArrowLeft size={20} className="text-gray-400" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-white">Development Cycle</h1>
              <PhaseStatusBadge
                phase={cycle.phase}
                cycleId={cycle.id}
                onRetry={() => retryPhaseMutation.mutate()}
                onCancel={() => cancelMutation.mutate()}
                isActionPending={retryPhaseMutation.isPending || cancelMutation.isPending}
              />
            </div>
            <p className="text-xs text-gray-500 font-mono mt-1">{cycle.id}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status === 'pending' && (
            <button
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {startMutation.isPending ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Play size={14} />
              )}
              Start Cycle
            </button>
          )}
          {status === 'running' && (
            <button
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {cancelMutation.isPending ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <XCircle size={14} />
              )}
              Cancel
            </button>
          )}
          <button
            onClick={() => refetch()}
            className="px-4 py-2 text-sm border border-gray-700 rounded-lg hover:bg-gray-800 transition-colors text-gray-400"
          >
            Refresh
          </button>
          {status !== 'running' && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex items-center gap-2"
            >
              <Trash2 size={14} />
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-red-500/20 rounded-lg">
                <AlertTriangle size={24} className="text-red-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-white">Delete Development Cycle?</h3>
                <p className="text-sm text-gray-400 mt-2">
                  This will permanently delete the cycle and all associated resources including:
                </p>
                <ul className="text-sm text-gray-400 mt-2 list-disc list-inside space-y-1">
                  <li>Kubernetes deployment and service</li>
                  <li>Docker image from local daemon</li>
                  <li>All generated files and database records</li>
                </ul>
                <p className="text-sm text-red-400 mt-3 font-medium">
                  This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 text-sm border border-gray-700 rounded-lg hover:bg-gray-800 transition-colors text-gray-400 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {deleteMutation.isPending ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
                {deleteMutation.isPending ? 'Deleting...' : 'Delete Permanently'}
              </button>
            </div>
            {deleteMutation.isError && (
              <p className="text-sm text-red-400 mt-3">
                Failed to delete: {(deleteMutation.error as Error).message}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Quick Stats Bar */}
      <Section>
        <div className="grid grid-cols-5 gap-4">
          <Card className="bg-gray-900/50 p-3">
            <div className="flex items-center gap-2 text-gray-400 mb-1">
              <User size={14} />
              <span className="text-xs">Source</span>
            </div>
            <span className="text-sm font-medium text-white capitalize">{cycle.requirementSource}</span>
          </Card>
          <Card className="bg-gray-900/50 p-3">
            <div className="flex items-center gap-2 text-gray-400 mb-1">
              <Tag size={14} />
              <span className="text-xs">Priority</span>
            </div>
            <span className={`text-sm font-medium capitalize ${
              cycle.requirementPriority === 'critical' ? 'text-red-400' :
              cycle.requirementPriority === 'high' ? 'text-orange-400' :
              cycle.requirementPriority === 'medium' ? 'text-yellow-400' :
              'text-gray-400'
            }`}>
              {cycle.requirementPriority}
            </span>
          </Card>
          <Card className="bg-gray-900/50 p-3">
            <div className="flex items-center gap-2 text-gray-400 mb-1">
              <Zap size={14} />
              <span className="text-xs">Iterations</span>
            </div>
            <span className="text-sm font-medium text-white">
              {cycle.iterations} / {cycle.maxIterations}
            </span>
          </Card>
          <Card className="bg-gray-900/50 p-3">
            <div className="flex items-center gap-2 text-gray-400 mb-1">
              <FileCode size={14} />
              <span className="text-xs">Files Generated</span>
            </div>
            <span className="text-sm font-medium text-white">{files.length}</span>
          </Card>
          <Card className="bg-gray-900/50 p-3">
            <div className="flex items-center gap-2 text-gray-400 mb-1">
              <Clock size={14} />
              <span className="text-xs">Created</span>
            </div>
            <span className="text-sm font-medium text-white">
              {formatDistanceToNow(new Date(cycle.createdAt), { addSuffix: true })}
            </span>
          </Card>
        </div>
      </Section>

      {/* Development Progress Section */}
      <Section>
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
          {/* Header with title, timer, and iteration count */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <h3 className="text-sm font-medium text-gray-300">Development Progress</h3>
              <DevelopmentTimer
                startTime={cycle.createdAt ? new Date(cycle.createdAt) : null}
                endTime={cycle.completedAt ? new Date(cycle.completedAt) : null}
                isActive={status === 'running'}
              />
            </div>
            <span className="text-xs text-gray-500">
              Iteration {cycle.iterations} / {cycle.maxIterations}
            </span>
          </div>

          {/* Phase Progress Pipeline */}
          <CycleProgress
            currentPhase={cycle.phase}
            iteration={cycle.iterations}
            maxIterations={cycle.maxIterations}
          />
        </div>
      </Section>

      {/* Live Monitoring Feed - Full width, proper aspect ratio */}
      {cycle.deployment?.deploymentName && (
        <Section>
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
            <div className="px-4 py-2 border-b border-gray-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-sm font-medium text-gray-300">Live Monitoring</span>
                <span className="text-xs text-gray-500">
                  {cycle.deployment.deploymentName}
                </span>
              </div>
              <span className="text-xs text-gray-500">
                {cycle.deployment.namespace || 'development'}
              </span>
            </div>
            <AIVisionFeed
              serviceName={cycle.deployment.deploymentName}
              namespace={cycle.deployment.namespace || 'development'}
              serverUrl={config.apiUrl}
              showRecordingControls={false}
              className="aspect-video max-h-[400px]"
            />
          </div>
        </Section>
      )}

      {/* Live Deployment URL Banner - Most Important! */}
      {cycle.deployment?.serviceUrl && (
        <Section>
          <div className="p-4 bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-500/20 rounded-lg">
                  <CheckCircle size={24} className="text-green-400" />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-white">Application Deployed Successfully!</h3>
                  <p className="text-sm text-gray-400">Your generated application is now live and accessible</p>
                </div>
              </div>
              <a
                href={cycle.deployment.serviceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors flex items-center gap-2 font-medium"
              >
                <ExternalLink size={18} />
                Open Live App
              </a>
            </div>
          </div>
        </Section>
      )}

      {/* Error Message */}
      {cycle.error && (
        <Section>
          <ErrorDisplay error={cycle.error} />
        </Section>
      )}

      {/* Main Content - Two Column Layout */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left Column - Primary Artifacts (8 cols) */}
        <div className="col-span-8 space-y-6">
          {/* Requirement Analysis */}
          <RequirementAnalysis
            rawRequirement={cycle.requirementRaw}
            analyzedRequirement={cycle.analyzedRequirement}
            source={cycle.requirementSource}
            priority={cycle.requirementPriority}
          />

          {/* Architecture Design */}
          <ArchitectureViewer architecture={cycle.architecture} architectureDiagramUrl={cycle.architectureDiagramUrl} />

          {/* Generated Code - Interactive Editor */}
          {files.length > 0 && (
            <div className="border border-gray-700 rounded-lg overflow-hidden">
              {/* Edit Mode Toggle Header */}
              <div className="px-4 py-3 bg-gray-800/50 border-b border-gray-700 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileCode size={18} className="text-blue-400" />
                  <h3 className="text-sm font-medium text-white">Generated Code</h3>
                  <span className="text-xs text-gray-500">{files.length} files</span>
                </div>
                <div className="flex items-center gap-2">
                  {!editMode ? (
                    <button
                      onClick={handleEnterEditMode}
                      disabled={acquireLockMutation.isPending || status === 'running'}
                      className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors flex items-center gap-2"
                    >
                      {acquireLockMutation.isPending ? (
                        <RefreshCw size={14} className="animate-spin" />
                      ) : (
                        <Edit3 size={14} />
                      )}
                      Edit Code
                    </button>
                  ) : (
                    <button
                      onClick={handleExitEditMode}
                      disabled={releaseLockMutation.isPending}
                      className="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-700 disabled:opacity-50 text-white rounded-lg transition-colors flex items-center gap-2"
                    >
                      {releaseLockMutation.isPending ? (
                        <RefreshCw size={14} className="animate-spin" />
                      ) : (
                        <Eye size={14} />
                      )}
                      Exit Edit Mode
                    </button>
                  )}
                </div>
              </div>
              
              {/* Code Viewer/Editor */}
              {editMode ? (
                <EditableCodeViewer
                  files={files.map(f => ({
                    ...f,
                    content: editedFiles[f.path] ?? f.content,
                  }))}
                  cycleId={id!}
                  userId={userId}
                  lockInfo={lockInfo?.data}
                  evolutions={evolutions}
                  versions={versions}
                  gitStatus={gitStatus}
                  isEditable={true}
                  onFileChange={handleFileChange}
                  onSave={handleSave}
                  onDiscard={handleDiscardChanges}
                  onAcquireLock={handleEnterEditMode}
                  onReleaseLock={handleExitEditMode}
                  onCreateEvolution={async (prompt, fileScope) => {
                    await createEvolutionMutation.mutateAsync({ 
                      prompt, 
                      scope: fileScope,
                      userId,
                    });
                    refetchEvolutions();
                  }}
                  onAnalyzeEvolution={async (evolutionId) => {
                    await analyzeEvolutionMutation.mutateAsync(evolutionId);
                    refetchEvolutions();
                  }}
                  onGenerateEvolution={async (evolutionId) => {
                    await generateEvolutionMutation.mutateAsync(evolutionId);
                    refetchEvolutions();
                  }}
                  onApproveEvolution={async (evolutionId) => {
                    await approveEvolutionMutation.mutateAsync({ 
                      evolutionId, 
                      reviewedBy: userId,
                    });
                    refetchEvolutions();
                  }}
                  onRejectEvolution={async (evolutionId, reason) => {
                    await rejectEvolutionMutation.mutateAsync({ 
                      evolutionId, 
                      reviewedBy: userId,
                      notes: reason,
                    });
                    refetchEvolutions();
                  }}
                  onApplyEvolution={async (evolutionId) => {
                    await applyEvolutionMutation.mutateAsync({ evolutionId, approvedBy: userId });
                    refetchEvolutions();
                    queryClient.invalidateQueries({ queryKey: ['development-files', id] });
                  }}
                  onRevertEvolution={async (evolutionId, reason) => {
                    await revertEvolutionMutation.mutateAsync({ evolutionId, reason: reason || 'User requested revert' });
                    refetchEvolutions();
                    queryClient.invalidateQueries({ queryKey: ['development-files', id] });
                  }}
                  onRestoreVersion={async (versionId, fileId) => {
                    if (!fileId) {
                      console.error('fileId required to restore version');
                      return;
                    }
                    await restoreVersionMutation.mutateAsync({ fileId, versionId, userId });
                    refetchVersions();
                    queryClient.invalidateQueries({ queryKey: ['development-files', id] });
                  }}
                />
              ) : (
                <CodePreview files={files} />
              )}
            </div>
          )}

          {/* Build Pipeline */}
          <BuildLogs buildResult={cycle.buildResult} />
        </div>

        {/* Right Column - Secondary Artifacts (4 cols) */}
        <div className="col-span-4 space-y-6">
          {/* AI Reasoning */}
          <AIReasoningPanel
            thoughtSignature={cycle.thoughtSignature}
            verification={cycle.verification}
          />

          {/* Deployment Status */}
          <DeploymentStatus deploymentResult={cycle.deployment} cycleId={id!} />

          {/* Metadata Card */}
          <Card>
            <h3 className="text-sm font-medium text-gray-300 mb-4">Cycle Metadata</h3>
            <div className="space-y-3 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">Created</span>
                <span className="text-gray-300">
                  {format(new Date(cycle.createdAt), 'PPp')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Updated</span>
                <span className="text-gray-300">
                  {format(new Date(cycle.updatedAt), 'PPp')}
                </span>
              </div>
              {cycle.completedAt && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Completed</span>
                  <span className="text-green-400">
                    {format(new Date(cycle.completedAt), 'PPp')}
                  </span>
                </div>
              )}
              {cycle.triggeredByIncidentId && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Triggered By</span>
                  <Link
                    to={`/incidents/${cycle.triggeredByIncidentId}`}
                    className="text-blue-400 hover:underline"
                  >
                    View Incident
                  </Link>
                </div>
              )}
            </div>
          </Card>

          {/* Code Summary */}
          {cycle.generatedCodeSummary && (
            <Card>
              <h3 className="text-sm font-medium text-gray-300 mb-4">Code Summary</h3>
              <div className="space-y-3">
                {typeof cycle.generatedCodeSummary === 'object' && (
                  <>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Total Files</span>
                      <span className="text-white">{cycle.generatedCodeSummary.totalFiles}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Entry Point</span>
                      <code className="text-blue-400">{cycle.generatedCodeSummary.entryPoint}</code>
                    </div>
                    {cycle.generatedCodeSummary.byLanguage && (
                      <div>
                        <span className="text-xs text-gray-500">Languages</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {Object.entries(cycle.generatedCodeSummary.byLanguage).map(([lang, count]) => (
                            <span
                              key={lang}
                              className="px-2 py-0.5 text-xs bg-gray-700 text-gray-300 rounded"
                            >
                              {lang}: {count as number}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

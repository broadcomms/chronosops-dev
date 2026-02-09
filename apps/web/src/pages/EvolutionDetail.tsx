/**
 * EvolutionDetail - Dedicated page for reviewing and managing a code evolution
 */
import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import {
  ArrowLeft,
  Sparkles,
  Play,
  Check,
  X,
  Eye,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  FileCode,
  FilePlus,
  FileEdit,
  Trash2,
  RotateCcw,
  Clock,
  Zap,
  Rocket,
  ArrowRight,
} from 'lucide-react';
import { PageLayout, Section, Card } from '../components/layout/PageLayout';
import {
  useEvolution,
  useAnalyzeEvolution,
  useGenerateEvolution,
  useApproveEvolution,
  useRejectEvolution,
  useApplyEvolution,
  useRevertEvolution,
  useUserId,
} from '../hooks/useRegenerativeCode';
import { developmentApi } from '../api/development';
import type { EvolutionStatus, FileChange } from '../api/evolutions';

// ============================================
// Status Configuration
// ============================================

interface StatusConfig {
  bg: string;
  text: string;
  border: string;
  icon: typeof Sparkles;
  label: string;
  description: string;
}

const statusConfigs: Record<EvolutionStatus, StatusConfig> = {
  pending: {
    bg: 'bg-gray-500/10',
    text: 'text-gray-400',
    border: 'border-gray-500/30',
    icon: Clock,
    label: 'Pending',
    description: 'Evolution request created. Click "Analyze" to start AI analysis.',
  },
  analyzing: {
    bg: 'bg-blue-500/10',
    text: 'text-blue-400',
    border: 'border-blue-500/30',
    icon: RefreshCw,
    label: 'Analyzing',
    description: 'AI is analyzing the impact of requested changes...',
  },
  generating: {
    bg: 'bg-purple-500/10',
    text: 'text-purple-400',
    border: 'border-purple-500/30',
    icon: Sparkles,
    label: 'Generating',
    description: 'Analysis complete. Click "Generate Changes" to have AI create the code modifications.',
  },
  review: {
    bg: 'bg-yellow-500/10',
    text: 'text-yellow-400',
    border: 'border-yellow-500/30',
    icon: Eye,
    label: 'Ready for Review',
    description: 'Changes generated. Review the proposed changes below and approve or reject.',
  },
  approved: {
    bg: 'bg-green-500/10',
    text: 'text-green-400',
    border: 'border-green-500/30',
    icon: Check,
    label: 'Approved',
    description: 'Changes approved. Click "Apply Changes" to update the files.',
  },
  rejected: {
    bg: 'bg-red-500/10',
    text: 'text-red-400',
    border: 'border-red-500/30',
    icon: X,
    label: 'Rejected',
    description: 'This evolution was rejected and will not be applied.',
  },
  applied: {
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
    border: 'border-emerald-500/30',
    icon: Check,
    label: 'Applied',
    description: 'Changes have been applied. Click "Rebuild & Deploy" to deploy.',
  },
  reverted: {
    bg: 'bg-orange-500/10',
    text: 'text-orange-400',
    border: 'border-orange-500/30',
    icon: RotateCcw,
    label: 'Reverted',
    description: 'Changes were reverted.',
  },
  failed: {
    bg: 'bg-red-500/10',
    text: 'text-red-400',
    border: 'border-red-500/30',
    icon: AlertTriangle,
    label: 'Failed',
    description: 'Evolution failed. See error details below.',
  },
};

// ============================================
// Workflow Progress Stepper
// ============================================

const WORKFLOW_STEPS = [
  { status: 'pending', label: 'Create' },
  { status: 'analyzing', label: 'Analyze' },
  { status: 'generating', label: 'Generate' },
  { status: 'review', label: 'Review' },
  { status: 'approved', label: 'Approve' },
  { status: 'applied', label: 'Apply' },
] as const;

function WorkflowStepper({ currentStatus }: { currentStatus: EvolutionStatus }) {
  const currentIndex = WORKFLOW_STEPS.findIndex(s => s.status === currentStatus);
  const isTerminal = ['rejected', 'reverted', 'failed'].includes(currentStatus);
  
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {WORKFLOW_STEPS.map((step, index) => {
        const isPast = index < currentIndex;
        const isCurrent = step.status === currentStatus;
        
        return (
          <div key={step.status} className="flex items-center">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              isCurrent 
                ? `${statusConfigs[currentStatus].bg} ${statusConfigs[currentStatus].text} ring-2 ring-offset-1 ring-offset-gray-900`
                : isPast
                  ? 'bg-green-500/20 text-green-400'
                  : isTerminal
                    ? 'bg-gray-800/50 text-gray-600'
                    : 'bg-gray-800/50 text-gray-500'
            }`}>
              {isPast && <Check size={10} />}
              {isCurrent && (currentStatus === 'analyzing' || currentStatus === 'generating') && (
                <RefreshCw size={10} className="animate-spin" />
              )}
              {step.label}
            </div>
            {index < WORKFLOW_STEPS.length - 1 && (
              <ArrowRight size={12} className={`mx-1 ${isPast ? 'text-green-500' : 'text-gray-700'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================
// File Change Card
// ============================================

function FileChangeCard({ 
  change, 
  isExpanded, 
  onToggle,
  onNavigate,
}: { 
  change: FileChange; 
  isExpanded: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  const changeTypeConfig: Record<'create' | 'modify' | 'delete', { icon: typeof FilePlus; bg: string; text: string; label: string }> = {
    create: { icon: FilePlus, bg: 'bg-green-500/10', text: 'text-green-400', label: 'New File' },
    modify: { icon: FileEdit, bg: 'bg-blue-500/10', text: 'text-blue-400', label: 'Modified' },
    delete: { icon: Trash2, bg: 'bg-red-500/10', text: 'text-red-400', label: 'Deleted' },
  };
  
  const config = changeTypeConfig[change.changeType];
  const ChangeIcon = config.icon;
  
  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      <div
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 bg-gray-800/50 hover:bg-gray-800 transition-colors text-left cursor-pointer"
      >
        <div className="flex items-center gap-3">
          {isExpanded ? <ChevronDown size={16} className="text-gray-500" /> : <ChevronRight size={16} className="text-gray-500" />}
          <ChangeIcon size={16} className={config.text} />
          <span className="text-sm text-white font-mono">{change.path}</span>
          <span className={`text-xs px-2 py-0.5 rounded ${config.bg} ${config.text}`}>
            {config.label}
          </span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNavigate();
          }}
          className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
        >
          Open in Editor
        </button>
      </div>
      
      {isExpanded && (
        <div className="border-t border-gray-700 p-4 bg-gray-900/50 overflow-x-auto max-h-96">
          {change.diff ? (
            <pre className="text-xs font-mono">
              {change.diff.split('\n').map((line, idx) => {
                let lineClass = 'text-gray-400';
                if (line.startsWith('+') && !line.startsWith('+++')) {
                  lineClass = 'text-green-400 bg-green-500/10';
                } else if (line.startsWith('-') && !line.startsWith('---')) {
                  lineClass = 'text-red-400 bg-red-500/10';
                } else if (line.startsWith('@@')) {
                  lineClass = 'text-blue-400';
                }
                return (
                  <div key={idx} className={`${lineClass} px-2`}>
                    {line || ' '}
                  </div>
                );
              })}
            </pre>
          ) : change.newContent ? (
            <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap">
              {change.newContent}
            </pre>
          ) : (
            <p className="text-sm text-gray-500 italic">No content preview available</p>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// Main Component
// ============================================

export function EvolutionDetail() {
  const { id: cycleId, evolutionId } = useParams<{ id: string; evolutionId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const userId = useUserId();
  
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [reviewNotes, setReviewNotes] = useState('');
  const [revertReason, setRevertReason] = useState('');
  const [showRevertInput, setShowRevertInput] = useState(false);
  
  // Fetch evolution data
  const { data: evolutionData, isLoading, error, refetch } = useEvolution(cycleId, evolutionId);
  
  // Mutations
  const analyzeMutation = useAnalyzeEvolution(cycleId);
  const generateMutation = useGenerateEvolution(cycleId);
  const approveMutation = useApproveEvolution(cycleId);
  const rejectMutation = useRejectEvolution(cycleId);
  const applyMutation = useApplyEvolution(cycleId);
  const revertMutation = useRevertEvolution(cycleId);
  
  // Rebuild mutation - uses rebuild endpoint which only runs BUILD → DEPLOY → VERIFY
  const rebuildMutation = useMutation({
    mutationFn: () => developmentApi.rebuild(cycleId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['development-cycle', cycleId] });
      navigate(`/development/${cycleId}`);
    },
  });
  
  const evolution = evolutionData?.data;
  const status = evolution?.status;
  const statusConfig = status ? statusConfigs[status] : null;
  
  // Auto-expand all files initially
  useEffect(() => {
    if (evolution?.proposedChanges) {
      setExpandedFiles(new Set(evolution.proposedChanges.map(c => c.path)));
    }
  }, [evolution?.proposedChanges]);
  
  const toggleFile = (path: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };
  
  const handleNavigateToFile = (filePath: string) => {
    navigate(`/development/${cycleId}?file=${encodeURIComponent(filePath)}`);
  };
  
  const handleAnalyze = async () => {
    if (!evolutionId) return;
    try {
      await analyzeMutation.mutateAsync(evolutionId);
      // After analysis completes, automatically trigger generation
      // The backend sets status to 'generating' after successful analysis
      await generateMutation.mutateAsync(evolutionId);
    } catch {
      // If either fails, refetch to show current state
    }
    refetch();
  };
  
  const handleGenerate = async () => {
    if (!evolutionId) return;
    await generateMutation.mutateAsync(evolutionId);
    refetch();
  };
  
  const handleApprove = async () => {
    if (!evolutionId) return;
    await approveMutation.mutateAsync({ evolutionId, reviewedBy: userId, notes: reviewNotes });
    refetch();
  };
  
  const handleReject = async () => {
    if (!evolutionId) return;
    await rejectMutation.mutateAsync({ evolutionId, reviewedBy: userId, notes: reviewNotes });
    refetch();
  };
  
  const handleApply = async () => {
    if (!evolutionId) return;
    await applyMutation.mutateAsync({ evolutionId, approvedBy: userId });
    queryClient.invalidateQueries({ queryKey: ['development-files', cycleId] });
    refetch();
  };
  
  const handleApplyAndRebuild = async () => {
    if (!evolutionId) return;
    await applyMutation.mutateAsync({ evolutionId, approvedBy: userId });
    queryClient.invalidateQueries({ queryKey: ['development-files', cycleId] });
    await rebuildMutation.mutateAsync();
  };
  
  const handleRevert = async () => {
    if (!evolutionId || !revertReason.trim()) return;
    await revertMutation.mutateAsync({ evolutionId, reason: revertReason });
    queryClient.invalidateQueries({ queryKey: ['development-files', cycleId] });
    setShowRevertInput(false);
    setRevertReason('');
    refetch();
  };
  
  const isPending = 
    analyzeMutation.isPending || 
    generateMutation.isPending || 
    approveMutation.isPending || 
    rejectMutation.isPending || 
    applyMutation.isPending || 
    revertMutation.isPending ||
    rebuildMutation.isPending;
  
  if (isLoading) {
    return (
      <PageLayout>
        <div className="py-12 text-center text-gray-500">
          <div className="animate-spin h-8 w-8 border-2 border-purple-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p>Loading evolution...</p>
        </div>
      </PageLayout>
    );
  }
  
  if (error || !evolution) {
    return (
      <PageLayout>
        <div className="py-12 text-center text-red-500">
          <AlertTriangle size={48} className="mx-auto mb-3 opacity-50" />
          <p>Failed to load evolution</p>
          <Link to={`/development/${cycleId}`} className="mt-4 text-blue-400 hover:underline block">
            Back to Development Cycle
          </Link>
        </div>
      </PageLayout>
    );
  }
  
  return (
    <PageLayout>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link
            to={`/development/${cycleId}`}
            className="p-2 rounded-lg hover:bg-gray-800 transition-colors"
          >
            <ArrowLeft size={20} className="text-gray-400" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <Sparkles size={24} className="text-purple-400" />
              <h1 className="text-xl font-bold text-white">Code Evolution</h1>
            </div>
            <p className="text-xs text-gray-500 font-mono mt-1">{evolution.id}</p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          className="px-4 py-2 text-sm border border-gray-700 rounded-lg hover:bg-gray-800 transition-colors text-gray-400"
        >
          Refresh
        </button>
      </div>
      
      {/* Workflow Progress */}
      <Section>
        <Card className={statusConfig?.border}>
          <div className="flex flex-col gap-4">
            <WorkflowStepper currentStatus={status!} />
            <div className={`flex items-center gap-3 p-3 rounded-lg ${statusConfig?.bg}`}>
              {statusConfig && (
                <statusConfig.icon 
                  size={20} 
                  className={`${statusConfig.text} ${status === 'analyzing' || status === 'generating' ? 'animate-spin' : ''}`} 
                />
              )}
              <div>
                <span className={`font-medium ${statusConfig?.text}`}>{statusConfig?.label}</span>
                <p className="text-sm text-gray-400 mt-0.5">{statusConfig?.description}</p>
              </div>
            </div>
          </div>
        </Card>
      </Section>
      
      {/* Request Details */}
      <Section>
        <Card>
          <h3 className="text-sm font-medium text-gray-400 mb-3">Evolution Request</h3>
          <p className="text-white text-lg">{evolution.prompt}</p>
          <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
            <span>Created {formatDistanceToNow(new Date(evolution.createdAt), { addSuffix: true })}</span>
            {evolution.filesAffected !== null && (
              <span className="flex items-center gap-1">
                <FileCode size={12} />
                {evolution.filesAffected} file{evolution.filesAffected !== 1 ? 's' : ''} affected
              </span>
            )}
          </div>
        </Card>
      </Section>
      
      {/* Analysis Result */}
      {evolution.analysisResult && (
        <Section>
          <Card>
            <h3 className="text-sm font-medium text-gray-400 mb-3">AI Analysis</h3>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="p-3 bg-gray-800/50 rounded-lg">
                <span className="text-xs text-gray-500">Impact Level</span>
                <div className="mt-1">
                  <span className={`inline-flex px-2 py-1 rounded text-sm font-medium ${
                    evolution.analysisResult.impactLevel === 'high'
                      ? 'bg-red-500/20 text-red-400'
                      : evolution.analysisResult.impactLevel === 'medium'
                        ? 'bg-yellow-500/20 text-yellow-400'
                        : 'bg-green-500/20 text-green-400'
                  }`}>
                    {(evolution.analysisResult.impactLevel || 'unknown').toUpperCase()}
                  </span>
                </div>
              </div>
              <div className="p-3 bg-gray-800/50 rounded-lg">
                <span className="text-xs text-gray-500">Files to Change</span>
                <p className="text-xl font-bold text-white mt-1">
                  {evolution.analysisResult.affectedFiles?.length || 0}
                </p>
              </div>
              <div className="p-3 bg-gray-800/50 rounded-lg">
                <span className="text-xs text-gray-500">Risk Factors</span>
                <p className="text-xl font-bold text-white mt-1">
                  {evolution.analysisResult.risks?.length || 0}
                </p>
              </div>
            </div>
            
            {evolution.analysisResult.affectedFiles && evolution.analysisResult.affectedFiles.length > 0 && (
              <div className="mb-4">
                <span className="text-xs text-gray-500">Affected Files</span>
                <div className="flex flex-wrap gap-2 mt-2">
                  {evolution.analysisResult.affectedFiles.map(file => (
                    <button
                      key={file}
                      onClick={() => handleNavigateToFile(file)}
                      className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded transition-colors"
                    >
                      {file}
                    </button>
                  ))}
                </div>
              </div>
            )}
            
            {evolution.analysisResult.risks && evolution.analysisResult.risks.length > 0 && (
              <div>
                <span className="text-xs text-gray-500">Risk Factors</span>
                <ul className="mt-2 space-y-1">
                  {evolution.analysisResult.risks.map((risk, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-orange-400">
                      <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                      {risk}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </Section>
      )}
      
      {/* Proposed Changes */}
      {evolution.proposedChanges && evolution.proposedChanges.length > 0 && (
        <Section>
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-gray-400">
                Proposed Changes ({evolution.proposedChanges.length} file{evolution.proposedChanges.length !== 1 ? 's' : ''})
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={() => setExpandedFiles(new Set(evolution.proposedChanges!.map(c => c.path)))}
                  className="text-xs text-gray-500 hover:text-gray-300"
                >
                  Expand All
                </button>
                <button
                  onClick={() => setExpandedFiles(new Set())}
                  className="text-xs text-gray-500 hover:text-gray-300"
                >
                  Collapse All
                </button>
              </div>
            </div>
            
            <div className="space-y-3">
              {evolution.proposedChanges.map(change => (
                <FileChangeCard
                  key={change.path}
                  change={change}
                  isExpanded={expandedFiles.has(change.path)}
                  onToggle={() => toggleFile(change.path)}
                  onNavigate={() => handleNavigateToFile(change.path)}
                />
              ))}
            </div>
          </Card>
        </Section>
      )}
      
      {/* Error Display */}
      {evolution.error && (
        <Section>
          <Card className="border-red-500/30 bg-red-500/5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="text-red-400 flex-shrink-0 mt-0.5" size={20} />
              <div>
                <h4 className="text-sm font-medium text-red-400">Evolution Failed</h4>
                <p className="text-sm text-gray-400 mt-1">{evolution.error}</p>
              </div>
            </div>
          </Card>
        </Section>
      )}
      
      {/* Review Notes Input (for review status) */}
      {status === 'review' && (
        <Section>
          <Card>
            <h3 className="text-sm font-medium text-gray-400 mb-3">Review Notes (optional)</h3>
            <textarea
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              placeholder="Add notes about your decision..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              rows={2}
            />
          </Card>
        </Section>
      )}
      
      {/* Revert Reason Input */}
      {showRevertInput && (
        <Section>
          <Card className="border-orange-500/30 bg-orange-500/5">
            <h3 className="text-sm font-medium text-orange-400 mb-3">Revert Reason</h3>
            <textarea
              value={revertReason}
              onChange={(e) => setRevertReason(e.target.value)}
              placeholder="Why are you reverting this evolution?"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
              rows={2}
            />
          </Card>
        </Section>
      )}
      
      {/* Action Bar */}
      <div className="sticky bottom-0 bg-gray-900/95 backdrop-blur border-t border-gray-800 -mx-6 px-6 py-4 mt-6">
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-500">
            {evolution.reviewedBy && (
              <span>
                Reviewed by {evolution.reviewedBy}
                {evolution.reviewedAt && ` ${formatDistanceToNow(new Date(evolution.reviewedAt), { addSuffix: true })}`}
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-3">
            {/* Pending - Analyze */}
            {status === 'pending' && (
              <button
                onClick={handleAnalyze}
                disabled={isPending}
                className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors font-medium"
              >
                {isPending ? <RefreshCw size={16} className="animate-spin" /> : <Zap size={16} />}
                Start Analysis
              </button>
            )}
            
            {/* Generating - Generate */}
            {(status === 'analyzing' || status === 'generating') && (
              <button
                onClick={handleGenerate}
                disabled={isPending || generateMutation.isPending}
                className="flex items-center gap-2 px-6 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg transition-colors font-medium"
              >
                {(isPending || generateMutation.isPending) ? <RefreshCw size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {status === 'generating' && !evolution?.proposedChanges?.length ? 'Generate Changes' : 'Regenerate Changes'}
              </button>
            )}
            
            {/* Review - Approve/Reject */}
            {status === 'review' && (
              <>
                <button
                  onClick={handleReject}
                  disabled={isPending}
                  className="flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg transition-colors"
                >
                  {isPending ? <RefreshCw size={16} className="animate-spin" /> : <X size={16} />}
                  Reject
                </button>
                <button
                  onClick={handleApprove}
                  disabled={isPending}
                  className="flex items-center gap-2 px-6 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg transition-colors font-medium"
                >
                  {isPending ? <RefreshCw size={16} className="animate-spin" /> : <Check size={16} />}
                  Approve Changes
                </button>
              </>
            )}
            
            {/* Approved - Apply (with rebuild option) */}
            {status === 'approved' && (
              <>
                <button
                  onClick={handleApply}
                  disabled={isPending}
                  className="flex items-center gap-2 px-4 py-2.5 border border-gray-600 hover:bg-gray-800 disabled:opacity-50 text-white rounded-lg transition-colors"
                >
                  {isPending ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}
                  Apply Only
                </button>
                <button
                  onClick={handleApplyAndRebuild}
                  disabled={isPending}
                  className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors font-medium"
                >
                  {isPending ? <RefreshCw size={16} className="animate-spin" /> : <Rocket size={16} />}
                  Apply & Rebuild
                </button>
              </>
            )}
            
            {/* Applied - Rebuild or Revert */}
            {status === 'applied' && !showRevertInput && (
              <>
                <button
                  onClick={() => setShowRevertInput(true)}
                  className="flex items-center gap-2 px-4 py-2.5 border border-orange-600 text-orange-400 hover:bg-orange-600/10 rounded-lg transition-colors"
                >
                  <RotateCcw size={16} />
                  Revert Changes
                </button>
                <button
                  onClick={() => rebuildMutation.mutate()}
                  disabled={isPending}
                  className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors font-medium"
                >
                  {isPending ? <RefreshCw size={16} className="animate-spin" /> : <Rocket size={16} />}
                  Rebuild & Deploy
                </button>
              </>
            )}
            
            {/* Revert confirmation */}
            {showRevertInput && (
              <>
                <button
                  onClick={() => setShowRevertInput(false)}
                  className="px-4 py-2.5 border border-gray-700 rounded-lg hover:bg-gray-800 transition-colors text-gray-400"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRevert}
                  disabled={isPending || !revertReason.trim()}
                  className="flex items-center gap-2 px-6 py-2.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white rounded-lg transition-colors font-medium"
                >
                  {isPending ? <RefreshCw size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                  Confirm Revert
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

/**
 * Evolution UI Components - Modal, diff preview, and approval workflow
 */
import { memo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles,
  Play,
  Check,
  X,
  Eye,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Plus,
  Edit3,
  Trash2,
  RotateCcw,
  Clock,
} from 'lucide-react';
import type { CodeEvolution, FileChange, EvolutionStatus } from '../../api/evolutions';
import { formatDistanceToNow } from 'date-fns';

// ============================================
// EvolutionStatusBadge - Status indicator
// ============================================

interface StatusConfig {
  bg: string;
  text: string;
  icon: typeof Sparkles;
  label: string;
}

const statusConfigs: Record<EvolutionStatus, StatusConfig> = {
  pending: { bg: 'bg-gray-500/10', text: 'text-gray-400', icon: Clock, label: 'Pending' },
  analyzing: { bg: 'bg-blue-500/10', text: 'text-blue-400', icon: RefreshCw, label: 'Analyzing' },
  generating: { bg: 'bg-purple-500/10', text: 'text-purple-400', icon: Sparkles, label: 'Generating' },
  review: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', icon: Eye, label: 'Review' },
  approved: { bg: 'bg-green-500/10', text: 'text-green-400', icon: Check, label: 'Approved' },
  rejected: { bg: 'bg-red-500/10', text: 'text-red-400', icon: X, label: 'Rejected' },
  applied: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', icon: Check, label: 'Applied' },
  reverted: { bg: 'bg-orange-500/10', text: 'text-orange-400', icon: RotateCcw, label: 'Reverted' },
  failed: { bg: 'bg-red-500/10', text: 'text-red-400', icon: AlertTriangle, label: 'Failed' },
};

export const EvolutionStatusBadge = memo(function EvolutionStatusBadge({
  status,
}: {
  status: EvolutionStatus;
}) {
  const config = statusConfigs[status];
  const Icon = config.icon;
  const isAnimated = status === 'analyzing' || status === 'generating';

  return (
    <span className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs ${config.bg} ${config.text}`}>
      <Icon size={12} className={isAnimated ? 'animate-spin' : ''} />
      {config.label}
    </span>
  );
});

// ============================================
// EvolutionCard - Summary card for list view
// ============================================

interface EvolutionCardProps {
  evolution: CodeEvolution;
  cycleId: string;
  onView?: (evolution: CodeEvolution) => void;
  onAnalyze?: (evolutionId: string) => void;
  onGenerate?: (evolutionId: string) => void;
  isPending?: boolean;
}

export const EvolutionCard = memo(function EvolutionCard({
  evolution,
  cycleId,
  onView,
  onAnalyze,
  onGenerate,
  isPending,
}: EvolutionCardProps) {
  const navigate = useNavigate();

  const handleViewDetails = useCallback(() => {
    // Navigate to dedicated evolution detail page
    navigate(`/development/${cycleId}/evolution/${evolution.id}`);
    // Also call onView if provided (for backward compatibility)
    onView?.(evolution);
  }, [navigate, cycleId, evolution, onView]);

  return (
    <div className="border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={16} className="text-purple-400 flex-shrink-0" />
            <EvolutionStatusBadge status={evolution.status} />
            <span className="text-xs text-gray-500">
              {formatDistanceToNow(new Date(evolution.createdAt), { addSuffix: true })}
            </span>
          </div>
          <p className="text-sm text-white line-clamp-2">{evolution.prompt}</p>
          {evolution.filesAffected !== null && (
            <p className="text-xs text-gray-400 mt-2">
              {evolution.filesAffected} file{evolution.filesAffected !== 1 ? 's' : ''} affected
            </p>
          )}
          {evolution.error && (
            <p className="text-xs text-red-400 mt-2 line-clamp-1">{evolution.error}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {evolution.status === 'pending' && onAnalyze && (
            <button
              onClick={() => onAnalyze(evolution.id)}
              disabled={isPending}
              className="p-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors"
              title="Start Analysis"
            >
              {isPending ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
            </button>
          )}
          {evolution.status === 'analyzing' && onGenerate && (
            <button
              onClick={() => onGenerate(evolution.id)}
              disabled={isPending}
              className="p-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg transition-colors"
              title="Generate Changes"
            >
              {isPending ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
            </button>
          )}
          <button
            onClick={handleViewDetails}
            className="p-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
            title="View Details"
          >
            <Eye size={14} />
          </button>
        </div>
      </div>
    </div>
  );
});

// ============================================
// DiffPreview - Display file changes as diff
// ============================================

interface DiffPreviewProps {
  changes: FileChange[];
  expanded?: boolean;
}

export const DiffPreview = memo(function DiffPreview({ changes, expanded = true }: DiffPreviewProps) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(
    expanded ? new Set(changes.map((c) => c.path)) : new Set()
  );

  const toggleFile = useCallback((path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const changeTypeConfig = {
    create: { icon: Plus, color: 'text-green-400', bg: 'bg-green-500/10', label: 'New' },
    modify: { icon: Edit3, color: 'text-yellow-400', bg: 'bg-yellow-500/10', label: 'Modified' },
    delete: { icon: Trash2, color: 'text-red-400', bg: 'bg-red-500/10', label: 'Deleted' },
  };

  return (
    <div className="space-y-2">
      {changes.map((change) => {
        const config = changeTypeConfig[change.changeType];
        const Icon = config.icon;
        const isExpanded = expandedFiles.has(change.path);
        const filename = change.path.split('/').pop() || change.path;

        return (
          <div key={change.path} className="border border-gray-700 rounded-lg overflow-hidden">
            {/* File Header */}
            <button
              onClick={() => toggleFile(change.path)}
              className="w-full px-4 py-3 flex items-center justify-between bg-gray-800/50 hover:bg-gray-800 transition-colors"
            >
              <div className="flex items-center gap-3">
                {isExpanded ? (
                  <ChevronDown size={16} className="text-gray-400" />
                ) : (
                  <ChevronRight size={16} className="text-gray-400" />
                )}
                <Icon size={16} className={config.color} />
                <span className="text-sm font-medium text-white">{filename}</span>
                <span className={`px-1.5 py-0.5 rounded text-xs ${config.bg} ${config.color}`}>
                  {config.label}
                </span>
              </div>
              <span className="text-xs text-gray-500">{change.path}</span>
            </button>

            {/* Diff Content */}
            {isExpanded && change.diff && (
              <div className="border-t border-gray-700 p-4 bg-gray-900/50 overflow-x-auto">
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
                        {line}
                      </div>
                    );
                  })}
                </pre>
              </div>
            )}

            {/* New file content */}
            {isExpanded && !change.diff && change.newContent && (
              <div className="border-t border-gray-700 p-4 bg-gray-900/50 overflow-x-auto">
                <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap">
                  {change.newContent}
                </pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});

// ============================================
// EvolutionModal - Full evolution details modal
// ============================================

interface EvolutionModalProps {
  evolution: CodeEvolution | null;
  isOpen: boolean;
  onClose: () => void;
  onApprove?: (evolutionId: string, notes?: string) => void;
  onReject?: (evolutionId: string, notes?: string) => void;
  onApply?: (evolutionId: string) => void;
  onRevert?: (evolutionId: string, reason: string) => void;
  isPending?: boolean;
}

export const EvolutionModal = memo(function EvolutionModal({
  evolution,
  isOpen,
  onClose,
  onApprove,
  onReject,
  onApply,
  onRevert,
  isPending,
}: EvolutionModalProps) {
  const [reviewNotes, setReviewNotes] = useState('');
  const [revertReason, setRevertReason] = useState('');
  const [showRevertInput, setShowRevertInput] = useState(false);

  if (!isOpen || !evolution) return null;

  const canReview = evolution.status === 'review' && onApprove && onReject;
  const canApply = evolution.status === 'approved' && onApply;
  const canRevert = evolution.status === 'applied' && onRevert;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <Sparkles size={20} className="text-purple-400" />
            <h2 className="text-lg font-semibold text-white">Code Evolution</h2>
            <EvolutionStatusBadge status={evolution.status} />
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Prompt */}
          <div className="bg-gray-800/50 rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-400 mb-2">Request</h3>
            <p className="text-white">{evolution.prompt}</p>
          </div>

          {/* Analysis Result */}
          {evolution.analysisResult && (
            <div className="bg-gray-800/50 rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-400 mb-2">Analysis</h3>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Impact:</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      evolution.analysisResult.impactLevel === 'high'
                        ? 'bg-red-500/20 text-red-400'
                        : evolution.analysisResult.impactLevel === 'medium'
                          ? 'bg-yellow-500/20 text-yellow-400'
                          : 'bg-green-500/20 text-green-400'
                    }`}
                  >
                    {evolution.analysisResult.impactLevel?.toUpperCase() || 'UNKNOWN'}
                  </span>
                </div>
                {evolution.analysisResult.affectedFiles.length > 0 && (
                  <div>
                    <span className="text-xs text-gray-500">Affected Files:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {evolution.analysisResult.affectedFiles.map((file) => (
                        <span
                          key={file}
                          className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded"
                        >
                          {file}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {evolution.analysisResult.risks.length > 0 && (
                  <div>
                    <span className="text-xs text-gray-500">Risk Factors:</span>
                    <ul className="list-disc list-inside mt-1 space-y-1">
                      {evolution.analysisResult.risks.map((risk: string, idx: number) => (
                        <li key={idx} className="text-xs text-orange-400">
                          {risk}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Proposed Changes */}
          {evolution.proposedChanges && evolution.proposedChanges.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-400 mb-2">
                Proposed Changes ({evolution.proposedChanges.length} files)
              </h3>
              <DiffPreview changes={evolution.proposedChanges} />
            </div>
          )}

          {/* Error */}
          {evolution.error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle size={20} className="text-red-400 flex-shrink-0" />
                <div>
                  <h3 className="text-sm font-medium text-red-400">Error</h3>
                  <p className="text-sm text-gray-400 mt-1">{evolution.error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Revert Input */}
          {showRevertInput && (
            <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4">
              <h3 className="text-sm font-medium text-orange-400 mb-2">Revert Reason</h3>
              <textarea
                value={revertReason}
                onChange={(e) => setRevertReason(e.target.value)}
                placeholder="Why are you reverting this evolution?"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
                rows={2}
              />
            </div>
          )}

          {/* Review Notes */}
          {canReview && (
            <div className="bg-gray-800/50 rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-400 mb-2">Review Notes (optional)</h3>
              <textarea
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder="Add notes about your decision..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                rows={2}
              />
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between p-4 border-t border-gray-700">
          <div className="text-xs text-gray-500">
            Created {formatDistanceToNow(new Date(evolution.createdAt), { addSuffix: true })}
          </div>
          <div className="flex items-center gap-2">
            {canReview && (
              <>
                <button
                  onClick={() => onReject(evolution.id, reviewNotes)}
                  disabled={isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg transition-colors"
                >
                  {isPending ? <RefreshCw size={14} className="animate-spin" /> : <X size={14} />}
                  Reject
                </button>
                <button
                  onClick={() => onApprove(evolution.id, reviewNotes)}
                  disabled={isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg transition-colors"
                >
                  {isPending ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                  Approve
                </button>
              </>
            )}
            {canApply && (
              <button
                onClick={() => onApply(evolution.id)}
                disabled={isPending}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                {isPending ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
                Apply Changes
              </button>
            )}
            {canRevert && !showRevertInput && (
              <button
                onClick={() => setShowRevertInput(true)}
                className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors"
              >
                <RotateCcw size={14} />
                Revert
              </button>
            )}
            {showRevertInput && (
              <>
                <button
                  onClick={() => setShowRevertInput(false)}
                  className="px-4 py-2 text-sm border border-gray-700 rounded-lg hover:bg-gray-800 transition-colors text-gray-400"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    onRevert?.(evolution.id, revertReason);
                    setShowRevertInput(false);
                  }}
                  disabled={isPending || !revertReason.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white rounded-lg transition-colors"
                >
                  {isPending ? <RefreshCw size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                  Confirm Revert
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

// ============================================
// CreateEvolutionModal - Create new evolution
// ============================================

interface CreateEvolutionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (prompt: string, scope?: string[]) => void;
  isPending?: boolean;
  availableFiles?: string[];
}

export const CreateEvolutionModal = memo(function CreateEvolutionModal({
  isOpen,
  onClose,
  onCreate,
  isPending,
  availableFiles = [],
}: CreateEvolutionModalProps) {
  const [prompt, setPrompt] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [useScope, setUseScope] = useState(false);

  const handleCreate = () => {
    if (!prompt.trim()) return;
    onCreate(prompt, useScope && selectedFiles.size > 0 ? Array.from(selectedFiles) : undefined);
    setPrompt('');
    setSelectedFiles(new Set());
    setUseScope(false);
  };

  const toggleFile = (file: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(file)) {
        next.delete(file);
      } else {
        next.add(file);
      }
      return next;
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-2xl w-full shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <Sparkles size={20} className="text-purple-400" />
            <h2 className="text-lg font-semibold text-white">New Evolution Request</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              What changes would you like to make?
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the changes you want the AI to make to your code..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
              rows={4}
              autoFocus
            />
          </div>

          {/* Scope selector */}
          {availableFiles.length > 0 && (
            <div>
              <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useScope}
                  onChange={(e) => setUseScope(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-800 text-purple-500 focus:ring-purple-500"
                />
                Limit changes to specific files
              </label>

              {useScope && (
                <div className="mt-2 max-h-40 overflow-y-auto border border-gray-700 rounded-lg">
                  {availableFiles.map((file) => (
                    <label
                      key={file}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-gray-800 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedFiles.has(file)}
                        onChange={() => toggleFile(file)}
                        className="rounded border-gray-600 bg-gray-800 text-purple-500 focus:ring-purple-500"
                      />
                      <span className="text-sm text-gray-300">{file}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-700 rounded-lg hover:bg-gray-800 transition-colors text-gray-400"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={isPending || !prompt.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {isPending ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
            Create Evolution
          </button>
        </div>
      </div>
    </div>
  );
});

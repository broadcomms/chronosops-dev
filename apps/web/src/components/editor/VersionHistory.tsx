/**
 * FileVersionHistory - Display version history for generated files
 */
import { memo, useState } from 'react';
import {
  History,
  RotateCcw,
  User,
  Sparkles,
  Settings,
  ChevronDown,
  ChevronRight,
  GitCommit,
  Clock,
  Eye,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import type { FileVersion, ChangeType, ChangedBy } from '../../api/file-versions';

// ============================================
// Version badge styling
// ============================================

const changeTypeConfig: Record<ChangeType, { icon: typeof History; color: string; label: string }> = {
  create: { icon: GitCommit, color: 'text-green-400', label: 'Created' },
  edit: { icon: User, color: 'text-blue-400', label: 'Edited' },
  evolution: { icon: Sparkles, color: 'text-purple-400', label: 'AI Evolution' },
  revert: { icon: RotateCcw, color: 'text-orange-400', label: 'Reverted' },
};

const changedByConfig: Record<ChangedBy, { icon: typeof User; color: string; label: string }> = {
  user: { icon: User, color: 'text-blue-400', label: 'User' },
  ai: { icon: Sparkles, color: 'text-purple-400', label: 'AI' },
  system: { icon: Settings, color: 'text-gray-400', label: 'System' },
};

// ============================================
// VersionBadge - Shows change type
// ============================================

interface VersionBadgeProps {
  changeType: ChangeType;
  changedBy: ChangedBy;
}

export const VersionBadge = memo(function VersionBadge({ changeType, changedBy }: VersionBadgeProps) {
  const typeConfig = changeTypeConfig[changeType];
  const byConfig = changedByConfig[changedBy];
  const Icon = typeConfig.icon;

  return (
    <div className="flex items-center gap-2">
      <span className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-gray-800 ${typeConfig.color}`}>
        <Icon size={10} />
        {typeConfig.label}
      </span>
      <span className={`flex items-center gap-1 text-xs ${byConfig.color}`}>
        by {byConfig.label}
      </span>
    </div>
  );
});

// ============================================
// VersionItem - Single version in the timeline
// ============================================

interface VersionItemProps {
  version: FileVersion;
  isLatest: boolean;
  isCurrent?: boolean;
  onRestore?: (versionId: string) => void;
  onPreview?: (version: FileVersion) => void;
  isRestoring?: boolean;
}

export const VersionItem = memo(function VersionItem({
  version,
  isLatest,
  isCurrent = false,
  onRestore,
  onPreview,
  isRestoring,
}: VersionItemProps) {
  return (
    <div
      className={`relative pl-6 pb-4 ${
        isCurrent ? 'border-l-2 border-blue-500' : 'border-l border-gray-700'
      }`}
    >
      {/* Timeline dot */}
      <div
        className={`absolute left-0 top-0 w-3 h-3 rounded-full -translate-x-[7px] ${
          isCurrent ? 'bg-blue-500' : isLatest ? 'bg-green-500' : 'bg-gray-600'
        }`}
      />

      <div className="bg-gray-800/50 rounded-lg p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium text-white">v{version.version}</span>
              {isLatest && (
                <span className="px-1.5 py-0.5 text-xs bg-green-500/20 text-green-400 rounded">
                  Latest
                </span>
              )}
              {isCurrent && (
                <span className="px-1.5 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded">
                  Current
                </span>
              )}
            </div>
            <VersionBadge changeType={version.changeType} changedBy={version.changedBy} />
            {version.changeDescription && (
              <p className="text-xs text-gray-400 mt-1 line-clamp-2">{version.changeDescription}</p>
            )}
            {version.commitHash && (
              <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
                <GitCommit size={10} />
                <span className="font-mono">{version.commitHash.substring(0, 7)}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            {onPreview && (
              <button
                onClick={() => onPreview(version)}
                className="p-1.5 hover:bg-gray-700 rounded transition-colors"
                title="Preview this version"
              >
                <Eye size={14} className="text-gray-400" />
              </button>
            )}
            {onRestore && !isLatest && (
              <button
                onClick={() => onRestore(version.id)}
                disabled={isRestoring}
                className="p-1.5 hover:bg-gray-700 rounded transition-colors disabled:opacity-50"
                title="Restore this version"
              >
                <RotateCcw size={14} className={isRestoring ? 'animate-spin text-blue-400' : 'text-gray-400'} />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
          <Clock size={10} />
          <span title={format(new Date(version.createdAt), 'PPpp')}>
            {formatDistanceToNow(new Date(version.createdAt), { addSuffix: true })}
          </span>
        </div>
      </div>
    </div>
  );
});

// ============================================
// FileVersionHistory - Main component
// ============================================

interface FileVersionHistoryProps {
  versions: FileVersion[];
  currentVersionId?: string;
  isLoading?: boolean;
  onRestore?: (versionId: string) => void;
  onPreview?: (version: FileVersion) => void;
  isRestoring?: boolean;
  className?: string;
}

export const FileVersionHistory = memo(function FileVersionHistory({
  versions,
  currentVersionId,
  isLoading,
  onRestore,
  onPreview,
  isRestoring,
  className = '',
}: FileVersionHistoryProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  // Sort versions by version number descending
  const sortedVersions = [...versions].sort((a, b) => b.version - a.version);

  if (isLoading) {
    return (
      <div className={`bg-gray-900/50 rounded-lg p-4 ${className}`}>
        <div className="flex items-center gap-2 text-gray-400">
          <History size={16} className="animate-pulse" />
          <span className="text-sm">Loading version history...</span>
        </div>
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div className={`bg-gray-900/50 rounded-lg p-4 ${className}`}>
        <div className="flex items-center gap-2 text-gray-500">
          <History size={16} />
          <span className="text-sm">No version history available</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-gray-900/50 rounded-lg ${className}`}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-800/50 transition-colors rounded-t-lg"
      >
        <div className="flex items-center gap-2">
          <History size={16} className="text-gray-400" />
          <span className="text-sm font-medium text-white">Version History</span>
          <span className="text-xs text-gray-500">({versions.length})</span>
        </div>
        {isExpanded ? (
          <ChevronDown size={16} className="text-gray-400" />
        ) : (
          <ChevronRight size={16} className="text-gray-400" />
        )}
      </button>

      {/* Version List */}
      {isExpanded && (
        <div className="px-4 pb-4">
          <div className="space-y-0">
            {sortedVersions.map((version, index) => (
              <VersionItem
                key={version.id}
                version={version}
                isLatest={index === 0}
                isCurrent={version.id === currentVersionId}
                onRestore={onRestore}
                onPreview={onPreview}
                isRestoring={isRestoring}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

// ============================================
// VersionCompareView - Compare two versions
// ============================================

interface VersionCompareViewProps {
  fromVersion: FileVersion;
  toVersion: FileVersion;
  diff: string;
  onClose: () => void;
}

export const VersionCompareView = memo(function VersionCompareView({
  fromVersion,
  toVersion,
  diff,
  onClose,
}: VersionCompareViewProps) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <History size={20} className="text-blue-400" />
            <h2 className="text-lg font-semibold text-white">Version Comparison</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors text-gray-400"
          >
            ✕
          </button>
        </div>

        {/* Version Info */}
        <div className="flex items-center justify-between p-4 bg-gray-800/50 border-b border-gray-700">
          <div>
            <span className="text-xs text-gray-500">From:</span>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm font-medium text-white">v{fromVersion.version}</span>
              <VersionBadge changeType={fromVersion.changeType} changedBy={fromVersion.changedBy} />
            </div>
          </div>
          <div className="text-gray-500">→</div>
          <div>
            <span className="text-xs text-gray-500">To:</span>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm font-medium text-white">v{toVersion.version}</span>
              <VersionBadge changeType={toVersion.changeType} changedBy={toVersion.changedBy} />
            </div>
          </div>
        </div>

        {/* Diff Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <pre className="text-xs font-mono">
            {diff.split('\n').map((line, idx) => {
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
      </div>
    </div>
  );
});

/**
 * EditableCodeViewer - Monaco editor with lock, evolution, and version history
 * Simplified version for initial integration
 */
import { memo, useState, useCallback, useMemo, useEffect } from 'react';
import {
  FileCode,
  Sparkles,
  History,
  Save,
  X,
  ChevronRight,
  GitBranch,
  Edit3,
} from 'lucide-react';
import { CodeEditor } from './CodeEditor';
import { LockStatus, LockTimer, LockWarningModal, useLockWarning } from './LockUI';
import { FileVersionHistory } from './VersionHistory';
import {
  CreateEvolutionModal,
  EvolutionCard,
  EvolutionModal,
} from './EvolutionUI';
import type { GeneratedFile } from '../../types';
import type { LockInfo } from '../../api/edit-locks';
import type { CodeEvolution } from '../../api/evolutions';
import type { FileVersion } from '../../api/file-versions';
import type { GitStatusResult } from '../../api/git';

// ============================================
// File Tab Component
// ============================================

interface FileTabProps {
  file: GeneratedFile;
  isActive: boolean;
  isModified: boolean;
  onClick: () => void;
}

const FileTab = memo(function FileTab({ file, isActive, isModified, onClick }: FileTabProps) {
  const filename = file.path.split('/').pop() || file.path;

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 text-sm border-b-2 transition-colors ${
        isActive
          ? 'border-blue-500 text-white bg-gray-800'
          : 'border-transparent text-gray-400 hover:text-white hover:bg-gray-800/50'
      }`}
    >
      <FileCode size={14} />
      <span>{filename}</span>
      {isModified && <span className="w-2 h-2 bg-orange-400 rounded-full" />}
    </button>
  );
});

// ============================================
// Main EditableCodeViewer Component
// ============================================

interface EditableCodeViewerProps {
  files: GeneratedFile[];
  cycleId: string;
  userId: string;
  
  // Lock state
  lockInfo?: LockInfo;
  isEditable?: boolean;
  
  // File operations
  onFileChange?: (path: string, content: string) => void;
  onSave?: (path: string, content: string) => void;
  onDiscard?: () => void;
  onAcquireLock?: () => void;
  onReleaseLock?: () => void;
  
  // Evolution state
  evolutions?: CodeEvolution[];
  onCreateEvolution?: (prompt: string, scope?: string[]) => Promise<void>;
  onAnalyzeEvolution?: (evolutionId: string) => Promise<void>;
  onGenerateEvolution?: (evolutionId: string) => Promise<void>;
  onApproveEvolution?: (evolutionId: string) => Promise<void>;
  onRejectEvolution?: (evolutionId: string, reason?: string) => Promise<void>;
  onApplyEvolution?: (evolutionId: string) => Promise<void>;
  onRevertEvolution?: (evolutionId: string, reason?: string) => Promise<void>;
  
  // Version history
  versions?: FileVersion[];
  onRestoreVersion?: (versionId: string, fileId?: string) => Promise<void>;
  
  // Git status (optional)
  gitStatus?: GitStatusResult | null;
  
  className?: string;
}

export const EditableCodeViewer = memo(function EditableCodeViewer({
  files,
  cycleId,
  userId,
  lockInfo,
  isEditable = false,
  onFileChange,
  onSave,
  onDiscard,
  onAcquireLock,
  onReleaseLock,
  evolutions = [],
  onCreateEvolution,
  onAnalyzeEvolution,
  onGenerateEvolution,
  onApproveEvolution,
  onRejectEvolution,
  onApplyEvolution,
  onRevertEvolution,
  versions = [],
  onRestoreVersion,
  gitStatus,
  className = '',
}: EditableCodeViewerProps) {
  // Active file state
  const [activeFileId, setActiveFileId] = useState<string>(files[0]?.id || '');
  const activeFile = useMemo(
    () => files.find((f) => f.id === activeFileId) || files[0],
    [files, activeFileId]
  );

  // Edit state
  const [editedContent, setEditedContent] = useState<Record<string, string>>({});
  const [showCreateEvolution, setShowCreateEvolution] = useState(false);
  const [selectedEvolution, setSelectedEvolution] = useState<CodeEvolution | null>(null);

  // View mode
  const [viewMode, setViewMode] = useState<'code' | 'versions' | 'evolutions'>('code');
  const [showRightPanel, setShowRightPanel] = useState(true);

  // Lock warning state
  const { showWarning, dismissWarning } = useLockWarning(
    lockInfo?.lock,
    lockInfo?.isOwnLock ?? false
  );

  // Check if current file has unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    return Object.keys(editedContent).some(
      (fileId) => editedContent[fileId] !== files.find((f) => f.id === fileId)?.content
    );
  }, [editedContent, files]);

  // Filter versions for active file
  const activeFileVersions = useMemo(
    () => versions.filter((v) => v.generatedFileId === activeFileId),
    [versions, activeFileId]
  );

  // Is editing allowed? Use isEditable prop or lock ownership
  const canEdit = isEditable || (lockInfo?.isOwnLock ?? false);
  const isLockedByOther = (lockInfo?.isLocked && !lockInfo?.isOwnLock) ?? false;

  // Handle content change
  const handleContentChange = useCallback(
    (content: string) => {
      if (activeFile) {
        setEditedContent((prev) => ({
          ...prev,
          [activeFile.id]: content,
        }));
        // Notify parent of change
        onFileChange?.(activeFile.path, content);
      }
    },
    [activeFile, onFileChange]
  );

  // Handle save
  const handleSaveFile = useCallback(
    (content: string) => {
      if (activeFile && onSave) {
        onSave(activeFile.path, content);
        // Clear edited content after save
        setEditedContent((prev) => {
          const next = { ...prev };
          delete next[activeFile.id];
          return next;
        });
      }
    },
    [activeFile, onSave]
  );

  // Handle restore version
  const handleRestoreVersion = useCallback(
    async (versionId: string) => {
      if (activeFile && onRestoreVersion) {
        await onRestoreVersion(versionId, activeFile.id);
      }
    },
    [activeFile, onRestoreVersion]
  );

  // Get current content (edited or original)
  const currentContent = useMemo(() => {
    if (activeFile) {
      return editedContent[activeFile.id] ?? activeFile.content;
    }
    return '';
  }, [activeFile, editedContent]);

  // Check if current file is modified
  const isCurrentFileModified = useMemo(() => {
    return (
      activeFile &&
      editedContent[activeFile.id] !== undefined &&
      editedContent[activeFile.id] !== activeFile.content
    );
  }, [activeFile, editedContent]);

  // Handle lock release with unsaved changes
  const handleReleaseLock = useCallback(() => {
    if (hasUnsavedChanges) {
      if (confirm('You have unsaved changes. Are you sure you want to stop editing?')) {
        setEditedContent({});
        onDiscard?.();
        onReleaseLock?.();
      }
    } else {
      onReleaseLock?.();
    }
  }, [hasUnsavedChanges, onReleaseLock, onDiscard]);

  // Handle save and release
  const handleSaveAndRelease = useCallback(() => {
    // Save all modified files
    Object.entries(editedContent).forEach(([fileId, content]) => {
      const file = files.find((f) => f.id === fileId);
      if (file && content !== file.content && onSave) {
        onSave(file.path, content);
      }
    });
    setEditedContent({});
    onReleaseLock?.();
    dismissWarning();
  }, [editedContent, files, onSave, onReleaseLock, dismissWarning]);

  // Handle extend - the parent component handles heartbeat automatically
  const handleExtend = useCallback(() => {
    dismissWarning();
  }, [dismissWarning]);

  // Sync activeFileId when files change
  useEffect(() => {
    if (files.length > 0 && !files.find((f) => f.id === activeFileId)) {
      setActiveFileId(files[0].id);
    }
  }, [files, activeFileId]);

  // Suppress unused variable warnings for optional features
  void cycleId;
  void userId;

  if (files.length === 0) {
    return (
      <div className={`bg-gray-900/50 rounded-lg p-8 text-center ${className}`}>
        <FileCode size={48} className="mx-auto text-gray-600 mb-4" />
        <p className="text-gray-400">No files generated yet</p>
      </div>
    );
  }

  return (
    <div className={`bg-gray-900/50 border border-gray-700 rounded-lg overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800/50">
        <div className="flex items-center gap-4">
          <h3 className="text-sm font-medium text-white flex items-center gap-2">
            <FileCode size={16} />
            Generated Code
          </h3>
          {lockInfo && (
            <LockStatus
              lockInfo={lockInfo}
              isLoading={false}
              onAcquire={onAcquireLock}
              onRelease={handleReleaseLock}
              isPending={false}
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* View mode toggles */}
          <div className="flex items-center bg-gray-800 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('code')}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                viewMode === 'code' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              <Edit3 size={12} className="inline mr-1" />
              Code
            </button>
            <button
              onClick={() => setViewMode('versions')}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                viewMode === 'versions' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              <History size={12} className="inline mr-1" />
              History
            </button>
            <button
              onClick={() => setViewMode('evolutions')}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                viewMode === 'evolutions' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              <Sparkles size={12} className="inline mr-1" />
              Evolutions
            </button>
          </div>

          {/* Lock timer when we own the lock */}
          {lockInfo?.isOwnLock && lockInfo.lock && (
            <LockTimer
              expiresAt={lockInfo.lock.expiresAt}
              warningThreshold={300000} // 5 minutes
              criticalThreshold={60000}  // 1 minute
              onWarning={() => {}}
              onCritical={() => {}}
            />
          )}

          {/* Right panel toggle */}
          <button
            onClick={() => setShowRightPanel(!showRightPanel)}
            className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            <ChevronRight
              size={16}
              className={`transition-transform ${showRightPanel ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      </div>

      {/* File Tabs */}
      <div className="flex items-center overflow-x-auto border-b border-gray-700 bg-gray-800/30">
        {files.map((file) => (
          <FileTab
            key={file.id}
            file={file}
            isActive={file.id === activeFileId}
            isModified={editedContent[file.id] !== undefined && editedContent[file.id] !== file.content}
            onClick={() => setActiveFileId(file.id)}
          />
        ))}
      </div>

      {/* Main Content */}
      <div className="flex">
        {/* Editor / Content */}
        <div className={`flex-1 ${showRightPanel ? 'border-r border-gray-700' : ''}`}>
          {viewMode === 'code' && activeFile && (
            <div className="relative">
              <CodeEditor
                value={currentContent}
                language={activeFile.language}
                onChange={handleContentChange}
                onSave={handleSaveFile}
                readOnly={!canEdit}
                isLocked={isLockedByOther}
                lockOwner={lockInfo?.lock?.lockedByName || lockInfo?.lock?.lockedBy}
                height="500px"
              />

              {/* Save button overlay */}
              {isCurrentFileModified && canEdit && (
                <div className="absolute bottom-4 right-4 flex items-center gap-2">
                  <button
                    onClick={() => {
                      // Discard changes
                      setEditedContent((prev) => {
                        const next = { ...prev };
                        delete next[activeFile.id];
                        return next;
                      });
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors"
                  >
                    <X size={14} />
                    Discard
                  </button>
                  <button
                    onClick={() => handleSaveFile(currentContent)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
                  >
                    <Save size={14} />
                    Save (⌘S)
                  </button>
                </div>
              )}
            </div>
          )}

          {viewMode === 'versions' && (
            <div className="p-4">
              <FileVersionHistory
                versions={activeFileVersions}
                isLoading={false}
                onRestore={handleRestoreVersion}
                isRestoring={false}
              />
            </div>
          )}

          {viewMode === 'evolutions' && (
            <div className="p-4">
              {evolutions.length === 0 ? (
                <div className="text-center py-8">
                  <Sparkles size={32} className="mx-auto text-gray-600 mb-3" />
                  <p className="text-gray-400 mb-4">No evolutions yet</p>
                  <button
                    onClick={() => setShowCreateEvolution(true)}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
                  >
                    Create Evolution
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-sm font-medium text-white">
                      {evolutions.length} Evolution{evolutions.length !== 1 ? 's' : ''}
                    </h4>
                    <button
                      onClick={() => setShowCreateEvolution(true)}
                      className="px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
                    >
                      New Evolution
                    </button>
                  </div>
                  {evolutions.map((evolution) => (
                    <EvolutionCard
                      key={evolution.id}
                      evolution={evolution}
                      cycleId={cycleId}
                      onView={() => setSelectedEvolution(evolution)}
                      onAnalyze={onAnalyzeEvolution ? (id) => onAnalyzeEvolution(id) : undefined}
                      onGenerate={onGenerateEvolution ? (id) => onGenerateEvolution(id) : undefined}
                      isPending={false}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Panel - File Info */}
        {showRightPanel && (
          <div className="w-64 p-4 bg-gray-900/30">
            {activeFile && (
              <div className="space-y-4">
                <div>
                  <h4 className="text-xs text-gray-500 uppercase mb-1">File</h4>
                  <p className="text-sm text-white truncate" title={activeFile.path}>
                    {activeFile.path}
                  </p>
                </div>
                <div>
                  <h4 className="text-xs text-gray-500 uppercase mb-1">Language</h4>
                  <p className="text-sm text-blue-400">{activeFile.language}</p>
                </div>
                <div>
                  <h4 className="text-xs text-gray-500 uppercase mb-1">Purpose</h4>
                  <p className="text-sm text-gray-300">{activeFile.purpose}</p>
                </div>
                {gitStatus && (
                  <div>
                    <h4 className="text-xs text-gray-500 uppercase mb-1 flex items-center gap-1">
                      <GitBranch size={12} />
                      Git Status
                    </h4>
                    <p className="text-sm text-gray-300">
                      {gitStatus.hasChanges
                        ? `${gitStatus.staged.length} staged, ${gitStatus.unstaged.length} unstaged`
                        : 'Clean'}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Lock Warning Modal */}
      {showWarning && lockInfo?.lock && (
        <LockWarningModal
          isOpen={showWarning}
          remainingMs={lockInfo.remainingMs}
          canExtend={lockInfo.canExtend}
          onExtend={handleExtend}
          onSaveAndRelease={handleSaveAndRelease}
          onDismiss={dismissWarning}
          unsavedChanges={hasUnsavedChanges}
        />
      )}

      {/* Create Evolution Modal */}
      {showCreateEvolution && onCreateEvolution && (
        <CreateEvolutionModal
          isOpen={showCreateEvolution}
          availableFiles={files.map((f) => f.path)}
          onCreate={async (prompt: string, scope?: string[]) => {
            await onCreateEvolution(prompt, scope);
            setShowCreateEvolution(false);
          }}
          onClose={() => setShowCreateEvolution(false)}
          isPending={false}
        />
      )}

      {/* Evolution Detail Modal */}
      {selectedEvolution && (
        <EvolutionModal
          evolution={selectedEvolution}
          isOpen={!!selectedEvolution}
          onClose={() => setSelectedEvolution(null)}
          onApprove={onApproveEvolution}
          onReject={onRejectEvolution}
          onApply={onApplyEvolution}
          onRevert={onRevertEvolution}
          isPending={false}
        />
      )}
    </div>
  );
});

export default EditableCodeViewer;

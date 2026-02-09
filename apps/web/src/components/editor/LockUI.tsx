/**
 * Lock UI Components - Status display, warning modal, and controls
 */
import { memo, useEffect, useState, useCallback } from 'react';
import { Lock, Unlock, AlertTriangle, Clock, User, RefreshCw } from 'lucide-react';
import type { EditLock, LockInfo } from '../../api/edit-locks';

// ============================================
// LockStatus - Displays current lock status
// ============================================

interface LockStatusProps {
  lockInfo: LockInfo | undefined;
  isLoading?: boolean;
  onAcquire?: () => void;
  onRelease?: () => void;
  isPending?: boolean;
}

export const LockStatus = memo(function LockStatus({
  lockInfo,
  isLoading,
  onAcquire,
  onRelease,
  isPending,
}: LockStatusProps) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-800/50 rounded-lg">
        <RefreshCw size={14} className="animate-spin text-gray-400" />
        <span className="text-sm text-gray-400">Checking lock...</span>
      </div>
    );
  }

  if (!lockInfo) {
    return null;
  }

  const { isLocked, isOwnLock, lock, remainingMs } = lockInfo;

  // Suppress unused variable warning - canExtend may be used in future
  void lockInfo.canExtend;

  // Format remaining time
  const formatRemaining = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  };

  if (!isLocked) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-800/50 rounded-lg">
          <Unlock size={14} className="text-gray-400" />
          <span className="text-sm text-gray-400">Not editing</span>
        </div>
        {onAcquire && (
          <button
            onClick={onAcquire}
            disabled={isPending}
            className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {isPending ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <Lock size={14} />
            )}
            Start Editing
          </button>
        )}
      </div>
    );
  }

  if (isOwnLock && lock) {
    const isWarning = remainingMs < 300000; // Less than 5 minutes
    const isCritical = remainingMs < 60000; // Less than 1 minute

    return (
      <div className="flex items-center gap-2">
        <div
          className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
            isCritical
              ? 'bg-red-500/20 border border-red-500/50'
              : isWarning
                ? 'bg-yellow-500/20 border border-yellow-500/50'
                : 'bg-green-500/20 border border-green-500/50'
          }`}
        >
          <Lock
            size={14}
            className={isCritical ? 'text-red-400' : isWarning ? 'text-yellow-400' : 'text-green-400'}
          />
          <span
            className={`text-sm ${
              isCritical ? 'text-red-400' : isWarning ? 'text-yellow-400' : 'text-green-400'
            }`}
          >
            Editing
          </span>
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <Clock size={12} />
            <span>{formatRemaining(remainingMs)}</span>
          </div>
        </div>
        {onRelease && (
          <button
            onClick={onRelease}
            disabled={isPending}
            className="flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {isPending ? <RefreshCw size={14} className="animate-spin" /> : <Unlock size={14} />}
            Stop Editing
          </button>
        )}
      </div>
    );
  }

  // Locked by someone else
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-yellow-500/20 border border-yellow-500/50 rounded-lg">
      <Lock size={14} className="text-yellow-400" />
      <span className="text-sm text-yellow-400">Locked by</span>
      <div className="flex items-center gap-1 text-sm text-white">
        <User size={12} />
        <span>{lock?.lockedByName || lock?.lockedBy || 'Another user'}</span>
      </div>
    </div>
  );
});

// ============================================
// LockWarningModal - Warning when lock is expiring
// ============================================

interface LockWarningModalProps {
  isOpen: boolean;
  remainingMs: number;
  canExtend: boolean;
  onExtend: () => void;
  onSaveAndRelease: () => void;
  onDismiss: () => void;
  isPending?: boolean;
  unsavedChanges?: boolean;
}

export const LockWarningModal = memo(function LockWarningModal({
  isOpen,
  remainingMs,
  canExtend,
  onExtend,
  onSaveAndRelease,
  onDismiss,
  isPending,
  unsavedChanges,
}: LockWarningModalProps) {
  if (!isOpen) return null;

  const seconds = Math.floor(remainingMs / 1000);
  const isCritical = seconds < 60;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-yellow-500/50 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
        <div className="flex items-start gap-4">
          <div
            className={`p-3 rounded-lg ${isCritical ? 'bg-red-500/20' : 'bg-yellow-500/20'}`}
          >
            <AlertTriangle
              size={24}
              className={isCritical ? 'text-red-400' : 'text-yellow-400'}
            />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white">
              {isCritical ? 'Lock Expiring Soon!' : 'Lock Warning'}
            </h3>
            <p className="text-sm text-gray-400 mt-2">
              Your editing session will expire in{' '}
              <span className={`font-bold ${isCritical ? 'text-red-400' : 'text-yellow-400'}`}>
                {seconds}
              </span>{' '}
              seconds.
            </p>
            {unsavedChanges && (
              <p className="text-sm text-orange-400 mt-2">
                ⚠️ You have unsaved changes that may be lost.
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onDismiss}
            className="px-4 py-2 text-sm border border-gray-700 rounded-lg hover:bg-gray-800 transition-colors text-gray-400"
          >
            Dismiss
          </button>
          {unsavedChanges && (
            <button
              onClick={onSaveAndRelease}
              disabled={isPending}
              className="px-4 py-2 text-sm bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white rounded-lg transition-colors flex items-center gap-2"
            >
              {isPending && <RefreshCw size={14} className="animate-spin" />}
              Save & Release
            </button>
          )}
          {canExtend && (
            <button
              onClick={onExtend}
              disabled={isPending}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors flex items-center gap-2"
            >
              {isPending && <RefreshCw size={14} className="animate-spin" />}
              Extend Session
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

// ============================================
// LockTimer - Countdown timer for lock expiry
// ============================================

interface LockTimerProps {
  expiresAt: string;
  onWarning?: () => void;
  onCritical?: () => void;
  warningThreshold?: number; // ms
  criticalThreshold?: number; // ms
}

export const LockTimer = memo(function LockTimer({
  expiresAt,
  onWarning,
  onCritical,
  warningThreshold = 300000, // 5 minutes
  criticalThreshold = 60000, // 1 minute
}: LockTimerProps) {
  const [remainingMs, setRemainingMs] = useState(0);
  const [warningTriggered, setWarningTriggered] = useState(false);
  const [criticalTriggered, setCriticalTriggered] = useState(false);

  useEffect(() => {
    const updateRemaining = () => {
      const remaining = new Date(expiresAt).getTime() - Date.now();
      setRemainingMs(Math.max(0, remaining));

      // Trigger warnings
      if (remaining <= criticalThreshold && !criticalTriggered) {
        setCriticalTriggered(true);
        onCritical?.();
      } else if (remaining <= warningThreshold && !warningTriggered) {
        setWarningTriggered(true);
        onWarning?.();
      }
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 1000);

    return () => clearInterval(interval);
  }, [expiresAt, warningThreshold, criticalThreshold, onWarning, onCritical, warningTriggered, criticalTriggered]);

  // Reset triggers when expiresAt changes (lock extended)
  useEffect(() => {
    setWarningTriggered(false);
    setCriticalTriggered(false);
  }, [expiresAt]);

  const minutes = Math.floor(remainingMs / 60000);
  const seconds = Math.floor((remainingMs % 60000) / 1000);

  const isCritical = remainingMs < criticalThreshold;
  const isWarning = remainingMs < warningThreshold;

  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono ${
        isCritical
          ? 'bg-red-500/20 text-red-400'
          : isWarning
            ? 'bg-yellow-500/20 text-yellow-400'
            : 'bg-gray-700/50 text-gray-400'
      }`}
    >
      <Clock size={12} />
      <span>
        {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
      </span>
    </div>
  );
});

// ============================================
// useLockWarning - Hook to manage lock warnings
// ============================================

export function useLockWarning(
  lock: EditLock | undefined,
  isOwnLock: boolean
) {
  const [showWarning, setShowWarning] = useState(false);
  const [warningLevel, setWarningLevel] = useState<'warning' | 'critical' | null>(null);

  const handleWarning = useCallback(() => {
    if (isOwnLock) {
      setWarningLevel('warning');
      setShowWarning(true);
    }
  }, [isOwnLock]);

  const handleCritical = useCallback(() => {
    if (isOwnLock) {
      setWarningLevel('critical');
      setShowWarning(true);
    }
  }, [isOwnLock]);

  const dismissWarning = useCallback(() => {
    setShowWarning(false);
  }, []);

  // Reset when lock changes
  useEffect(() => {
    setShowWarning(false);
    setWarningLevel(null);
  }, [lock?.id]);

  return {
    showWarning,
    warningLevel,
    handleWarning,
    handleCritical,
    dismissWarning,
  };
}

/**
 * Failed Incident Panel
 * Displays detailed information when an investigation fails
 * Provides actions for human intervention
 */

import { useCallback, useState } from 'react';
import type { ActionItem } from '../ActionLog';

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

interface FailedIncidentPanelProps {
  incidentId: string;
  failReason: string;
  failureDetails?: FailureDetails;
  onRetryInvestigation?: () => void;
  onViewEvidence?: () => void;
  onViewPostmortem?: () => void;
}

export function FailedIncidentPanel({
  incidentId: _incidentId,
  failReason,
  failureDetails,
  onRetryInvestigation,
  onViewEvidence,
  onViewPostmortem,
}: FailedIncidentPanelProps) {
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = useCallback(async () => {
    if (!onRetryInvestigation || isRetrying) return;
    setIsRetrying(true);
    try {
      await onRetryInvestigation();
    } finally {
      setIsRetrying(false);
    }
  }, [onRetryInvestigation, isRetrying]);

  return (
    <div className="rounded-lg border border-red-500/50 bg-red-500/5 overflow-hidden">
      {/* Header */}
      <div className="bg-red-500/20 px-4 py-3 border-b border-red-500/30">
        <div className="flex items-center gap-2">
          <svg
            className="h-5 w-5 text-red-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <span className="font-semibold text-red-400">
            Investigation Failed - Human Intervention Required
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="p-4 space-y-4">
        {/* Failure Reason */}
        <div>
          <h4 className="text-sm font-medium text-gray-400 mb-1">Failure Reason</h4>
          <p className="text-sm text-red-300">{failReason}</p>
        </div>

        {/* Failure Details */}
        {failureDetails && (
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Phase where failure occurred */}
            <div className="bg-gray-800/50 rounded-lg p-3">
              <h4 className="text-xs font-medium text-gray-500 mb-1">Failed In Phase</h4>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={`h-2 w-2 rounded-full ${getPhaseColor(failureDetails.phase)}`}
                />
                <span className="text-sm font-medium text-gray-300">
                  {failureDetails.phase}
                </span>
              </span>
            </div>

            {/* Retry Attempts */}
            <div className="bg-gray-800/50 rounded-lg p-3">
              <h4 className="text-xs font-medium text-gray-500 mb-1">Retry Attempts</h4>
              <span className="text-sm font-medium text-gray-300">
                {failureDetails.retryAttempts} / 3
              </span>
            </div>

            {/* Last Action */}
            {failureDetails.lastAction && (
              <div className="bg-gray-800/50 rounded-lg p-3 sm:col-span-2">
                <h4 className="text-xs font-medium text-gray-500 mb-1">Last Action Attempted</h4>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      failureDetails.lastAction.status === 'completed'
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-red-500/20 text-red-400'
                    }`}
                  >
                    {failureDetails.lastAction.type}
                  </span>
                  <span className="text-sm text-gray-400">
                    on{' '}
                    <code className="text-xs bg-gray-700/50 px-1 rounded">
                      {failureDetails.lastAction.target}
                    </code>
                  </span>
                </div>
              </div>
            )}

            {/* Last Verification Result */}
            {failureDetails.lastVerificationResult && (
              <div className="bg-gray-800/50 rounded-lg p-3 sm:col-span-2">
                <h4 className="text-xs font-medium text-gray-500 mb-1">
                  Last Verification Result
                </h4>
                <div className="flex items-start gap-2">
                  {failureDetails.lastVerificationResult.success ? (
                    <svg
                      className="h-4 w-4 text-green-400 mt-0.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="h-4 w-4 text-red-400 mt-0.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  )}
                  <p className="text-sm text-gray-400">
                    {failureDetails.lastVerificationResult.details}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Timestamp */}
        {failureDetails?.timestamp && (
          <div className="text-xs text-gray-500">
            Failed at: {new Date(failureDetails.timestamp).toLocaleString()}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-800">
          {onViewEvidence && (
            <button
              onClick={onViewEvidence}
              className="flex items-center gap-1.5 rounded-lg bg-gray-700 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-gray-600 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              View Evidence
            </button>
          )}

          {onViewPostmortem && (
            <button
              onClick={onViewPostmortem}
              className="flex items-center gap-1.5 rounded-lg bg-gray-700 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-gray-600 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              View Partial Analysis
            </button>
          )}

          {onRetryInvestigation && (
            <button
              onClick={handleRetry}
              disabled={isRetrying}
              className="flex items-center gap-1.5 rounded-lg bg-red-500/20 px-3 py-2 text-sm font-medium text-red-300 hover:bg-red-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRetrying ? (
                <>
                  <svg
                    className="h-4 w-4 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Retrying...
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  Retry Investigation
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function getPhaseColor(phase: string): string {
  const colors: Record<string, string> = {
    OBSERVING: 'bg-observe',
    ORIENTING: 'bg-orient',
    DECIDING: 'bg-decide',
    ACTING: 'bg-act',
    VERIFYING: 'bg-verify',
    DONE: 'bg-green-500',
    FAILED: 'bg-red-500',
  };
  return colors[phase] ?? 'bg-gray-500';
}

export default FailedIncidentPanel;

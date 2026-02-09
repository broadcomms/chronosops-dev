/**
 * AIReasoningPanel - Display AI thinking process and thought signatures
 */
import { memo, useState } from 'react';
import {
  Brain,
  Eye,
  Lightbulb,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Hash,
  FileText,
} from 'lucide-react';
import type { VerificationResult, VerificationCheck } from '../../types';

interface AIReasoningPanelProps {
  thoughtSignature: string | null;
  verification: VerificationResult | null;
  className?: string;
}

interface VerificationCheckItemProps {
  check: VerificationCheck;
}

const VerificationCheckItem = memo(function VerificationCheckItem({ check }: VerificationCheckItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const typeIcons: Record<string, typeof Eye> = {
    endpoint: Eye,
    health: CheckCircle,
    functionality: Lightbulb,
    performance: Sparkles,
  };

  const TypeIcon = typeIcons[check.type] || Eye;

  return (
    <div className={`border rounded-lg ${check.passed ? 'border-green-500/30' : 'border-red-500/30'}`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`w-full px-3 py-2 flex items-center justify-between ${
          check.passed ? 'bg-green-500/5' : 'bg-red-500/5'
        } hover:opacity-90 transition-opacity`}
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown size={14} className="text-gray-400" />
          ) : (
            <ChevronRight size={14} className="text-gray-400" />
          )}
          <TypeIcon size={14} className={check.passed ? 'text-green-400' : 'text-red-400'} />
          <span className="text-sm text-white">{check.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 capitalize">{check.type}</span>
          {check.passed ? (
            <CheckCircle size={14} className="text-green-400" />
          ) : (
            <XCircle size={14} className="text-red-400" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="p-3 bg-gray-900/30 border-t border-gray-700 space-y-2">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-gray-500">Confidence:</span>
              <code className="block mt-0.5 text-blue-400">{Math.round((check.confidence ?? 0) * 100)}%</code>
            </div>
            <div>
              <span className="text-gray-500">Duration:</span>
              <code className="block mt-0.5 text-gray-400">{check.duration ?? 0}ms</code>
            </div>
          </div>
          {check.details && (
            <div className="text-xs pt-2 border-t border-gray-700">
              <span className="text-gray-500 block mb-1">Details:</span>
              <pre className="text-gray-400 bg-gray-900/50 p-2 rounded overflow-x-auto max-h-32 overflow-y-auto">
                {typeof check.details === 'object'
                  ? JSON.stringify(check.details, null, 2)
                  : String(check.details)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export const AIReasoningPanel = memo(function AIReasoningPanel({
  thoughtSignature,
  verification,
  className = '',
}: AIReasoningPanelProps) {
  const [showFullSignature, setShowFullSignature] = useState(false);

  const hasContent = thoughtSignature || verification;

  if (!hasContent) {
    return (
      <div className={`bg-gray-800/50 border border-gray-700 rounded-lg p-4 ${className}`}>
        <div className="flex items-center gap-2 mb-4">
          <Brain size={18} className="text-gray-400" />
          <h3 className="text-sm font-medium text-gray-300">AI Reasoning</h3>
        </div>
        <div className="text-center py-8 text-gray-500">
          <Brain size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">AI reasoning data not available</p>
        </div>
      </div>
    );
  }

  const passedChecks = verification?.checks.filter((c) => c.passed).length ?? 0;
  const totalChecks = verification?.checks.length ?? 0;

  return (
    <div className={`bg-gray-800/50 border border-gray-700 rounded-lg ${className}`}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700 flex items-center gap-2">
        <Brain size={18} className="text-purple-400" />
        <h3 className="text-sm font-medium text-gray-300">AI Reasoning</h3>
      </div>

      <div className="p-4 space-y-4">
        {/* Thought Signature */}
        {thoughtSignature && (
          <div className="p-3 bg-purple-500/5 border border-purple-500/20 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Hash size={14} className="text-purple-400" />
                <span className="text-xs font-medium text-purple-400 uppercase tracking-wide">
                  Thought Signature
                </span>
              </div>
              <button
                onClick={() => setShowFullSignature(!showFullSignature)}
                className="text-xs text-gray-400 hover:text-white transition-colors"
              >
                {showFullSignature ? 'Show Less' : 'Show More'}
              </button>
            </div>
            <div className="p-2 bg-gray-900/50 rounded font-mono text-xs text-gray-400 overflow-hidden">
              {showFullSignature ? (
                <pre className="whitespace-pre-wrap break-all">{thoughtSignature}</pre>
              ) : (
                <code className="truncate block">
                  {thoughtSignature.slice(0, 100)}
                  {thoughtSignature.length > 100 && '...'}
                </code>
              )}
            </div>
            <p className="mt-2 text-xs text-gray-500">
              This signature enables reasoning continuity across development phases.
            </p>
          </div>
        )}

        {/* Verification Results */}
        {verification && (
          <>
            {/* Verification Summary */}
            <div className={`p-3 rounded-lg ${
              verification.success
                ? 'bg-green-500/5 border border-green-500/20'
                : 'bg-red-500/5 border border-red-500/20'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Lightbulb size={14} className={verification.success ? 'text-green-400' : 'text-red-400'} />
                  <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                    Verification Summary
                  </span>
                </div>
                <span className={`px-2 py-0.5 text-xs rounded ${
                  verification.success
                    ? 'bg-green-500/10 text-green-400'
                    : 'bg-red-500/10 text-red-400'
                }`}>
                  {verification.success ? 'PASSED' : 'FAILED'}
                </span>
              </div>
              <p className="text-sm text-gray-300">{verification.summary}</p>
              <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
                <span>{passedChecks} / {totalChecks} checks passed</span>
                <span>{verification.duration}ms</span>
              </div>
            </div>

            {/* Verification Checks */}
            {(verification.checks ?? []).length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <FileText size={14} className="text-gray-400" />
                  <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                    Verification Checks
                  </h4>
                </div>
                <div className="space-y-2">
                  {(verification.checks ?? []).map((check, i) => (
                    <VerificationCheckItem key={i} check={check} />
                  ))}
                </div>
              </div>
            )}

            {/* Pass Rate Bar */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500">Pass Rate</span>
                <span className="text-xs text-gray-400">
                  {totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 0}%
                </span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 transition-all duration-500"
                  style={{ width: `${totalChecks > 0 ? (passedChecks / totalChecks) * 100 : 0}%` }}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
});

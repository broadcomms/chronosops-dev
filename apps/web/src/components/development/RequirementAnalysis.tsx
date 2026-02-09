/**
 * RequirementAnalysis - Display parsed requirement analysis from AI
 */
import { memo } from 'react';
import {
  FileText,
  CheckSquare,
  Shield,
  AlertTriangle,
  Layers,
  Gauge,
  Clock,
} from 'lucide-react';
import type { AnalyzedRequirement } from '../../types';

interface RequirementAnalysisProps {
  rawRequirement: string;
  analyzedRequirement: AnalyzedRequirement | null;
  source: string;
  priority: string;
  className?: string;
}

const priorityColors: Record<string, { bg: string; text: string; border: string }> = {
  low: { bg: 'bg-gray-500/10', text: 'text-gray-400', border: 'border-gray-500' },
  medium: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500' },
  high: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500' },
  critical: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500' },
};

const complexityColors: Record<string, { bg: string; text: string }> = {
  simple: { bg: 'bg-green-500/10', text: 'text-green-400' },
  moderate: { bg: 'bg-yellow-500/10', text: 'text-yellow-400' },
  complex: { bg: 'bg-red-500/10', text: 'text-red-400' },
};

export const RequirementAnalysis = memo(function RequirementAnalysis({
  rawRequirement,
  analyzedRequirement,
  source,
  priority,
  className = '',
}: RequirementAnalysisProps) {
  const priorityStyle = priorityColors[priority] || priorityColors.medium;

  return (
    <div className={`bg-gray-800/50 border border-gray-700 rounded-lg ${className}`}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText size={18} className="text-observe" />
          <h3 className="text-sm font-medium text-gray-300">Requirement Analysis</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 text-xs bg-gray-700 text-gray-400 rounded capitalize">
            {source}
          </span>
          <span className={`px-2 py-0.5 text-xs rounded capitalize ${priorityStyle.bg} ${priorityStyle.text}`}>
            {priority}
          </span>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Original Requirement */}
        <div className="p-3 bg-gray-900/50 rounded-lg">
          <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
            Original Requirement
          </h4>
          <p className="text-sm text-white">{rawRequirement}</p>
        </div>

        {analyzedRequirement ? (
          <>
            {/* AI Analysis Summary */}
            <div className="p-3 bg-observe/5 border border-observe/20 rounded-lg">
              <h4 className="text-xs font-medium text-observe uppercase tracking-wide mb-2">
                AI Analysis
              </h4>
              <p className="text-sm text-gray-300">{analyzedRequirement.description}</p>
            </div>

            {/* Complexity & Effort */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-gray-900/50 rounded-lg">
                <div className="flex items-center gap-2 text-gray-400 mb-1">
                  <Gauge size={14} />
                  <span className="text-xs">Complexity</span>
                </div>
                <span className={`px-2 py-0.5 text-sm rounded capitalize ${
                  complexityColors[analyzedRequirement.complexity || analyzedRequirement.estimatedComplexity || 'moderate']?.bg || 'bg-gray-500/10'
                } ${complexityColors[analyzedRequirement.complexity || analyzedRequirement.estimatedComplexity || 'moderate']?.text || 'text-gray-400'}`}>
                  {analyzedRequirement.complexity || analyzedRequirement.estimatedComplexity || 'Unknown'}
                </span>
              </div>
              <div className="p-3 bg-gray-900/50 rounded-lg">
                <div className="flex items-center gap-2 text-gray-400 mb-1">
                  <Clock size={14} />
                  <span className="text-xs">Type</span>
                </div>
                <span className="text-sm text-white capitalize">{analyzedRequirement.type || analyzedRequirement.estimatedEffort || 'N/A'}</span>
              </div>
            </div>

            {/* Acceptance Criteria / Functional Requirements */}
            {(() => {
              const criteria = analyzedRequirement.acceptanceCriteria ?? analyzedRequirement.functionalRequirements ?? [];
              return criteria.length > 0 ? (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <CheckSquare size={14} className="text-green-400" />
                    <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                      Acceptance Criteria ({criteria.length})
                    </h4>
                  </div>
                  <ul className="space-y-1">
                    {criteria.map((req: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                        <span className="text-green-400 mt-1">•</span>
                        {req}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null;
            })()}

            {/* Potential Risks / Non-Functional Requirements */}
            {(() => {
              const risks = analyzedRequirement.potentialRisks ?? analyzedRequirement.nonFunctionalRequirements ?? [];
              return risks.length > 0 ? (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle size={14} className="text-yellow-400" />
                    <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                      Potential Risks ({risks.length})
                    </h4>
                  </div>
                  <ul className="space-y-1">
                    {risks.map((req: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                        <span className="text-yellow-400 mt-1">•</span>
                        {req}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null;
            })()}

            {/* Required Capabilities */}
            {(() => {
              const caps = analyzedRequirement.requiredCapabilities ?? [];
              return caps.length > 0 ? (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Layers size={14} className="text-blue-400" />
                    <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                      Required Capabilities
                    </h4>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {caps.map((cap: string, i: number) => (
                      <span
                        key={i}
                        className="px-2 py-1 text-xs bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded"
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null;
            })()}

            {/* Suggested Approach */}
            {analyzedRequirement.suggestedApproach && (
              <div className="p-3 bg-gray-900/50 rounded-lg">
                <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                  Suggested Approach
                </h4>
                <p className="text-sm text-gray-300">{analyzedRequirement.suggestedApproach}</p>
              </div>
            )}

            {/* Target Files */}
            {(analyzedRequirement.targetFiles ?? []).length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Shield size={14} className="text-purple-400" />
                  <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                    Target Files
                  </h4>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(analyzedRequirement.targetFiles ?? []).map((file: string, i: number) => (
                    <span
                      key={i}
                      className="px-2 py-1 text-xs bg-purple-500/10 text-purple-400 border border-purple-500/30 rounded font-mono"
                    >
                      {file}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <FileText size={32} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">Analysis not available</p>
          </div>
        )}
      </div>
    </div>
  );
});

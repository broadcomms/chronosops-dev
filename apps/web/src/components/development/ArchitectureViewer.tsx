/**
 * ArchitectureViewer - Display architecture design from AI
 */
import { memo, useState } from 'react';
import {
  Network,
  Box,
  ArrowRight,
  Package,
  Shield,
  TrendingUp,
  Layers,
  ChevronDown,
  ChevronRight,
  ImageIcon,
} from 'lucide-react';
import type { ArchitectureDesign, ComponentSpec, DataFlowStep, Dependency } from '../../types';

interface ArchitectureViewerProps {
  architecture: ArchitectureDesign | null;
  architectureDiagramUrl?: string | null;
  className?: string;
}

const componentTypeColors: Record<string, { bg: string; text: string; border: string }> = {
  service: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500' },
  library: { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500' },
  api: { bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500' },
  worker: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500' },
  database: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500' },
  config: { bg: 'bg-gray-500/10', text: 'text-gray-400', border: 'border-gray-500' },
};

interface ComponentCardProps {
  component: ComponentSpec;
}

const ComponentCard = memo(function ComponentCard({ component }: ComponentCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const colors = componentTypeColors[component.type] || componentTypeColors.service;

  return (
    <div className={`border rounded-lg overflow-hidden ${colors.border}`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`w-full px-4 py-3 flex items-center justify-between ${colors.bg} hover:opacity-90 transition-opacity`}
      >
        <div className="flex items-center gap-3">
          {isExpanded ? (
            <ChevronDown size={16} className={colors.text} />
          ) : (
            <ChevronRight size={16} className={colors.text} />
          )}
          <Box size={18} className={colors.text} />
          <div className="text-left">
            <div className="text-sm font-medium text-white">{component.name}</div>
            <div className="text-xs text-gray-500">{component.description}</div>
          </div>
        </div>
        <span className={`px-2 py-0.5 text-xs rounded capitalize ${colors.bg} ${colors.text}`}>
          {component.type}
        </span>
      </button>

      {isExpanded && (
        <div className="p-4 bg-gray-900/30 border-t border-gray-700 space-y-3">
          {/* Purpose */}
          {component.purpose && (
            <div>
              <h5 className="text-xs font-medium text-gray-400 mb-1">Purpose</h5>
              <p className="text-xs text-gray-300">{component.purpose}</p>
            </div>
          )}

          {/* Error Handling */}
          {component.errorHandling && (
            <div>
              <h5 className="text-xs font-medium text-gray-400 mb-1">Error Handling</h5>
              <p className="text-xs text-gray-300">{component.errorHandling}</p>
            </div>
          )}

          {/* Test Requirements */}
          {(component.testRequirements ?? []).length > 0 && (
            <div>
              <h5 className="text-xs font-medium text-gray-400 mb-1">Test Requirements</h5>
              <ul className="space-y-1">
                {(component.testRequirements ?? []).map((req: string, i: number) => (
                  <li key={i} className="text-xs text-gray-300 flex items-start gap-1">
                    <span className={colors.text}>•</span>
                    {req}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Interfaces (from API) */}
          {(component.interface ?? []).length > 0 && (
            <div>
              <h5 className="text-xs font-medium text-gray-400 mb-1">Interface</h5>
              <div className="space-y-1">
                {(component.interface ?? []).map((iface: { name: string; description?: string; returnType?: string; async?: boolean }, i: number) => (
                  <div key={i} className="p-2 bg-gray-800/50 rounded text-xs">
                    <div className="flex items-center gap-2">
                      <span className={`${colors.text} font-medium`}>{iface.name}</span>
                      {iface.async && <span className="text-yellow-500">(async)</span>}
                      {iface.returnType && <span className="text-gray-500">→ {iface.returnType}</span>}
                    </div>
                    {iface.description && (
                      <div className="text-gray-500 mt-0.5">{iface.description}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Legacy Interfaces */}
          {(component.interfaces ?? []).length > 0 && (
            <div>
              <h5 className="text-xs font-medium text-gray-400 mb-1">Interfaces</h5>
              <div className="space-y-1">
                {(component.interfaces ?? []).map((iface, i) => (
                  <div key={i} className="p-2 bg-gray-800/50 rounded text-xs">
                    <div className="flex items-center gap-2">
                      <span className={`${colors.text} font-medium`}>{iface.name}</span>
                      <span className="text-gray-500">({iface.type})</span>
                    </div>
                    {iface.description && (
                      <div className="text-gray-500 mt-0.5">{iface.description}</div>
                    )}
                    {iface.signature && (
                      <code className="block mt-1 text-gray-400 font-mono text-[10px]">
                        {iface.signature}
                      </code>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dependencies */}
          {(component.dependsOn ?? component.dependencies ?? []).length > 0 && (
            <div>
              <h5 className="text-xs font-medium text-gray-400 mb-1">Dependencies</h5>
              <div className="flex flex-wrap gap-1">
                {(component.dependsOn ?? component.dependencies ?? []).map((dep: string, i: number) => (
                  <span key={i} className="px-2 py-0.5 text-xs bg-gray-700 text-gray-300 rounded">
                    {dep}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

interface DataFlowDiagramProps {
  dataFlow: DataFlowStep[];
}

const DataFlowDiagram = memo(function DataFlowDiagram({ dataFlow }: DataFlowDiagramProps) {
  if (dataFlow.length === 0) return null;

  return (
    <div className="p-4 bg-gray-900/50 rounded-lg">
      <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-2">
        <ArrowRight size={14} />
        Data Flow
      </h4>
      <div className="space-y-2">
        {dataFlow.map((step, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="px-2 py-1 bg-blue-500/10 text-blue-400 rounded text-xs font-medium min-w-[80px] text-center">
              {step.from}
            </span>
            <div className="flex-1 flex items-center gap-2">
              <div className="flex-1 h-0.5 bg-gray-700" />
              <ArrowRight size={14} className="text-gray-500" />
              <div className="flex-1 h-0.5 bg-gray-700" />
            </div>
            <span className="px-2 py-1 bg-green-500/10 text-green-400 rounded text-xs font-medium min-w-[80px] text-center">
              {step.to}
            </span>
          </div>
        ))}
      </div>
      {dataFlow.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-700">
          <div className="space-y-1">
            {dataFlow.map((step, i) => (
              <div key={i} className="text-xs text-gray-500">
                <span className="text-gray-400">{step.from} → {step.to}:</span>{' '}
                {step.description} ({step.dataType})
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

interface DependenciesListProps {
  dependencies: Dependency[];
}

const DependenciesList = memo(function DependenciesList({ dependencies }: DependenciesListProps) {
  if (dependencies.length === 0) return null;

  return (
    <div className="p-4 bg-gray-900/50 rounded-lg">
      <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-2">
        <Package size={14} />
        External Dependencies
      </h4>
      <div className="grid grid-cols-2 gap-2">
        {dependencies.map((dep, i) => (
          <div key={i} className="p-2 bg-gray-800/50 rounded text-xs">
            <div className="flex items-center justify-between">
              <span className="text-white font-medium">{dep.name}</span>
              <span className="text-gray-500">{dep.version}</span>
            </div>
            <div className="text-gray-500 mt-0.5">{dep.purpose}</div>
          </div>
        ))}
      </div>
    </div>
  );
});

export const ArchitectureViewer = memo(function ArchitectureViewer({
  architecture,
  architectureDiagramUrl,
  className = '',
}: ArchitectureViewerProps) {
  if (!architecture) {
    return (
      <div className={`bg-gray-800/50 border border-gray-700 rounded-lg p-4 ${className}`}>
        <div className="flex items-center gap-2 mb-4">
          <Network size={18} className="text-gray-400" />
          <h3 className="text-sm font-medium text-gray-300">Architecture Design</h3>
        </div>
        <div className="text-center py-8 text-gray-500">
          <Network size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">Architecture not available</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-gray-800/50 border border-gray-700 rounded-lg ${className}`}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700 flex items-center gap-2">
        <Network size={18} className="text-orient" />
        <h3 className="text-sm font-medium text-gray-300">Architecture Design</h3>
        {(architecture.components ?? []).length > 0 && (
          <span className="text-xs text-gray-500">
            ({(architecture.components ?? []).length} components)
          </span>
        )}
      </div>

      <div className="p-4 space-y-4">
        {/* Overview */}
        <div className="p-3 bg-orient/5 border border-orient/20 rounded-lg">
          <h4 className="text-xs font-medium text-orient uppercase tracking-wide mb-2">
            Overview
          </h4>
          <p className="text-sm text-gray-300">{architecture.overview}</p>
        </div>

        {/* Architecture Diagram (AI-generated) */}
        {architectureDiagramUrl && (
          <div className="p-3 bg-gray-900/50 rounded-lg">
            <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-2">
              <ImageIcon size={14} />
              Architecture Diagram
              <span className="text-[10px] text-gray-600 font-normal">(AI-generated)</span>
            </h4>
            <div className="rounded-lg overflow-hidden border border-gray-700">
              <img
                src={architectureDiagramUrl}
                alt="AI-generated architecture diagram"
                className="w-full h-auto"
                loading="lazy"
              />
            </div>
          </div>
        )}

        {/* Data Flow (string format from API) */}
        {typeof architecture.dataFlow === 'string' && architecture.dataFlow && (
          <div className="p-3 bg-gray-900/50 rounded-lg">
            <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-2">
              <ArrowRight size={14} />
              Data Flow
            </h4>
            <p className="text-sm text-gray-300">{architecture.dataFlow}</p>
          </div>
        )}

        {/* Components */}
        {(architecture.components ?? []).length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Layers size={14} className="text-blue-400" />
              <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                Components ({(architecture.components ?? []).length})
              </h4>
            </div>
            <div className="space-y-2">
              {(architecture.components ?? []).map((component, i) => (
                <ComponentCard key={i} component={component} />
              ))}
            </div>
          </div>
        )}

        {/* Data Flow (array format - legacy) */}
        {Array.isArray(architecture.dataFlow) && <DataFlowDiagram dataFlow={architecture.dataFlow} />}

        {/* External Dependencies (from API) */}
        {(architecture.externalDependencies ?? []).length > 0 && (
          <div className="p-4 bg-gray-900/50 rounded-lg">
            <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-2">
              <Package size={14} />
              External Dependencies
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {(architecture.externalDependencies ?? []).map((dep: { name: string; version: string; purpose: string; devOnly?: boolean }, i: number) => (
                <div key={i} className="p-2 bg-gray-800/50 rounded text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-white font-medium">{dep.name}</span>
                    <span className="text-gray-500">{dep.version}</span>
                  </div>
                  <div className="text-gray-500 mt-0.5">{dep.purpose}</div>
                  {dep.devOnly && <span className="text-yellow-500 text-[10px]">(dev only)</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Legacy Dependencies */}
        {(architecture.dependencies ?? []).length > 0 && <DependenciesList dependencies={architecture.dependencies ?? []} />}

        {/* Testing Strategy */}
        {architecture.testingStrategy && (
          <div className="p-3 bg-gray-900/50 rounded-lg">
            <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-2">
              <Shield size={14} />
              Testing Strategy
            </h4>
            <p className="text-sm text-gray-300">{architecture.testingStrategy}</p>
          </div>
        )}

        {/* Performance Considerations */}
        {(architecture.performanceConsiderations ?? []).length > 0 && (
          <div className="p-3 bg-gray-900/50 rounded-lg">
            <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-2">
              <TrendingUp size={14} />
              Performance
            </h4>
            <ul className="space-y-1">
              {(architecture.performanceConsiderations ?? []).map((item: string, i: number) => (
                <li key={i} className="text-xs text-gray-400 flex items-start gap-1">
                  <span className="text-green-400">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Security Considerations */}
        {(architecture.securityConsiderations ?? []).length > 0 && (
          <div className="p-3 bg-gray-900/50 rounded-lg">
            <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-2">
              <Shield size={14} />
              Security
            </h4>
            <ul className="space-y-1">
              {(architecture.securityConsiderations ?? []).map((item: string, i: number) => (
                <li key={i} className="text-xs text-gray-400 flex items-start gap-1">
                  <span className="text-red-400">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Scaling Considerations (legacy) */}
        {(architecture.scalingConsiderations ?? []).length > 0 && (
          <div className="p-3 bg-gray-900/50 rounded-lg">
            <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-2">
              <TrendingUp size={14} />
              Scaling
            </h4>
            <ul className="space-y-1">
              {(architecture.scalingConsiderations ?? []).map((item: string, i: number) => (
                <li key={i} className="text-xs text-gray-400 flex items-start gap-1">
                  <span className="text-green-400">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Deployment Strategy */}
        {architecture.deploymentStrategy && (
          <div className="p-3 bg-gray-900/50 rounded-lg">
            <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-2">
              <Package size={14} />
              Deployment Strategy
            </h4>
            <p className="text-sm text-gray-300">{architecture.deploymentStrategy}</p>
          </div>
        )}
      </div>
    </div>
  );
});

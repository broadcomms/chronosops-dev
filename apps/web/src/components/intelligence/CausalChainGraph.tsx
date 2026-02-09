/**
 * CausalChainGraph - Visualize causal relationships between events
 */
import { memo } from 'react';
import {
  GitBranch,
  ArrowRight,
  Target,
} from 'lucide-react';
import type { CausalLink } from '../../types';

interface CausalChainGraphProps {
  links: CausalLink[];
  rootCause?: string;
  className?: string;
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.8) return 'text-green-400 border-green-500/30';
  if (confidence >= 0.6) return 'text-yellow-400 border-yellow-500/30';
  if (confidence >= 0.4) return 'text-orange-400 border-orange-500/30';
  return 'text-red-400 border-red-500/30';
}

function getConfidenceBgColor(confidence: number): string {
  if (confidence >= 0.8) return 'bg-green-500/10';
  if (confidence >= 0.6) return 'bg-yellow-500/10';
  if (confidence >= 0.4) return 'bg-orange-500/10';
  return 'bg-red-500/10';
}

interface CausalLinkCardProps {
  link: CausalLink;
}

const CausalLinkCard = memo(function CausalLinkCard({ link }: CausalLinkCardProps) {
  const confidence = link.confidence ?? 0.5;
  const colorClass = getConfidenceColor(confidence);
  const bgClass = getConfidenceBgColor(confidence);
  const evidence = link.evidence ?? [];

  return (
    <div className={`p-3 rounded-lg border ${colorClass} ${bgClass}`}>
      {/* Connection */}
      <div className="flex items-center gap-2 mb-2">
        <div className="px-2 py-1 bg-gray-800 rounded text-sm text-white font-medium truncate max-w-[120px]" title={link.from}>
          {link.from}
        </div>
        <div className="flex items-center gap-1 text-gray-500">
          <ArrowRight size={14} />
          <span className="text-xs">{link.relationship}</span>
          <ArrowRight size={14} />
        </div>
        <div className="px-2 py-1 bg-gray-800 rounded text-sm text-white font-medium truncate max-w-[120px]" title={link.to}>
          {link.to}
        </div>
      </div>

      {/* Confidence */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <div className="h-1.5 w-20 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full ${bgClass.replace('/10', '')}`}
              style={{ width: `${confidence * 100}%` }}
            />
          </div>
          <span className={`text-xs ${colorClass.split(' ')[0]}`}>
            {Math.round(confidence * 100)}%
          </span>
        </div>
      </div>

      {/* Evidence */}
      {evidence.length > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-700/50">
          <div className="text-xs text-gray-500 mb-1">Evidence:</div>
          <ul className="text-xs text-gray-400 space-y-0.5">
            {evidence.slice(0, 3).map((e, i) => (
              <li key={i} className="truncate" title={typeof e === 'string' ? e : JSON.stringify(e)}>
                • {typeof e === 'string' ? e : JSON.stringify(e)}
              </li>
            ))}
            {evidence.length > 3 && (
              <li className="text-gray-500">+{evidence.length - 3} more</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
});

export const CausalChainGraph = memo(function CausalChainGraph({
  links,
  rootCause,
  className = '',
}: CausalChainGraphProps) {
  if (links.length === 0) {
    return (
      <div className={`bg-gray-800/50 border border-gray-700 rounded-lg p-4 ${className}`}>
        <div className="flex items-center gap-2 mb-4">
          <GitBranch size={18} className="text-gray-400" />
          <h3 className="text-sm font-medium text-gray-300">Causal Chain</h3>
        </div>
        <div className="text-center py-8 text-gray-500">
          <GitBranch size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">No causal relationships identified</p>
        </div>
      </div>
    );
  }

  // Sort by confidence (handle missing confidence)
  const sortedLinks = [...links].sort((a, b) => (b.confidence ?? 0.5) - (a.confidence ?? 0.5));

  // Build a simple chain visualization
  const uniqueNodes = new Set<string>();
  links.forEach((link) => {
    if (link.from) uniqueNodes.add(link.from);
    if (link.to) uniqueNodes.add(link.to);
  });

  return (
    <div className={`bg-gray-800/50 border border-gray-700 rounded-lg p-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <GitBranch size={18} className="text-purple-400" />
          <h3 className="text-sm font-medium text-gray-300">Causal Chain</h3>
          <span className="text-xs text-gray-500">
            ({links.length} relationships, {uniqueNodes.size} entities)
          </span>
        </div>
      </div>

      {/* Root Cause */}
      {rootCause && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <div className="flex items-center gap-2 text-red-400 mb-1">
            <Target size={14} />
            <span className="text-xs font-medium">Root Cause</span>
          </div>
          <p className="text-sm text-white">{rootCause}</p>
        </div>
      )}

      {/* Causal Links */}
      <div className="space-y-3">
        {sortedLinks.map((link, index) => (
          <CausalLinkCard key={`${link.from}-${link.to}-${index}`} link={link} />
        ))}
      </div>

      {/* Legend */}
      <div className="mt-4 pt-4 border-t border-gray-700 flex items-center gap-4">
        <span className="text-xs text-gray-500">Confidence:</span>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-xs text-gray-400">High (80%+)</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-yellow-500" />
            <span className="text-xs text-gray-400">Medium (60%+)</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-orange-500" />
            <span className="text-xs text-gray-400">Low (40%+)</span>
          </div>
        </div>
      </div>
    </div>
  );
});

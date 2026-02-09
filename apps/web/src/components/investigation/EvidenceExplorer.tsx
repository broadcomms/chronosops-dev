/**
 * EvidenceExplorer - Tabbed evidence viewer
 * Shows collected evidence organized by type with clickable detail modal
 */
import { memo, useState, useMemo, useCallback } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  Video,
  FileText,
  LineChart,
  Settings,
  User,
  Search,
  Circle,
  type LucideIcon,
} from 'lucide-react';
import type { Evidence, EvidenceType } from '../../types';
import { EvidenceDetailModal } from './EvidenceDetailModal';

interface EvidenceExplorerProps {
  evidence: Evidence[];
  className?: string;
  onEvidenceClick?: (evidence: Evidence) => void;
}

const evidenceTypeLabels: Record<EvidenceType, string> = {
  video_frame: 'Video Frames',
  log: 'Logs',
  metric: 'Metrics',
  k8s_event: 'K8s Events',
  user_report: 'User Reports',
};

const evidenceTypeIcons: Record<EvidenceType, LucideIcon> = {
  video_frame: Video,
  log: FileText,
  metric: LineChart,
  k8s_event: Settings,
  user_report: User,
};

export const EvidenceExplorer = memo(function EvidenceExplorer({
  evidence,
  className = '',
  onEvidenceClick,
}: EvidenceExplorerProps) {
  const [activeTab, setActiveTab] = useState<EvidenceType | 'all'>('all');
  const [selectedEvidence, setSelectedEvidence] = useState<Evidence | null>(null);

  // Handle evidence click - open modal and call external handler
  const handleEvidenceClick = useCallback((ev: Evidence) => {
    setSelectedEvidence(ev);
    onEvidenceClick?.(ev);
  }, [onEvidenceClick]);

  // Group evidence by type
  const groupedEvidence = useMemo(() => {
    const groups: Record<EvidenceType, Evidence[]> = {
      video_frame: [],
      log: [],
      metric: [],
      k8s_event: [],
      user_report: [],
    };

    evidence.forEach((e) => {
      if (groups[e.type]) {
        groups[e.type].push(e);
      }
    });

    return groups;
  }, [evidence]);

  // Get counts for tabs
  const typeCounts = useMemo(() => {
    const counts: Record<EvidenceType | 'all', number> = {
      all: evidence.length,
      video_frame: groupedEvidence.video_frame.length,
      log: groupedEvidence.log.length,
      metric: groupedEvidence.metric.length,
      k8s_event: groupedEvidence.k8s_event.length,
      user_report: groupedEvidence.user_report.length,
    };
    return counts;
  }, [evidence.length, groupedEvidence]);

  // Filter evidence based on active tab
  const filteredEvidence = useMemo(() => {
    if (activeTab === 'all') {
      return [...evidence].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    }
    return groupedEvidence[activeTab].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [activeTab, evidence, groupedEvidence]);

  const tabs: (EvidenceType | 'all')[] = [
    'all',
    'video_frame',
    'log',
    'metric',
    'k8s_event',
    'user_report',
  ];

  if (evidence.length === 0) {
    return (
      <div className={`bg-gray-800/50 border border-gray-700 rounded-lg p-4 ${className}`}>
        <h3 className="text-sm font-medium text-gray-300 mb-4">Evidence</h3>
        <div className="text-center py-8">
          <Search size={48} className="mx-auto mb-3 opacity-50 text-gray-500" />
          <p className="text-gray-500 text-sm">No evidence collected yet</p>
          <p className="text-gray-600 text-xs mt-1">
            Evidence will appear as the investigation progresses
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden ${className}`}>
      {/* Tabs */}
      <div className="flex border-b border-gray-700 overflow-x-auto">
        {tabs.map((tab) => {
          const count = typeCounts[tab];
          if (tab !== 'all' && count === 0) return null;

          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`
                px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors
                ${
                  activeTab === tab
                    ? 'border-blue-500 text-blue-400 bg-gray-800'
                    : 'border-transparent text-gray-400 hover:text-gray-300 hover:bg-gray-800/50'
                }
              `}
            >
              {tab === 'all' ? (
                'All'
              ) : (
                (() => {
                  const TabIcon = evidenceTypeIcons[tab];
                  return <TabIcon size={14} className="mr-1.5 inline-block" />;
                })()
              )}
              {tab !== 'all' && evidenceTypeLabels[tab]}
              <span className="ml-1.5 text-xs opacity-70">({count})</span>
            </button>
          );
        })}
      </div>

      {/* Evidence list */}
      <div className="p-4 max-h-96 overflow-y-auto">
        <div className="space-y-3">
          {filteredEvidence.map((item) => (
            <EvidenceCard
              key={item.id}
              evidence={item}
              onClick={handleEvidenceClick}
            />
          ))}
        </div>
      </div>

      {/* Evidence Detail Modal */}
      <EvidenceDetailModal
        evidence={selectedEvidence}
        isOpen={selectedEvidence !== null}
        onClose={() => setSelectedEvidence(null)}
      />
    </div>
  );
});

interface EvidenceCardProps {
  evidence: Evidence;
  onClick?: (evidence: Evidence) => void;
}

const EvidenceCard = memo(function EvidenceCard({
  evidence,
  onClick,
}: EvidenceCardProps) {
  const handleClick = () => onClick?.(evidence);

  // Check if evidence has a frame image thumbnail
  const hasThumbnail = evidence.metadata?.frameImage;

  // Format content preview
  const contentPreview = useMemo(() => {
    const content = evidence.content as Record<string, unknown>;
    if (!content) return 'No content';

    // Handle common content structures
    if ('message' in content && typeof content.message === 'string') {
      const msg = content.message;
      return msg.slice(0, 150) + (msg.length > 150 ? '...' : '');
    }
    if ('description' in content && typeof content.description === 'string') {
      const desc = content.description;
      return desc.slice(0, 150) + (desc.length > 150 ? '...' : '');
    }
    if ('value' in content) {
      return `Value: ${String(content.value)}`;
    }
    const jsonStr = JSON.stringify(content);
    return jsonStr.slice(0, 150) + (jsonStr.length > 150 ? '...' : '');
  }, [evidence.content]);

  return (
    <div
      className={`
        p-3 rounded-lg bg-gray-900/50 border border-gray-700/50
        ${onClick ? 'cursor-pointer hover:border-blue-500/50 hover:bg-gray-900 transition-all group' : ''}
      `}
      onClick={handleClick}
    >
      <div className="flex items-start gap-3">
        {/* Thumbnail for video frames */}
        {hasThumbnail && (
          <div className="flex-shrink-0 w-16 h-12 rounded overflow-hidden border border-gray-700 bg-gray-800">
            <img
              src={`data:${evidence.metadata?.frameMimeType || 'image/png'};base64,${evidence.metadata?.frameImage}`}
              alt="Frame thumbnail"
              className="w-full h-full object-cover"
            />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              {!hasThumbnail && (() => {
                const EvidenceIcon = evidenceTypeIcons[evidence.type] || Circle;
                return <EvidenceIcon size={18} className="text-gray-400 mt-0.5" />;
              })()}
              <div className="min-w-0">
                <p className="text-sm text-gray-300">{evidence.source}</p>
                <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                  {contentPreview}
                </p>
              </div>
            </div>

            {evidence.confidence !== null && (
              <div className="flex-shrink-0">
                <ConfidenceBadge confidence={evidence.confidence} />
              </div>
            )}
          </div>

          <div className="flex items-center justify-between mt-2 text-xs">
            <span className="text-gray-600">{evidenceTypeLabels[evidence.type]}</span>
            <div className="flex items-center gap-2">
              {onClick && (
                <span className="text-blue-400/0 group-hover:text-blue-400/80 transition-colors">
                  Click for details
                </span>
              )}
              <span className="text-gray-600">
                {formatDistanceToNow(new Date(evidence.timestamp), { addSuffix: true })}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const percentage = Math.round(confidence * 100);
  const color =
    percentage >= 80
      ? 'text-green-400 bg-green-500/10'
      : percentage >= 50
      ? 'text-yellow-400 bg-yellow-500/10'
      : 'text-red-400 bg-red-500/10';

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {percentage}%
    </span>
  );
}

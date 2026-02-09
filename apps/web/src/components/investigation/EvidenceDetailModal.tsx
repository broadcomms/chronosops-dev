/**
 * EvidenceDetailModal - Full evidence details with screenshot display
 * Shows complete evidence information including frame images, AI analysis, and metadata
 */
import { memo, useState } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import {
  Video,
  FileText,
  LineChart,
  Settings,
  User,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  ArrowUpDown,
  type LucideIcon,
} from 'lucide-react';
import type { Evidence, EvidenceType, PanelState, TemporalAnalysis } from '../../types';

interface EvidenceDetailModalProps {
  evidence: Evidence | null;
  isOpen: boolean;
  onClose: () => void;
}

const evidenceTypeLabels: Record<EvidenceType, string> = {
  video_frame: 'Video Frame',
  log: 'Log Entry',
  metric: 'Metric',
  k8s_event: 'Kubernetes Event',
  user_report: 'User Report',
};

const evidenceTypeIcons: Record<EvidenceType, LucideIcon> = {
  video_frame: Video,
  log: FileText,
  metric: LineChart,
  k8s_event: Settings,
  user_report: User,
};

export const EvidenceDetailModal = memo(function EvidenceDetailModal({
  evidence,
  isOpen,
  onClose,
}: EvidenceDetailModalProps) {
  const [showMetadata, setShowMetadata] = useState(false);

  if (!isOpen || !evidence) return null;

  const content = evidence.content as Record<string, unknown>;
  const metadata = evidence.metadata;
  const hasFrameImage = metadata?.frameImage;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/90">
          <div className="flex items-center gap-3">
            {(() => {
              const EvidenceIcon = evidenceTypeIcons[evidence.type];
              return <EvidenceIcon size={28} className="text-blue-400" />;
            })()}
            <div>
              <h2 className="text-lg font-semibold text-white">
                {evidenceTypeLabels[evidence.type]}
              </h2>
              <p className="text-sm text-gray-400">{evidence.source}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {evidence.confidence !== null && (
              <ConfidenceIndicator confidence={evidence.confidence} />
            )}
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Frame Image (for video_frame evidence) */}
          {hasFrameImage && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
                Captured Frame
              </h3>
              <div className="relative bg-gray-800 rounded-lg overflow-hidden border border-gray-700">
                <img
                  src={`data:${metadata?.frameMimeType || 'image/png'};base64,${metadata?.frameImage}`}
                  alt="Dashboard frame"
                  className="w-full h-auto max-h-96 object-contain"
                />
                {metadata?.frameTimestamp && (
                  <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/70 rounded text-xs text-gray-300">
                    {format(new Date(metadata.frameTimestamp), 'HH:mm:ss')}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* AI Analysis Section */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
              AI Analysis
            </h3>
            <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
              <p className="text-gray-200 leading-relaxed">
                {content.description as string || 'No analysis available'}
              </p>
              {metadata?.analysisText && metadata.analysisText !== content.description && (
                <p className="text-gray-400 mt-2 text-sm">
                  {metadata.analysisText}
                </p>
              )}
            </div>
          </div>

          {/* Type-specific content */}
          <EvidenceContentDisplay evidence={evidence} />

          {/* Temporal Analysis (if available) */}
          {metadata?.temporalAnalysis && (
            <TemporalAnalysisSection analysis={metadata.temporalAnalysis} />
          )}

          {/* Panel States (for dashboard evidence) */}
          {metadata?.panelStates && metadata.panelStates.length > 0 && (
            <PanelStatesSection panelStates={metadata.panelStates} />
          )}

          {/* Technical Metadata (collapsible) */}
          <div className="space-y-2">
            <button
              onClick={() => setShowMetadata(!showMetadata)}
              className="flex items-center gap-2 text-sm font-medium text-gray-400 uppercase tracking-wider hover:text-gray-300 transition-colors"
            >
              <svg
                className={`w-4 h-4 transition-transform ${showMetadata ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
              Technical Details
            </button>
            {showMetadata && (
              <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                <pre className="text-xs text-gray-400 overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(
                    {
                      id: evidence.id,
                      type: evidence.type,
                      source: evidence.source,
                      timestamp: evidence.timestamp,
                      createdAt: evidence.createdAt,
                      confidence: evidence.confidence,
                      content: content,
                      metadata: metadata ? { ...metadata, frameImage: metadata.frameImage ? '[BASE64_IMAGE]' : undefined } : null,
                    },
                    null,
                    2
                  )}
                </pre>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-800 bg-gray-900/90 text-sm text-gray-500">
          <span>Evidence ID: {evidence.id.slice(0, 8)}...</span>
          <span>
            {formatDistanceToNow(new Date(evidence.timestamp), { addSuffix: true })}
            {' - '}
            {format(new Date(evidence.timestamp), 'PPpp')}
          </span>
        </div>
      </div>
    </div>
  );
});

// Confidence indicator with visual progress bar
function ConfidenceIndicator({ confidence }: { confidence: number }) {
  const percentage = Math.round(confidence * 100);
  const color =
    percentage >= 80
      ? 'bg-green-500'
      : percentage >= 50
      ? 'bg-yellow-500'
      : 'bg-red-500';

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 rounded-lg">
      <span className="text-xs text-gray-400">Confidence</span>
      <div className="w-20 h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-sm font-medium text-white">{percentage}%</span>
    </div>
  );
}

// Type-specific content display
function EvidenceContentDisplay({ evidence }: { evidence: Evidence }) {
  const content = evidence.content as Record<string, unknown>;

  switch (evidence.type) {
    case 'video_frame':
      return <VideoFrameContent content={content} />;
    case 'metric':
      return <MetricContent content={content} />;
    case 'log':
      return <LogContent content={content} />;
    case 'k8s_event':
      return <K8sEventContent content={content} />;
    default:
      return null;
  }
}

// Video frame specific content
function VideoFrameContent({ content }: { content: Record<string, unknown> }) {
  const anomalyType = content.anomalyType as string;
  const severity = content.severity as string;
  const location = content.location as string;

  if (!anomalyType && !severity) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
        Detection Details
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {anomalyType && (
          <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
            <p className="text-xs text-gray-500 mb-1">Anomaly Type</p>
            <p className="text-sm text-white font-medium capitalize">
              {anomalyType.replace(/_/g, ' ')}
            </p>
          </div>
        )}
        {severity && (
          <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
            <p className="text-xs text-gray-500 mb-1">Severity</p>
            <SeverityBadge severity={severity} />
          </div>
        )}
        {location && (
          <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
            <p className="text-xs text-gray-500 mb-1">Location</p>
            <p className="text-sm text-white">{location}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Metric specific content
function MetricContent({ content }: { content: Record<string, unknown> }) {
  const name = content.name as string;
  const value = content.value as number;
  const unit = content.unit as string;
  const trend = content.trend as string;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
        Metric Details
      </h3>
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-400">{name}</p>
            <p className="text-3xl font-bold text-white mt-1">
              {typeof value === 'number' ? value.toFixed(2) : value}
              <span className="text-lg text-gray-400 ml-1">{unit}</span>
            </p>
          </div>
          {trend && (
            <div className="flex items-center gap-1">
              <TrendIndicator trend={trend} />
              <span className="text-sm text-gray-400 capitalize">{trend}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Log specific content
function LogContent({ content }: { content: Record<string, unknown> }) {
  const pattern = content.pattern as string;
  const count = content.count as number;
  const samples = content.samples as string[];
  const severity = content.severity as string;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
        Log Pattern Details
      </h3>
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 space-y-3">
        {pattern && (
          <div>
            <p className="text-xs text-gray-500 mb-1">Pattern</p>
            <code className="text-sm text-green-400 bg-gray-900 px-2 py-1 rounded">
              {pattern}
            </code>
          </div>
        )}
        <div className="flex gap-4">
          {count !== undefined && (
            <div>
              <p className="text-xs text-gray-500 mb-1">Occurrences</p>
              <p className="text-lg font-bold text-white">{count}</p>
            </div>
          )}
          {severity && (
            <div>
              <p className="text-xs text-gray-500 mb-1">Severity</p>
              <SeverityBadge severity={severity} />
            </div>
          )}
        </div>
        {samples && samples.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-2">Sample Logs</p>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {samples.map((sample, i) => (
                <pre
                  key={i}
                  className="text-xs text-gray-300 bg-gray-900 p-2 rounded overflow-x-auto"
                >
                  {sample}
                </pre>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// K8s event specific content
function K8sEventContent({ content }: { content: Record<string, unknown> }) {
  const eventType = content.eventType as string;
  const reason = content.reason as string;
  const message = content.message as string;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
        Kubernetes Event Details
      </h3>
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 space-y-3">
        <div className="grid grid-cols-2 gap-4">
          {eventType && (
            <div>
              <p className="text-xs text-gray-500 mb-1">Event Type</p>
              <p className="text-sm text-white">{eventType}</p>
            </div>
          )}
          {reason && (
            <div>
              <p className="text-xs text-gray-500 mb-1">Reason</p>
              <p className="text-sm text-white">{reason}</p>
            </div>
          )}
        </div>
        {message && (
          <div>
            <p className="text-xs text-gray-500 mb-1">Message</p>
            <p className="text-sm text-gray-300">{message}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Temporal analysis section
function TemporalAnalysisSection({ analysis }: { analysis: TemporalAnalysis }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
        Temporal Analysis
      </h3>
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <p className="text-xs text-gray-500">Frames Analyzed</p>
            <p className="text-lg font-bold text-white">{analysis.framesAnalyzed}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Time Span</p>
            <p className="text-lg font-bold text-white">{analysis.timeSpanSeconds}s</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Trend</p>
            <div className="flex items-center gap-1">
              <TrendIndicator trend={analysis.trendDirection} />
              <span className="text-sm text-white capitalize">{analysis.trendDirection}</span>
            </div>
          </div>
          {analysis.anomalyOnset && (
            <div>
              <p className="text-xs text-gray-500">First Detected</p>
              <p className="text-sm text-white">Frame {analysis.anomalyOnset.frameNumber}</p>
            </div>
          )}
        </div>
        {analysis.changesSummary.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-2">Changes Detected</p>
            <div className="space-y-1">
              {analysis.changesSummary.map((change, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="text-gray-500">
                    Frame {change.fromFrame} → {change.toFrame}:
                  </span>
                  <span className="text-gray-300">{change.change}</span>
                  <SeverityBadge severity={change.significance} size="sm" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Panel states section
function PanelStatesSection({ panelStates }: { panelStates: PanelState[] }) {
  const statusColors: Record<string, string> = {
    normal: 'bg-green-500',
    warning: 'bg-yellow-500',
    error: 'bg-red-500',
    unknown: 'bg-gray-500',
  };

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
        Dashboard Panels
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {panelStates.map((panel, i) => (
          <div
            key={i}
            className="bg-gray-800/50 rounded-lg p-3 border border-gray-700 flex items-center gap-2"
          >
            <div className={`w-2 h-2 rounded-full ${statusColors[panel.status] || 'bg-gray-500'}`} />
            <div className="min-w-0">
              <p className="text-sm text-white truncate">{panel.name}</p>
              {panel.description && (
                <p className="text-xs text-gray-500 truncate">{panel.description}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Severity badge component
function SeverityBadge({ severity, size = 'md' }: { severity: string; size?: 'sm' | 'md' }) {
  const colors: Record<string, string> = {
    low: 'text-blue-400 bg-blue-500/10',
    medium: 'text-yellow-400 bg-yellow-500/10',
    high: 'text-orange-400 bg-orange-500/10',
    critical: 'text-red-400 bg-red-500/10',
    info: 'text-gray-400 bg-gray-500/10',
    warning: 'text-yellow-400 bg-yellow-500/10',
    error: 'text-red-400 bg-red-500/10',
  };

  const sizeClasses = size === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-0.5 text-sm';

  return (
    <span className={`rounded font-medium capitalize ${sizeClasses} ${colors[severity] || colors.info}`}>
      {severity}
    </span>
  );
}

// Trend indicator arrow
function TrendIndicator({ trend }: { trend: string }) {
  const arrows: Record<string, { icon: LucideIcon; color: string }> = {
    increasing: { icon: TrendingUp, color: 'text-red-400' },
    decreasing: { icon: TrendingDown, color: 'text-green-400' },
    stable: { icon: ArrowRight, color: 'text-gray-400' },
    volatile: { icon: ArrowUpDown, color: 'text-yellow-400' },
    improving: { icon: TrendingUp, color: 'text-green-400' },
    deteriorating: { icon: TrendingDown, color: 'text-red-400' },
    fluctuating: { icon: ArrowUpDown, color: 'text-yellow-400' },
  };

  const config = arrows[trend] || arrows.stable;
  const TrendIcon = config.icon;

  return <TrendIcon size={18} className={config.color} />;
}

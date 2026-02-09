/**
 * Timeline Event Card Component
 * Displays a single event in the unified timeline with entity-specific styling
 */
import { formatDistanceToNow, format } from 'date-fns';
import { Link } from 'react-router-dom';
import { 
  ChevronRight, 
  Clock,
  FileCode,
  AlertCircle,
} from 'lucide-react';
import type { UnifiedTimelineEvent } from '@chronosops/shared';
import { EntityIcon, StatusBadge, ENTITY_CONFIG } from './EntityIcon';

interface TimelineEventCardProps {
  event: UnifiedTimelineEvent;
  showConnector?: boolean;
  isLast?: boolean;
}

/**
 * Get the detail link for an entity based on its type
 */
function getEntityLink(event: UnifiedTimelineEvent): string | null {
  switch (event.entityType) {
    case 'incident':
      return `/incidents/${event.entityId}`;
    case 'development_cycle':
      return `/development?cycle=${event.entityId}`;
    case 'code_evolution':
      return `/evolution/${event.entityId}`;
    case 'learned_pattern':
      return `/intelligence?pattern=${event.entityId}`;
    case 'action':
      // Actions are usually viewed in context of their incident
      if (event.relatedEntities?.[0]?.type === 'incident') {
        return `/incidents/${event.relatedEntities[0].id}#actions`;
      }
      return null;
    case 'reconstruction':
      // Reconstructions link back to incident
      if (event.relatedEntities?.[0]?.type === 'incident') {
        return `/incidents/${event.relatedEntities[0].id}`;
      }
      return null;
    default:
      return null;
  }
}

/**
 * Render metadata items based on entity type
 */
function renderMetadata(event: UnifiedTimelineEvent) {
  const metadata = event.metadata;
  
  if (!metadata || Object.keys(metadata).length === 0) {
    return null;
  }
  
  const items: JSX.Element[] = [];
  
  // Entity-specific metadata rendering
  switch (event.entityType) {
    case 'incident':
      if (metadata.severity) {
        const severityColors: Record<string, string> = {
          critical: 'text-red-400',
          high: 'text-orange-400',
          medium: 'text-yellow-400',
          low: 'text-blue-400',
        };
        items.push(
          <span 
            key="severity" 
            className={`flex items-center gap-1 ${severityColors[metadata.severity] || 'text-gray-400'}`}
          >
            <AlertCircle size={12} />
            {(metadata.severity as string).toUpperCase()}
          </span>
        );
      }
      if (metadata.namespace) {
        items.push(
          <span key="namespace" className="text-cyan-400">
            {metadata.namespace as string}
          </span>
        );
      }
      break;
      
    case 'code_evolution':
      if (metadata.filesAffected !== undefined) {
        items.push(
          <span key="files" className="flex items-center gap-1 text-purple-400">
            <FileCode size={12} />
            {metadata.filesAffected} file{metadata.filesAffected !== 1 ? 's' : ''}
          </span>
        );
      }
      if (metadata.linesChanged !== undefined) {
        items.push(
          <span key="lines" className="text-gray-400">
            {metadata.linesChanged} line{metadata.linesChanged !== 1 ? 's' : ''} changed
          </span>
        );
      }
      break;
      
    case 'development_cycle':
      if (metadata.phase) {
        items.push(
          <span key="phase" className="text-blue-400">
            Phase: {metadata.phase as string}
          </span>
        );
      }
      break;
      
    case 'learned_pattern':
      if (metadata.confidence !== undefined) {
        const confidence = Number(metadata.confidence);
        items.push(
          <span key="confidence" className="text-yellow-400">
            {Math.round(confidence * 100)}% confidence
          </span>
        );
      }
      if (metadata.usageCount !== undefined) {
        items.push(
          <span key="usage" className="text-gray-400">
            Used {metadata.usageCount} time{metadata.usageCount !== 1 ? 's' : ''}
          </span>
        );
      }
      break;
      
    case 'action':
      if (metadata.actionType) {
        items.push(
          <span key="type" className="text-cyan-400 capitalize">
            {(metadata.actionType as string).replace(/_/g, ' ')}
          </span>
        );
      }
      if (metadata.duration !== undefined) {
        items.push(
          <span key="duration" className="flex items-center gap-1 text-gray-400">
            <Clock size={12} />
            {Math.round(Number(metadata.duration) / 1000)}s
          </span>
        );
      }
      break;
  }
  
  if (items.length === 0) return null;
  
  return (
    <div className="flex items-center gap-3 text-xs mt-2">
      {items.map((item, index) => (
        <span key={index}>
          {item}
          {index < items.length - 1 && (
            <span className="ml-3 text-gray-600">•</span>
          )}
        </span>
      ))}
    </div>
  );
}

export function TimelineEventCard({ 
  event, 
  showConnector = true,
  isLast = false 
}: TimelineEventCardProps) {
  const config = ENTITY_CONFIG[event.entityType];
  const link = getEntityLink(event);
  const timestamp = new Date(event.timestamp);
  
  const cardClasses = `flex-1 p-4 bg-gray-800/50 border rounded-lg transition-all hover:bg-gray-800/70 group ${
    link ? 'cursor-pointer hover:border-gray-600' : ''
  } ${config.borderColor}`;
  
  const cardContent = (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        {/* Header Row */}
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className={`text-xs font-medium ${config.color}`}>
            {config.label}
          </span>
          <StatusBadge status={event.status} color={event.statusColor} />
        </div>
        
        {/* Title */}
        <h3 className="font-medium text-gray-200 group-hover:text-white transition-colors line-clamp-1">
          {event.title}
        </h3>
        
        {/* Description */}
        {event.description && (
          <p className="text-sm text-gray-400 mt-1 line-clamp-2">
            {event.description}
          </p>
        )}
        
        {/* Metadata */}
        {renderMetadata(event)}
        
        {/* Related Entities */}
        {event.relatedEntities && event.relatedEntities.length > 0 && (
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-gray-500">Related:</span>
            {event.relatedEntities.slice(0, 3).map((related, idx) => (
              <span 
                key={idx}
                className="text-xs px-2 py-0.5 bg-gray-700 rounded text-gray-300"
              >
                {related.label}
              </span>
            ))}
            {event.relatedEntities.length > 3 && (
              <span className="text-xs text-gray-500">
                +{event.relatedEntities.length - 3} more
              </span>
            )}
          </div>
        )}
      </div>
      
      {/* Timestamp & Action */}
      <div className="flex flex-col items-end gap-2 flex-shrink-0">
        <time 
          className="text-xs text-gray-500"
          title={format(timestamp, 'PPpp')}
        >
          {formatDistanceToNow(timestamp, { addSuffix: true })}
        </time>
        
        {link && (
          <div className="flex items-center gap-1 text-xs text-gray-400 group-hover:text-cyan-400 transition-colors">
            <span>View</span>
            <ChevronRight size={14} />
          </div>
        )}
      </div>
    </div>
  );
  
  return (
    <div className="relative flex gap-4">
      {/* Timeline Connector Line */}
      {showConnector && !isLast && (
        <div 
          className="absolute left-4 top-10 bottom-0 w-px bg-gradient-to-b from-gray-600 to-gray-800"
          style={{ transform: 'translateX(-50%)' }}
        />
      )}
      
      {/* Entity Icon */}
      <div className="relative z-10 flex-shrink-0">
        <EntityIcon entityType={event.entityType} size="md" />
      </div>
      
      {/* Event Content */}
      {link ? (
        <Link to={link} className={cardClasses}>
          {cardContent}
        </Link>
      ) : (
        <div className={cardClasses}>
          {cardContent}
        </div>
      )}
    </div>
  );
}

/**
 * Timeline skeleton loader for loading states
 */
export function TimelineEventCardSkeleton() {
  return (
    <div className="relative flex gap-4 animate-pulse">
      {/* Icon placeholder */}
      <div className="w-8 h-8 bg-gray-700 rounded-lg flex-shrink-0" />
      
      {/* Content placeholder */}
      <div className="flex-1 p-4 bg-gray-800/50 border border-gray-700 rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-16 h-4 bg-gray-700 rounded" />
          <div className="w-12 h-4 bg-gray-700 rounded" />
        </div>
        <div className="w-3/4 h-5 bg-gray-700 rounded mb-2" />
        <div className="w-1/2 h-4 bg-gray-700 rounded" />
      </div>
    </div>
  );
}

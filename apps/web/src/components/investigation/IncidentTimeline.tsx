/**
 * IncidentTimeline - Interactive timeline visualization
 * Shows OODA progression with events
 */
import { memo, useMemo } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import {
  Search,
  Lightbulb,
  Zap,
  Circle,
  Clock,
  type LucideIcon,
} from 'lucide-react';
import type { TimelineEvent, OODAState } from '../../types';

interface IncidentTimelineProps {
  events: TimelineEvent[];
  currentPhase: OODAState;
  className?: string;
  onEventClick?: (event: TimelineEvent) => void;
}

const OODA_PHASES: OODAState[] = ['OBSERVING', 'ORIENTING', 'DECIDING', 'ACTING', 'VERIFYING'];

const phaseColors: Record<OODAState, { bg: string; border: string; text: string; connector: string }> = {
  IDLE: { bg: 'bg-gray-500/10', border: 'border-gray-500', text: 'text-gray-400', connector: 'bg-gray-500' },
  OBSERVING: { bg: 'bg-observe/10', border: 'border-observe', text: 'text-observe', connector: 'bg-observe' },
  ORIENTING: { bg: 'bg-orient/10', border: 'border-orient', text: 'text-orient', connector: 'bg-orient' },
  DECIDING: { bg: 'bg-decide/10', border: 'border-decide', text: 'text-decide', connector: 'bg-decide' },
  ACTING: { bg: 'bg-act/10', border: 'border-act', text: 'text-act', connector: 'bg-act' },
  VERIFYING: { bg: 'bg-verify/10', border: 'border-verify', text: 'text-verify', connector: 'bg-verify' },
  DONE: { bg: 'bg-green-500/10', border: 'border-green-500', text: 'text-green-400', connector: 'bg-green-500' },
  FAILED: { bg: 'bg-red-500/10', border: 'border-red-500', text: 'text-red-400', connector: 'bg-red-500' },
};

const eventTypeIcons: Record<string, LucideIcon> = {
  evidence: Search,
  hypothesis: Lightbulb,
  action: Zap,
  phase_change: Circle,
};

export const IncidentTimeline = memo(function IncidentTimeline({
  events,
  currentPhase,
  className = '',
  onEventClick,
}: IncidentTimelineProps) {
  // Sort events by timestamp
  const sortedEvents = useMemo(() => {
    return [...events].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [events]);

  // Group events by phase
  const eventsByPhase = useMemo(() => {
    const groups: Record<OODAState, TimelineEvent[]> = {
      IDLE: [],
      OBSERVING: [],
      ORIENTING: [],
      DECIDING: [],
      ACTING: [],
      VERIFYING: [],
      DONE: [],
      FAILED: [],
    };

    sortedEvents.forEach((event) => {
      if (event.phase) {
        groups[event.phase].push(event);
      }
    });

    return groups;
  }, [sortedEvents]);

  const currentPhaseIndex = OODA_PHASES.indexOf(currentPhase);
  const isComplete = currentPhase === 'DONE';
  const isFailed = currentPhase === 'FAILED';

  return (
    <div className={`bg-gray-800/50 border border-gray-700 rounded-lg p-4 ${className}`}>
      <h3 className="text-sm font-medium text-gray-300 mb-4">Investigation Timeline</h3>

      {/* OODA Phase Progress */}
      <div className="flex items-center gap-1 mb-6 overflow-x-auto pb-2">
        {OODA_PHASES.map((phase, index) => {
          const isActive = phase === currentPhase;
          const isCompleted = isComplete || index < currentPhaseIndex;
          const colors = phaseColors[phase];

          return (
            <div key={phase} className="flex items-center flex-shrink-0">
              <div
                className={`
                  px-3 py-1.5 rounded-lg text-xs font-medium transition-all border
                  ${isActive ? `${colors.bg} ${colors.border} ${colors.text} scale-105 shadow-lg` : ''}
                  ${isCompleted && !isActive ? `${colors.bg} ${colors.border} ${colors.text} opacity-80` : ''}
                  ${!isActive && !isCompleted ? 'bg-gray-800 border-gray-700 text-gray-500' : ''}
                  ${isFailed && isActive ? 'bg-red-500/10 border-red-500 text-red-400' : ''}
                `}
              >
                {phase}
                {eventsByPhase[phase].length > 0 && (
                  <span className="ml-1.5 opacity-70">({eventsByPhase[phase].length})</span>
                )}
              </div>
              {index < OODA_PHASES.length - 1 && (
                <div
                  className={`w-6 h-0.5 mx-1 ${
                    isCompleted ? colors.connector : 'bg-gray-700'
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Timeline Events */}
      {sortedEvents.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <Clock size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">No timeline events yet</p>
        </div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-700" />

          {/* Events */}
          <div className="space-y-4">
            {sortedEvents.map((event) => {
              const colors = phaseColors[event.phase];

              return (
                <div
                  key={event.id}
                  className={`relative pl-10 ${onEventClick ? 'cursor-pointer' : ''}`}
                  onClick={() => onEventClick?.(event)}
                >
                  {/* Timeline dot */}
                  <div
                    className={`absolute left-2.5 w-3 h-3 rounded-full ${colors.border} border-2 bg-gray-900`}
                  />

                  {/* Event card */}
                  <div
                    className={`
                      p-3 rounded-lg border transition-colors
                      ${colors.bg} ${colors.border} border-opacity-30
                      ${onEventClick ? 'hover:border-opacity-60' : ''}
                    `}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {(() => {
                          const EventIcon = eventTypeIcons[event.type] || Circle;
                          return <EventIcon size={18} className={colors.text} />;
                        })()}
                        <div>
                          <p className="text-sm text-gray-200">{event.title}</p>
                          <p className="text-xs text-gray-500">{event.description}</p>
                        </div>
                      </div>

                      {event.confidence !== undefined && (
                        <span className={`text-xs ${colors.text} whitespace-nowrap`}>
                          {Math.round(event.confidence * 100)}%
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                      <span>{format(new Date(event.timestamp), 'HH:mm:ss')}</span>
                      <span className="opacity-50">
                        {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});

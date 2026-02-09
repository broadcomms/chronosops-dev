/**
 * AIActivityFeed - Real-time feed of AI activity via WebSocket + persisted data
 */
import { useState, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  Eye,
  Compass,
  Lightbulb,
  Zap,
  CheckCircle,
  CheckCircle2,
  XCircle,
  Circle,
  Bot,
  Link2,
  type LucideIcon,
} from 'lucide-react';
import { useWebSocket } from '../../context/WebSocketContext';
import { incidentsApi } from '../../api/incidents';
import type { OODAState } from '../../types';
import type {
  PhaseChangePayload,
  ThinkingStepPayload,
  TimelineEventPayload,
} from '../../types/websocket-events';

interface ActivityItem {
  id: string;
  timestamp: Date;
  type: 'phase_change' | 'evidence' | 'hypothesis' | 'action' | 'thinking';
  title: string;
  description?: string;
  phase?: OODAState;
  incidentId?: string;
}

const phaseIcons: Record<OODAState, LucideIcon> = {
  IDLE: Circle,
  OBSERVING: Eye,
  ORIENTING: Compass,
  DECIDING: Lightbulb,
  ACTING: Zap,
  VERIFYING: CheckCircle,
  DONE: CheckCircle2,
  FAILED: XCircle,
};

const phaseColors: Record<OODAState, string> = {
  IDLE: 'text-gray-400',
  OBSERVING: 'text-observe',
  ORIENTING: 'text-orient',
  DECIDING: 'text-decide',
  ACTING: 'text-act',
  VERIFYING: 'text-blue-400',
  DONE: 'text-green-400',
  FAILED: 'text-red-400',
};

interface AIActivityFeedProps {
  className?: string;
  maxItems?: number;
}

export function AIActivityFeed({ className = '', maxItems = 10 }: AIActivityFeedProps) {
  const { lastMessage, isConnected } = useWebSocket();
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load recent activity from database on mount
  useEffect(() => {
    async function loadRecentActivity() {
      try {
        // Fetch all incidents to get their timeline events
        const incidentsResponse = await incidentsApi.list({ limit: 5 });
        const incidents = incidentsResponse.data || [];

        // Fetch timeline events for recent incidents
        const allActivities: ActivityItem[] = [];
        for (const incident of incidents) {
          try {
            const timelineResponse = await incidentsApi.getTimeline(incident.id);
            const events = timelineResponse.data || [];

            // Convert timeline events to activity items
            for (const event of events.slice(-10)) {
              allActivities.push({
                id: event.id,
                timestamp: new Date(event.timestamp),
                type: event.type as ActivityItem['type'],
                title: event.title,
                description: event.description || undefined,
                phase: event.phase as OODAState | undefined,
                incidentId: incident.id,
              });
            }
          } catch {
            // Skip incidents without timeline data
          }
        }

        // Sort by timestamp (newest first) and limit
        allActivities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        setActivities(allActivities.slice(0, maxItems));
      } catch (err) {
        console.error('Failed to load recent activity:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadRecentActivity();
  }, [maxItems]);

  // Process incoming WebSocket messages
  useEffect(() => {
    if (!lastMessage) return;

    const { type, payload } = lastMessage;
    let newActivity: ActivityItem | null = null;

    switch (type) {
      case 'phase:change': {
        const p = payload as PhaseChangePayload;
        newActivity = {
          id: `phase-${Date.now()}`,
          timestamp: new Date(p.timestamp),
          type: 'phase_change',
          title: `Phase: ${p.phase}`,
          description: p.previousPhase ? `Transitioned from ${p.previousPhase}` : undefined,
          phase: p.phase,
          incidentId: p.incidentId,
        };
        break;
      }
      case 'thinking:step': {
        const p = payload as ThinkingStepPayload;
        newActivity = {
          id: `thinking-${Date.now()}`,
          timestamp: new Date(p.timestamp),
          type: 'thinking',
          title: p.step.title,
          description: p.step.description,
          phase: p.step.phase,
          incidentId: p.incidentId,
        };
        break;
      }
      case 'timeline:event': {
        const p = payload as TimelineEventPayload;
        newActivity = {
          id: `event-${Date.now()}`,
          timestamp: new Date(p.event.timestamp),
          type: p.event.type as ActivityItem['type'],
          title: p.event.title,
          incidentId: p.incidentId,
        };
        break;
      }
    }

    if (newActivity) {
      setActivities((prev) => [newActivity!, ...prev].slice(0, maxItems));
    }
  }, [lastMessage, maxItems]);

  if (!isConnected && isLoading) {
    return (
      <div className={`bg-gray-800/50 border border-gray-700 rounded-lg p-4 ${className}`}>
        <h3 className="text-sm font-medium text-gray-300 mb-4">AI Activity</h3>
        <div className="text-center py-8">
          <Link2 size={32} className="mx-auto mb-2 opacity-50 animate-pulse text-gray-400" />
          <p className="text-gray-500 text-sm">Loading activity...</p>
        </div>
      </div>
    );
  }

  if (activities.length === 0 && !isLoading) {
    return (
      <div className={`bg-gray-800/50 border border-gray-700 rounded-lg p-4 ${className}`}>
        <h3 className="text-sm font-medium text-gray-300 mb-4">AI Activity</h3>
        <div className="text-center py-8">
          <Bot size={32} className="mx-auto mb-2 opacity-50 text-gray-400" />
          <p className="text-gray-500 text-sm">No recent activity</p>
          <p className="text-gray-600 text-xs mt-1">AI events will appear here</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-gray-800/50 border border-gray-700 rounded-lg p-4 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-300">AI Activity</h3>
        <span className="flex items-center gap-1.5">
          {isConnected ? (
            <>
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-xs text-green-400">Live</span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 bg-gray-500 rounded-full" />
              <span className="text-xs text-gray-400">History</span>
            </>
          )}
        </span>
      </div>

      <div className="space-y-3 max-h-80 overflow-y-auto">
        {activities.map((activity) => (
          <div
            key={activity.id}
            className="flex items-start gap-3 p-2 rounded-lg bg-gray-900/50 hover:bg-gray-900/70 transition-colors"
          >
            {/* Icon */}
            <div
              className={`${activity.phase ? phaseColors[activity.phase] : 'text-gray-400'}`}
            >
              {activity.phase ? (
                (() => {
                  const PhaseIcon = phaseIcons[activity.phase];
                  return <PhaseIcon size={18} />;
                })()
              ) : (
                <Circle size={18} />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-200 truncate">{activity.title}</p>
              {activity.description && (
                <p className="text-xs text-gray-500 truncate">{activity.description}</p>
              )}
              <p className="text-xs text-gray-600 mt-0.5">
                {formatDistanceToNow(activity.timestamp, { addSuffix: true })}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

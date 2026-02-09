/**
 * WebSocket event type definitions for real-time updates
 */
import type {
  Incident,
  Evidence,
  Hypothesis,
  Action,
  OODAState,
  ConnectionState,
  FrameAnnotation,
  AnomalyDetection,
} from './index';

// Base WebSocket message structure
export interface WebSocketMessage<T = unknown> {
  type: string;
  payload?: T;
  timestamp?: string;
}

// Connection lifecycle events
export interface ConnectedEvent {
  timestamp: string;
}

export interface SubscribedEvent {
  channel: string;
  timestamp: string;
}

export interface UnsubscribedEvent {
  channel: string;
  timestamp: string;
}

// Phase change event
export interface PhaseChangePayload {
  incidentId: string;
  phase: OODAState;
  previousPhase?: OODAState;
  context?: Record<string, unknown>;
  timestamp: string;
}

// Incident update events
export type IncidentUpdateType =
  | 'evidence_collected'
  | 'hypothesis_generated'
  | 'action_executed'
  | 'verification_completed'
  | 'completed'
  | 'failed';

export interface IncidentUpdatePayload {
  incidentId: string;
  update: {
    type: IncidentUpdateType;
    evidence?: Evidence;
    hypothesis?: Hypothesis;
    action?: Action;
    result?: {
      success: boolean;
      message?: string;
      details?: Record<string, unknown>;
    };
    success?: boolean;
    details?: string;
    status?: string;
    duration?: number;
    reason?: string;
  };
  timestamp: string;
}

// Thinking step event (for AI reasoning transparency)
export interface ThinkingStepPayload {
  incidentId: string;
  step: {
    id: string;
    phase: OODAState;
    title: string;
    description: string;
    status: 'pending' | 'active' | 'completed';
    tokensUsed?: number;
    totalTokens?: number;
  };
  timestamp: string;
}

// Timeline event (for incident timeline visualization)
export interface TimelineEventPayload {
  incidentId: string;
  event: {
    id: string;
    timestamp: string;
    type: 'evidence' | 'hypothesis' | 'action' | 'phase_change';
    title: string;
    details: Record<string, unknown>;
    confidence?: number;
  };
}

// Frame analyzed event (for video annotations)
export interface FrameAnalyzedPayload {
  incidentId: string;
  frameNumber: number;
  timestamp: string;
  annotations: FrameAnnotation[];
  anomalies: AnomalyDetection[];
}

// Health update event (for system status)
export interface HealthUpdatePayload {
  api: ConnectionState;
  websocket: ConnectionState;
  vision: ConnectionState;
  kubernetes: ConnectionState;
  metrics?: {
    cpu: number;
    memory: number;
    podsRunning: number;
    podsTotal: number;
  };
}

// Action progress event (for action execution tracking)
export interface ActionProgressPayload {
  incidentId: string;
  actionId: string;
  progress: number; // 0-100
  status: 'pending' | 'executing' | 'completed' | 'failed';
  message?: string;
}

// Incident created event
export interface IncidentCreatedPayload {
  incident: Incident;
}

// Complete WebSocket events type map
export interface WebSocketEvents {
  // Connection lifecycle
  connected: ConnectedEvent;
  subscribed: SubscribedEvent;
  unsubscribed: UnsubscribedEvent;
  pong: { timestamp: string };

  // Core events
  'incident:created': IncidentCreatedPayload;
  'phase:change': PhaseChangePayload;
  'incident:update': IncidentUpdatePayload;

  // Enhanced UI events
  'thinking:step': ThinkingStepPayload;
  'timeline:event': TimelineEventPayload;
  'frame:analyzed': FrameAnalyzedPayload;
  'health:update': HealthUpdatePayload;
  'action:progress': ActionProgressPayload;
}

// Helper type for extracting payload type
export type WebSocketEventPayload<K extends keyof WebSocketEvents> = WebSocketEvents[K];

// Subscription message types
export interface SubscribeMessage {
  type: 'subscribe';
  payload: {
    channel: string;
  };
}

export interface UnsubscribeMessage {
  type: 'unsubscribe';
  payload: {
    channel: string;
  };
}

export interface PingMessage {
  type: 'ping';
}

export type OutgoingWebSocketMessage = SubscribeMessage | UnsubscribeMessage | PingMessage;

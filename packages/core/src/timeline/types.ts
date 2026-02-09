/**
 * Timeline Layer Types
 * Types for building and managing investigation timelines
 */

import type { OODAState } from '@chronosops/shared';

// ===========================================
// Timeline Event Types
// ===========================================

export type TimelineEventType =
  | 'incident_created'
  | 'investigation_started'
  | 'phase_transition'
  | 'evidence_collected'
  | 'correlation_found'
  | 'hypothesis_generated'
  | 'hypothesis_updated'
  | 'action_proposed'
  | 'action_executed'
  | 'action_verified'
  | 'insight_discovered'
  | 'escalation'
  | 'investigation_completed'
  | 'postmortem_generated';

export type TimelineEventSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface TimelineEvent {
  id: string;
  timestamp: Date;
  type: TimelineEventType;
  title: string;
  description: string;
  severity: TimelineEventSeverity;
  phase: OODAState;

  // Related entities
  incidentId: string;
  evidenceIds?: string[];
  hypothesisIds?: string[];
  actionId?: string;
  correlationId?: string;

  // Event-specific data
  data: Record<string, unknown>;

  // Visualization helpers
  icon?: string;
  color?: string;
  duration?: number;  // Duration in ms if this is a period event
}

// ===========================================
// Phase Timeline Types
// ===========================================

export interface PhaseSpan {
  phase: OODAState;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  eventCount: number;
  summary: string;
  keyFindings: string[];
}

// ===========================================
// Timeline Summary Types
// ===========================================

export interface TimelineSummary {
  totalEvents: number;
  duration: {
    totalMs: number;
    formatted: string;
  };
  phases: PhaseSpan[];
  currentPhase: OODAState;
  keyMilestones: Array<{
    event: TimelineEvent;
    significance: string;
  }>;
  actionsTaken: number;
  hypothesesGenerated: number;
  evidenceCollected: number;
  correlationsFound: number;
}

// ===========================================
// Timeline Filter Types
// ===========================================

export interface TimelineFilter {
  types?: TimelineEventType[];
  phases?: OODAState[];
  severity?: TimelineEventSeverity[];
  startTime?: Date;
  endTime?: Date;
  search?: string;
}

// ===========================================
// Full Timeline Types
// ===========================================

export interface Timeline {
  id: string;
  incidentId: string;
  createdAt: Date;
  updatedAt: Date;

  events: TimelineEvent[];
  phases: PhaseSpan[];
  summary: TimelineSummary;

  // Causality tracking
  causalChain?: Array<{
    eventId: string;
    causedBy?: string;
    leadTo?: string[];
    relationship: string;
  }>;

  // For postmortem generation
  keyDecisions: Array<{
    timestamp: Date;
    decision: string;
    reasoning: string;
    outcome: string;
  }>;

  // Export formats
  markdownExport?: string;
  jsonExport?: string;
}

// ===========================================
// Timeline Builder Config
// ===========================================

export interface TimelineBuilderConfig {
  autoSummarize: boolean;
  summarizeThreshold: number;  // Number of events before auto-summarize
  trackCausality: boolean;
  maxEventsInMemory: number;
  persistEvents: boolean;
}

export const DEFAULT_TIMELINE_CONFIG: TimelineBuilderConfig = {
  autoSummarize: true,
  summarizeThreshold: 50,
  trackCausality: true,
  maxEventsInMemory: 1000,
  persistEvents: true,
};

// ===========================================
// Event Creation Helpers
// ===========================================

export interface CreateEventOptions {
  title: string;
  description: string;
  severity?: TimelineEventSeverity;
  data?: Record<string, unknown>;
  evidenceIds?: string[];
  hypothesisIds?: string[];
  actionId?: string;
  correlationId?: string;
}

// ===========================================
// Postmortem Types
// ===========================================

export interface PostmortemTimeline {
  incidentStart: Date;
  detectionTime: Date;
  investigationStart: Date;
  rootCauseIdentified?: Date;
  remediationStart?: Date;
  resolutionTime?: Date;

  // Time metrics
  timeToDetect: number;    // ms
  timeToResolve?: number;  // ms
  totalDuration: number;   // ms

  // Key phases
  phases: Array<{
    name: string;
    start: Date;
    end: Date;
    duration: number;
    summary: string;
  }>;

  // Actions timeline
  actions: Array<{
    timestamp: Date;
    action: string;
    result: 'success' | 'failure' | 'partial';
    impact: string;
  }>;

  // Root cause chain
  rootCauseChain: string[];

  // Lessons learned
  lessonsLearned: string[];

  // Recommendations
  recommendations: string[];
}

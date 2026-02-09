/**
 * Core types for ChronosOps
 */

// OODA States
export const OODA_STATES = {
  IDLE: 'IDLE',
  OBSERVING: 'OBSERVING',
  ORIENTING: 'ORIENTING',
  DECIDING: 'DECIDING',
  ACTING: 'ACTING',
  VERIFYING: 'VERIFYING',
  DONE: 'DONE',
  FAILED: 'FAILED',
} as const;

export type OODAState = (typeof OODA_STATES)[keyof typeof OODA_STATES];

// ===========================================
// Per-Phase Retry Configuration Types (Investigation OODA)
// ===========================================

/**
 * Per-phase retry state tracking for investigation OODA loop
 * Maps each phase to the number of retries attempted
 */
export type OODAPhaseRetryState = Partial<Record<OODAState, number>>;

/**
 * Configuration for per-phase retry limits in investigation OODA loop
 * Allows fine-grained control over retry behavior per phase
 */
export interface OODAPhaseRetryConfig {
  /** Default retry limit for all phases */
  defaultRetries: number;
  /** Override retry limits for specific phases */
  perPhase?: Partial<Record<OODAState, number>>;
}

/**
 * Default phase retry configuration for investigation OODA loop
 * - Early phases (OBSERVING, ORIENTING, DECIDING): Higher retries since Gemini timeouts are recoverable
 * - Later phases (ACTING, VERIFYING): Lower retries since they're more deterministic
 */
export const DEFAULT_OODA_PHASE_RETRY_CONFIG: OODAPhaseRetryConfig = {
  defaultRetries: 3,
  perPhase: {
    OBSERVING: 3,   // Video capture/frame analysis can timeout
    ORIENTING: 3,   // Full context analysis - Gemini timeouts
    DECIDING: 2,    // Hypothesis generation
    ACTING: 2,      // K8s actions are deterministic
    VERIFYING: 2,   // Re-analysis can timeout
  },
};

// Incident types
export interface Incident {
  id: string;
  title: string;
  description: string | null;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'active' | 'investigating' | 'mitigating' | 'resolved' | 'closed';
  state: OODAState;
  namespace: string;
  monitoredAppId: string | null; // Direct link to MonitoredApp for investigation targeting
  startedAt: Date;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  thumbnail: string | null; // Base64 encoded image from first captured frame
  phaseRetries?: OODAPhaseRetryState; // Per-phase retry tracking for resilient self-healing
}

// Evidence types
export const EVIDENCE_TYPES = {
  VIDEO_FRAME: 'video_frame',
  LOG: 'log',
  METRIC: 'metric',
  K8S_EVENT: 'k8s_event',
  USER_REPORT: 'user_report',
} as const;

export type EvidenceType = (typeof EVIDENCE_TYPES)[keyof typeof EVIDENCE_TYPES];

export interface Evidence {
  id: string;
  incidentId: string;
  type: EvidenceType;
  source: string;
  content: Record<string, unknown>;
  timestamp: Date;
  confidence: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

// Hypothesis types
export type HypothesisStatus = 'proposed' | 'testing' | 'confirmed' | 'rejected';

export interface Hypothesis {
  id: string;
  incidentId: string;
  title: string;
  description: string;
  confidence: number;
  status: HypothesisStatus;
  evidence: string[];
  suggestedAction?: string;
  reasoning?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Action types
export const ACTION_TYPES = {
  ROLLBACK: 'rollback',
  RESTART: 'restart',
  SCALE: 'scale',
  MANUAL: 'manual',
  CODE_FIX: 'code_fix',
} as const;

export type ActionType = (typeof ACTION_TYPES)[keyof typeof ACTION_TYPES];

export type ActionStatus = 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled';

export interface Action {
  id: string;
  incidentId: string;
  hypothesisId: string;
  actionType: ActionType;
  target: string;
  parameters: Record<string, unknown>;
  status: ActionStatus;
  result?: string;
  executedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

// Verification types
export interface Verification {
  id: string;
  actionId: string;
  incidentId: string;
  verificationType: 'health_check' | 'metric_recovery' | 'error_rate' | 'visual';
  target: string;
  passed: boolean;
  confidence: number;
  details?: Record<string, unknown>;
  executedAt: Date;
}

// Timeline types
export interface TimelineEntry {
  id: string;
  incidentId: string;
  entryType: 'observation' | 'hypothesis' | 'action' | 'verification' | 'conclusion';
  phase: OODAState;
  timestamp: Date;
  title: string;
  description: string;
  confidence?: number;
  reasoning?: string;
  thinkingBudget?: number;
}

// Postmortem types
export interface Postmortem {
  id: string;
  incidentId: string;
  title: string;
  summary: string;
  timeline: TimelineEntry[];
  rootCause: string;
  resolution: string;
  lessonsLearned: string[];
  actionItems: string[];
  generatedAt: Date;
}

// Thought state for Gemini reasoning
export interface ThoughtState {
  signature: string;
  timestamp: Date;
  incidentId: string;
  currentPhase: OODAState;
  observations: string[];
  hypotheses: Hypothesis[];
  rejectedHypotheses: Hypothesis[];
  currentFocus: string;
  reasoningChain: ReasoningStep[];
  thinkingBudget: number;
}

export interface ReasoningStep {
  timestamp: Date;
  type: 'observation' | 'inference' | 'hypothesis' | 'test' | 'conclusion';
  content: string;
  confidence: number;
  evidence: string[];
}

// Frame analysis types
export interface FrameAnalysis {
  frameId: string;
  timestamp: Date;
  systemState: 'healthy' | 'degraded' | 'critical';
  metrics: MetricObservation[];
  anomalies: Anomaly[];
  observations: string[];
  confidence: number;
}

export interface MetricObservation {
  name: string;
  value: number;
  unit: string;
  status: 'normal' | 'warning' | 'critical';
}

export interface Anomaly {
  type: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  location?: string;
}

// Result type for predictable errors
export type Result<T, E = Error> =
  | { success: true; value: T }
  | { success: false; error: E };

// Configuration types
export * from './config.js';

// Platform abstraction types
export * from './platform.js';

// Development cycle types (self-regenerating ecosystem)
export * from './development.js';
export * from './requirement.js';
export * from './architecture.js';
export * from './generated-code.js';
export * from './generated-schema.js';
export * from './build.js';

// Service registry types (multi-service architecture)
export * from './service-registry.js';

// Unified timeline types (history view)
export * from './timeline.js';

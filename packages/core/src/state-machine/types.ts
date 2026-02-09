/**
 * State machine types
 */

import type {
  OODAState,
  Incident,
  Evidence,
  Hypothesis,
  Action,
  ThoughtState,
  OODAPhaseRetryState,
} from '@chronosops/shared';

export interface StateContext {
  incident: Incident;
  evidence: Evidence[];
  hypotheses: Hypothesis[];
  actions: Action[];
  thoughtState: ThoughtState | null;
  startedAt: Date;
  phaseStartedAt: Date;
  retryCount: number; // Legacy global counter
  maxRetries: number; // Legacy global limit
  // Verification retry tracking
  verificationRetryCount: number;
  maxVerificationRetries: number;
  lastVerificationResult?: {
    success: boolean;
    details: string;
    attemptNumber: number;
    timestamp: Date;
  };
  failureReason?: string;
  // Per-phase retry tracking for resilient self-healing
  phaseRetries: OODAPhaseRetryState;
}

export interface FailureDetails {
  phase: OODAState;
  retryAttempts: number;
  lastAction?: Action;
  lastVerificationResult?: {
    success: boolean;
    details: string;
  };
  timestamp: Date;
}

export interface StateMachineEvents {
  'state:changed': { from: OODAState; to: OODAState; context: StateContext };
  'state:entered': { state: OODAState; context: StateContext };
  'state:exited': { state: OODAState; context: StateContext };
  'error': { state: OODAState; error: Error; context: StateContext };
  'phase:timeout': { state: OODAState; elapsed: number; context: StateContext };
  'action:executed': { action: Action; success: boolean };
  'incident:resolved': { incident: Incident; duration: number };
  'incident:failed': { incident: Incident; reason: string; failureDetails: FailureDetails };
}

export interface PhaseConfig {
  timeoutMs: number;
  maxRetries: number;
  onEnter?: (context: StateContext) => Promise<void>;
  onExit?: (context: StateContext) => Promise<void>;
}

export interface StateMachineConfig {
  phases: Record<OODAState, PhaseConfig>;
  confidenceThreshold: number;
  maxActionsPerIncident: number;
  actionCooldownMs: number;
}

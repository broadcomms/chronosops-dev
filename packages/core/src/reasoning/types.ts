/**
 * Reasoning Layer Types
 * Types for thought state management and reasoning continuity
 */

import type { OODAState } from '@chronosops/shared';

// ===========================================
// Thinking Level Types
// ===========================================

export type ThinkingLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export const THINKING_LEVEL_BUDGETS: Record<ThinkingLevel, number> = {
  LOW: 1024,
  MEDIUM: 8192,
  HIGH: 24576,
};

// ===========================================
// Reasoning Step Types
// ===========================================

export type ReasoningStepType =
  | 'observation'
  | 'inference'
  | 'hypothesis'
  | 'test'
  | 'conclusion'
  | 'rejection';

export interface ReasoningStep {
  id: string;
  timestamp: Date;
  type: ReasoningStepType;
  content: string;
  confidence: number;
  evidence: string[];      // Evidence IDs supporting this step
  phase: OODAState;
  parentStepId?: string;   // For chained reasoning
}

// ===========================================
// Thought State Types
// ===========================================

export interface ThoughtState {
  id: string;
  incidentId: string;
  signature?: string;       // Gemini thought signature for continuity
  signatureHash?: string;
  timestamp: Date;
  phase: OODAState;
  thinkingLevel: ThinkingLevel;
  thinkingBudget: number;
  tokensUsed?: number;

  // Reasoning context
  observations: string[];
  hypotheses: Array<{
    id: string;
    description: string;
    confidence: number;
    status: 'active' | 'testing' | 'confirmed' | 'rejected';
  }>;
  rejectedHypotheses: Array<{
    id: string;
    description: string;
    rejectionReason: string;
  }>;
  currentFocus: string;
  reasoningChain: ReasoningStep[];

  // Summary for continuation
  summary: string;
  insights: string[];
  keyFindings: string[];
}

// ===========================================
// Thought State Manager Config
// ===========================================

export interface ThoughtStateManagerConfig {
  defaultThinkingLevel: ThinkingLevel;
  escalationThreshold: number;    // confidence below which to escalate
  deescalationThreshold: number;  // confidence above which to deescalate
  maxReasoningSteps: number;
  persistSignatures: boolean;
  summarizeAfterSteps: number;    // summarize old steps after this count
}

// ===========================================
// Escalation Types
// ===========================================

export interface EscalationDecision {
  shouldEscalate: boolean;
  currentLevel: ThinkingLevel;
  recommendedLevel: ThinkingLevel;
  reason: string;
  confidenceMetrics: {
    averageConfidence: number;
    lowestConfidence: number;
    uncertaintyCount: number;
  };
}

// ===========================================
// Continuation Context Types
// ===========================================

export interface ContinuationContext {
  previousPhase: OODAState;
  currentPhase: OODAState;
  keyObservations: string[];
  activeHypotheses: string[];
  rejectedHypotheses: string[];
  recentReasoning: string[];
  insights: string[];
  focusArea: string;
  thinkingBudget: number;
}

// ===========================================
// Transition Types
// ===========================================

export interface PhaseTransition {
  from: OODAState;
  to: OODAState;
  timestamp: Date;
  summary: string;
  carryForward: {
    observations: string[];
    hypotheses: string[];
    insights: string[];
  };
}

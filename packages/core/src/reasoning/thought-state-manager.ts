/**
 * Thought State Manager
 * Maintains reasoning continuity across OODA phases using Gemini thought signatures
 */

import { randomUUID } from 'crypto';
import { createChildLogger, type OODAState, OODA_STATES } from '@chronosops/shared';
import type {
  ThoughtState,
  ThinkingLevel,
  ReasoningStep,
  ThoughtStateManagerConfig,
  EscalationDecision,
  ContinuationContext,
  PhaseTransition,
} from './types.js';

const DEFAULT_CONFIG: ThoughtStateManagerConfig = {
  defaultThinkingLevel: 'MEDIUM',
  escalationThreshold: 0.4,      // Below 40% confidence = escalate
  deescalationThreshold: 0.8,    // Above 80% confidence = deescalate
  maxReasoningSteps: 50,
  persistSignatures: true,
  summarizeAfterSteps: 20,
};

const THINKING_BUDGETS: Record<ThinkingLevel, number> = {
  LOW: 1024,
  MEDIUM: 8192,
  HIGH: 24576,
};

export class ThoughtStateManager {
  private config: ThoughtStateManagerConfig;
  private currentState: ThoughtState | null = null;
  private stateHistory: ThoughtState[] = [];
  private transitions: PhaseTransition[] = [];
  private logger = createChildLogger({ component: 'ThoughtStateManager' });

  constructor(config: Partial<ThoughtStateManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize thought state for a new incident
   */
  initialize(incidentId: string): ThoughtState {
    const now = new Date();

    this.currentState = {
      id: randomUUID(),
      incidentId,
      timestamp: now,
      phase: OODA_STATES.IDLE,
      thinkingLevel: this.config.defaultThinkingLevel,
      thinkingBudget: THINKING_BUDGETS[this.config.defaultThinkingLevel],
      observations: [],
      hypotheses: [],
      rejectedHypotheses: [],
      currentFocus: 'Initializing investigation',
      reasoningChain: [],
      summary: '',
      insights: [],
      keyFindings: [],
    };

    this.stateHistory = [this.currentState];
    this.transitions = [];

    this.logger.info({
      incidentId,
      stateId: this.currentState.id,
      thinkingLevel: this.currentState.thinkingLevel,
    }, 'Thought state initialized');

    return this.currentState;
  }

  /**
   * Save current thought state and get signature
   */
  saveState(updates?: Partial<ThoughtState>): string {
    if (!this.currentState) {
      throw new Error('Thought state not initialized');
    }

    // Apply updates
    if (updates) {
      this.currentState = {
        ...this.currentState,
        ...updates,
        timestamp: new Date(),
      };
    }

    // Create signature from current state
    const signature = this.createSignature(this.currentState);
    this.currentState.signature = signature;
    this.currentState.signatureHash = this.hashSignature(signature);

    // Add to history
    this.stateHistory.push({ ...this.currentState });

    this.logger.debug({
      stateId: this.currentState.id,
      phase: this.currentState.phase,
      reasoningSteps: this.currentState.reasoningChain.length,
    }, 'Thought state saved');

    return signature;
  }

  /**
   * Load thought state from signature
   */
  loadState(signatureOrId: string): ThoughtState | null {
    // Try to find by signature hash
    const byHash = this.stateHistory.find(
      (s) => s.signatureHash === signatureOrId || s.signature === signatureOrId
    );
    if (byHash) {
      this.currentState = { ...byHash };
      return this.currentState;
    }

    // Try to find by ID
    const byId = this.stateHistory.find((s) => s.id === signatureOrId);
    if (byId) {
      this.currentState = { ...byId };
      return this.currentState;
    }

    // Try to decode signature
    try {
      const decoded = Buffer.from(signatureOrId, 'base64').toString('utf-8');
      const parsed = JSON.parse(decoded) as Partial<ThoughtState>;

      if (parsed.incidentId) {
        this.currentState = {
          id: randomUUID(),
          incidentId: parsed.incidentId,
          signature: signatureOrId,
          timestamp: new Date(),
          phase: parsed.phase ?? OODA_STATES.IDLE,
          thinkingLevel: parsed.thinkingLevel ?? this.config.defaultThinkingLevel,
          thinkingBudget: parsed.thinkingBudget ?? THINKING_BUDGETS[this.config.defaultThinkingLevel],
          observations: parsed.observations ?? [],
          hypotheses: parsed.hypotheses ?? [],
          rejectedHypotheses: parsed.rejectedHypotheses ?? [],
          currentFocus: parsed.currentFocus ?? '',
          reasoningChain: parsed.reasoningChain ?? [],
          summary: parsed.summary ?? '',
          insights: parsed.insights ?? [],
          keyFindings: parsed.keyFindings ?? [],
        };
        return this.currentState;
      }
    } catch {
      // Not a valid encoded state
    }

    return null;
  }

  /**
   * Get the current thought state
   */
  getCurrentState(): ThoughtState | null {
    return this.currentState;
  }

  /**
   * Get the latest thought state for an incident
   */
  getLatestState(incidentId: string): ThoughtState | null {
    const states = this.stateHistory
      .filter((s) => s.incidentId === incidentId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return states[0] ?? null;
  }

  /**
   * Add a reasoning step to the chain
   */
  addReasoning(step: Omit<ReasoningStep, 'id' | 'timestamp'>): ReasoningStep {
    if (!this.currentState) {
      throw new Error('Thought state not initialized');
    }

    const fullStep: ReasoningStep = {
      ...step,
      id: randomUUID(),
      timestamp: new Date(),
    };

    this.currentState.reasoningChain.push(fullStep);
    this.currentState.timestamp = new Date();

    // Check if we need to summarize old steps
    if (
      this.currentState.reasoningChain.length > this.config.summarizeAfterSteps
    ) {
      this.summarizeOldSteps();
    }

    // Check if we're exceeding max steps
    if (this.currentState.reasoningChain.length > this.config.maxReasoningSteps) {
      // Remove oldest steps beyond the limit
      const excess = this.currentState.reasoningChain.length - this.config.maxReasoningSteps;
      this.currentState.reasoningChain.splice(0, excess);
    }

    this.logger.debug({
      stepId: fullStep.id,
      type: fullStep.type,
      confidence: fullStep.confidence,
    }, 'Reasoning step added');

    return fullStep;
  }

  /**
   * Get the full reasoning chain
   */
  getReasoningChain(): ReasoningStep[] {
    return this.currentState?.reasoningChain ?? [];
  }

  /**
   * Get recent reasoning steps
   */
  getRecentReasoning(count: number = 5): ReasoningStep[] {
    const chain = this.getReasoningChain();
    return chain.slice(-count);
  }

  /**
   * Get current thinking level based on confidence
   */
  getCurrentLevel(): ThinkingLevel {
    if (!this.currentState) {
      return this.config.defaultThinkingLevel;
    }

    return this.currentState.thinkingLevel;
  }

  /**
   * Evaluate whether thinking level should be changed
   */
  evaluateEscalation(): EscalationDecision {
    if (!this.currentState) {
      return {
        shouldEscalate: false,
        currentLevel: this.config.defaultThinkingLevel,
        recommendedLevel: this.config.defaultThinkingLevel,
        reason: 'No active state',
        confidenceMetrics: {
          averageConfidence: 0,
          lowestConfidence: 0,
          uncertaintyCount: 0,
        },
      };
    }

    // Calculate confidence metrics
    const activeHypotheses = this.currentState.hypotheses.filter(
      (h) => h.status === 'active' || h.status === 'testing'
    );

    const confidences = activeHypotheses.map((h) => h.confidence);
    const avgConfidence =
      confidences.length > 0
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length
        : 0;
    const lowestConfidence =
      confidences.length > 0 ? Math.min(...confidences) : 0;
    const uncertaintyCount = confidences.filter(
      (c) => c < this.config.escalationThreshold
    ).length;

    // Recent reasoning confidence
    const recentSteps = this.getRecentReasoning(5);
    const recentConfidences = recentSteps.map((s) => s.confidence);
    const recentAvgConfidence =
      recentConfidences.length > 0
        ? recentConfidences.reduce((a, b) => a + b, 0) / recentConfidences.length
        : avgConfidence;

    const currentLevel = this.currentState.thinkingLevel;
    let recommendedLevel = currentLevel;
    let reason = 'Confidence levels are acceptable';
    let shouldEscalate = false;

    // Check for escalation
    if (recentAvgConfidence < this.config.escalationThreshold) {
      if (currentLevel === 'LOW') {
        recommendedLevel = 'MEDIUM';
        shouldEscalate = true;
        reason = `Low confidence (${(recentAvgConfidence * 100).toFixed(0)}%) requires deeper analysis`;
      } else if (currentLevel === 'MEDIUM') {
        recommendedLevel = 'HIGH';
        shouldEscalate = true;
        reason = `Medium confidence insufficient (${(recentAvgConfidence * 100).toFixed(0)}%), escalating to high`;
      }
    }

    // Check for deescalation
    if (
      recentAvgConfidence > this.config.deescalationThreshold &&
      !shouldEscalate
    ) {
      if (currentLevel === 'HIGH') {
        recommendedLevel = 'MEDIUM';
        reason = `High confidence (${(recentAvgConfidence * 100).toFixed(0)}%) allows reduced thinking budget`;
      } else if (currentLevel === 'MEDIUM') {
        recommendedLevel = 'LOW';
        reason = `High confidence (${(recentAvgConfidence * 100).toFixed(0)}%) allows quick decisions`;
      }
    }

    return {
      shouldEscalate,
      currentLevel,
      recommendedLevel,
      reason,
      confidenceMetrics: {
        averageConfidence: avgConfidence,
        lowestConfidence,
        uncertaintyCount,
      },
    };
  }

  /**
   * Escalate thinking level (more tokens)
   */
  escalateLevel(reason: string): ThinkingLevel {
    if (!this.currentState) {
      return this.config.defaultThinkingLevel;
    }

    const currentLevel = this.currentState.thinkingLevel;
    let newLevel: ThinkingLevel = currentLevel;

    if (currentLevel === 'LOW') {
      newLevel = 'MEDIUM';
    } else if (currentLevel === 'MEDIUM') {
      newLevel = 'HIGH';
    }

    if (newLevel !== currentLevel) {
      this.currentState.thinkingLevel = newLevel;
      this.currentState.thinkingBudget = THINKING_BUDGETS[newLevel];

      this.addReasoning({
        type: 'inference',
        content: `Escalated thinking level from ${currentLevel} to ${newLevel}: ${reason}`,
        confidence: 0.9,
        evidence: [],
        phase: this.currentState.phase,
      });

      this.logger.info({
        from: currentLevel,
        to: newLevel,
        reason,
      }, 'Thinking level escalated');
    }

    return newLevel;
  }

  /**
   * De-escalate thinking level (fewer tokens)
   */
  deescalateLevel(): ThinkingLevel {
    if (!this.currentState) {
      return this.config.defaultThinkingLevel;
    }

    const currentLevel = this.currentState.thinkingLevel;
    let newLevel: ThinkingLevel = currentLevel;

    if (currentLevel === 'HIGH') {
      newLevel = 'MEDIUM';
    } else if (currentLevel === 'MEDIUM') {
      newLevel = 'LOW';
    }

    if (newLevel !== currentLevel) {
      this.currentState.thinkingLevel = newLevel;
      this.currentState.thinkingBudget = THINKING_BUDGETS[newLevel];

      this.logger.info({
        from: currentLevel,
        to: newLevel,
      }, 'Thinking level deescalated');
    }

    return newLevel;
  }

  /**
   * Get thinking budget for current level
   */
  getThinkingBudget(): number {
    if (!this.currentState) {
      return THINKING_BUDGETS[this.config.defaultThinkingLevel];
    }
    return this.currentState.thinkingBudget;
  }

  /**
   * Update current focus of investigation
   */
  setFocus(focus: string): void {
    if (!this.currentState) {
      return;
    }

    this.currentState.currentFocus = focus;
    this.currentState.timestamp = new Date();

    this.logger.debug({ focus }, 'Focus updated');
  }

  /**
   * Add observation to state
   */
  addObservation(observation: string): void {
    if (!this.currentState) {
      return;
    }

    this.currentState.observations.push(observation);
    this.currentState.timestamp = new Date();
  }

  /**
   * Add insight to state
   */
  addInsight(insight: string): void {
    if (!this.currentState) {
      return;
    }

    this.currentState.insights.push(insight);
    this.currentState.timestamp = new Date();
  }

  /**
   * Add key finding
   */
  addKeyFinding(finding: string): void {
    if (!this.currentState) {
      return;
    }

    this.currentState.keyFindings.push(finding);
    this.currentState.timestamp = new Date();
  }

  /**
   * Update hypothesis status
   */
  updateHypothesis(
    id: string,
    update: {
      confidence?: number;
      status?: 'active' | 'testing' | 'confirmed' | 'rejected';
    }
  ): void {
    if (!this.currentState) {
      return;
    }

    const hypothesis = this.currentState.hypotheses.find((h) => h.id === id);
    if (hypothesis) {
      if (update.confidence !== undefined) {
        hypothesis.confidence = update.confidence;
      }
      if (update.status !== undefined) {
        hypothesis.status = update.status;

        // If rejected, move to rejected list
        if (update.status === 'rejected') {
          this.currentState.rejectedHypotheses.push({
            id: hypothesis.id,
            description: hypothesis.description,
            rejectionReason: 'Evidence did not support hypothesis',
          });
        }
      }
    }

    this.currentState.timestamp = new Date();
  }

  /**
   * Add hypothesis to state
   */
  addHypothesis(hypothesis: Omit<ThoughtState['hypotheses'][0], 'id'>): string {
    if (!this.currentState) {
      throw new Error('Thought state not initialized');
    }

    const id = randomUUID();
    this.currentState.hypotheses.push({
      ...hypothesis,
      id,
    });
    this.currentState.timestamp = new Date();

    return id;
  }

  /**
   * Generate continuation context for Gemini
   */
  getContinuationContext(): ContinuationContext {
    if (!this.currentState) {
      return {
        previousPhase: OODA_STATES.IDLE,
        currentPhase: OODA_STATES.IDLE,
        keyObservations: [],
        activeHypotheses: [],
        rejectedHypotheses: [],
        recentReasoning: [],
        insights: [],
        focusArea: '',
        thinkingBudget: THINKING_BUDGETS[this.config.defaultThinkingLevel],
      };
    }

    // Get previous phase from transitions
    const lastTransition = this.transitions[this.transitions.length - 1];
    const previousPhase = lastTransition?.from ?? OODA_STATES.IDLE;

    return {
      previousPhase,
      currentPhase: this.currentState.phase,
      keyObservations: this.currentState.observations.slice(-5),
      activeHypotheses: this.currentState.hypotheses
        .filter((h) => h.status === 'active' || h.status === 'testing')
        .map((h) => `${h.description} (${(h.confidence * 100).toFixed(0)}% confidence)`),
      rejectedHypotheses: this.currentState.rejectedHypotheses.map(
        (h) => h.description
      ),
      recentReasoning: this.getRecentReasoning(3).map((r) => r.content),
      insights: this.currentState.insights.slice(-3),
      focusArea: this.currentState.currentFocus,
      thinkingBudget: this.currentState.thinkingBudget,
    };
  }

  /**
   * Format continuation context as string for prompts
   */
  formatContinuationContext(): string {
    const ctx = this.getContinuationContext();

    return `
Previous Investigation Context:
- Current Phase: ${ctx.currentPhase}
- Previous Phase: ${ctx.previousPhase}
- Focus Area: ${ctx.focusArea}

Key Observations:
${ctx.keyObservations.map((o) => `  - ${o}`).join('\n') || '  (none)'}

Active Hypotheses:
${ctx.activeHypotheses.map((h) => `  - ${h}`).join('\n') || '  (none)'}

Rejected Hypotheses:
${ctx.rejectedHypotheses.map((h) => `  - ${h}`).join('\n') || '  (none)'}

Recent Reasoning:
${ctx.recentReasoning.map((r) => `  → ${r}`).join('\n') || '  (none)'}

Key Insights:
${ctx.insights.map((i) => `  ★ ${i}`).join('\n') || '  (none)'}

Thinking Budget: ${ctx.thinkingBudget} tokens
    `.trim();
  }

  /**
   * Transition to new phase
   */
  transitionPhase(newPhase: OODAState): PhaseTransition {
    if (!this.currentState) {
      throw new Error('Thought state not initialized');
    }

    const oldPhase = this.currentState.phase;

    // Create transition record
    const transition: PhaseTransition = {
      from: oldPhase,
      to: newPhase,
      timestamp: new Date(),
      summary: this.generatePhaseSummary(oldPhase),
      carryForward: {
        observations: this.currentState.observations.slice(-5),
        hypotheses: this.currentState.hypotheses
          .filter((h) => h.status !== 'rejected')
          .map((h) => h.description),
        insights: this.currentState.insights.slice(-3),
      },
    };

    this.transitions.push(transition);

    // Update current state
    this.currentState.phase = newPhase;
    this.currentState.timestamp = new Date();

    // Add reasoning step for transition
    this.addReasoning({
      type: 'conclusion',
      content: `Transitioned from ${oldPhase} to ${newPhase}: ${transition.summary}`,
      confidence: 1.0,
      evidence: [],
      phase: newPhase,
    });

    this.logger.info({
      from: oldPhase,
      to: newPhase,
      summary: transition.summary,
    }, 'Phase transition');

    return transition;
  }

  /**
   * Reset state
   */
  reset(): void {
    this.currentState = null;
    this.stateHistory = [];
    this.transitions = [];
    this.logger.debug('Thought state reset');
  }

  // ===========================================
  // Private Helper Methods
  // ===========================================

  private createSignature(state: ThoughtState): string {
    // Create a compact representation for continuity
    const compact = {
      id: state.id,
      incidentId: state.incidentId,
      phase: state.phase,
      thinkingLevel: state.thinkingLevel,
      currentFocus: state.currentFocus,
      observations: state.observations.slice(-3),
      hypotheses: state.hypotheses
        .filter((h) => h.status !== 'rejected')
        .slice(0, 3),
      insights: state.insights.slice(-2),
      summary: state.summary,
    };

    return Buffer.from(JSON.stringify(compact)).toString('base64');
  }

  private hashSignature(signature: string): string {
    // Simple hash for quick lookup
    let hash = 0;
    for (let i = 0; i < signature.length; i++) {
      const char = signature.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
  }

  private summarizeOldSteps(): void {
    if (!this.currentState) {
      return;
    }

    const stepsToSummarize = this.currentState.reasoningChain.slice(
      0,
      this.config.summarizeAfterSteps / 2
    );

    if (stepsToSummarize.length === 0) {
      return;
    }

    // Create summary of old steps
    const types = new Set(stepsToSummarize.map((s) => s.type));
    const avgConfidence =
      stepsToSummarize.reduce((sum, s) => sum + s.confidence, 0) /
      stepsToSummarize.length;

    const summary = `Summarized ${stepsToSummarize.length} reasoning steps (types: ${Array.from(types).join(', ')}, avg confidence: ${(avgConfidence * 100).toFixed(0)}%)`;

    // Update state summary
    this.currentState.summary = summary;

    // Remove old steps
    this.currentState.reasoningChain = this.currentState.reasoningChain.slice(
      stepsToSummarize.length
    );

    this.logger.debug({
      summarizedCount: stepsToSummarize.length,
      remainingSteps: this.currentState.reasoningChain.length,
    }, 'Old reasoning steps summarized');
  }

  private generatePhaseSummary(phase: OODAState): string {
    if (!this.currentState) {
      return 'No summary available';
    }

    switch (phase) {
      case OODA_STATES.OBSERVING:
        return `Collected ${this.currentState.observations.length} observations`;

      case OODA_STATES.ORIENTING:
        return `Analyzed evidence and identified patterns`;

      case OODA_STATES.DECIDING:
        const activeHypotheses = this.currentState.hypotheses.filter(
          (h) => h.status !== 'rejected'
        );
        return `Generated ${activeHypotheses.length} hypotheses, rejected ${this.currentState.rejectedHypotheses.length}`;

      case OODA_STATES.ACTING:
        return `Executed remediation action`;

      case OODA_STATES.VERIFYING:
        return `Verified action results`;

      default:
        return `Completed ${phase} phase`;
    }
  }
}

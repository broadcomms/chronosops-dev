/**
 * OODA Loop State Machine Implementation
 * Includes per-phase retry tracking and server restart recovery for resilient self-healing
 */

import { EventEmitter } from 'eventemitter3';
import {
  OODA_STATES,
  type OODAState,
  type Incident,
  type OODAPhaseRetryState,
  type OODAPhaseRetryConfig,
  DEFAULT_OODA_PHASE_RETRY_CONFIG,
} from '@chronosops/shared';
import { logPhaseTransition, createChildLogger } from '@chronosops/shared';
import { transitionValidator } from './transitions.js';
import type { StateContext, StateMachineEvents, StateMachineConfig, PhaseConfig } from './types.js';

const DEFAULT_PHASE_CONFIG: PhaseConfig = {
  timeoutMs: 60000,
  maxRetries: 3,
};

const DEFAULT_CONFIG: StateMachineConfig = {
  phases: {
    [OODA_STATES.IDLE]: { ...DEFAULT_PHASE_CONFIG, timeoutMs: Infinity },
    [OODA_STATES.OBSERVING]: { ...DEFAULT_PHASE_CONFIG, timeoutMs: 60000 },
    [OODA_STATES.ORIENTING]: { ...DEFAULT_PHASE_CONFIG, timeoutMs: 60000 },
    [OODA_STATES.DECIDING]: { ...DEFAULT_PHASE_CONFIG, timeoutMs: 60000 },
    // ACTING needs 5 minutes for escalating remediation: rollback → restart → scale → code_fix
    // Each action takes ~10-30s for verification, and code_fix may trigger async evolution
    [OODA_STATES.ACTING]: { ...DEFAULT_PHASE_CONFIG, timeoutMs: 300000 },
    [OODA_STATES.VERIFYING]: { ...DEFAULT_PHASE_CONFIG, timeoutMs: 60000 },
    [OODA_STATES.DONE]: { ...DEFAULT_PHASE_CONFIG, timeoutMs: Infinity },
    [OODA_STATES.FAILED]: { ...DEFAULT_PHASE_CONFIG, timeoutMs: Infinity },
  },
  confidenceThreshold: 0.7,
  maxActionsPerIncident: 5,
  actionCooldownMs: 60000,
};

export class OODAStateMachine extends EventEmitter<StateMachineEvents> {
  private currentState: OODAState = OODA_STATES.IDLE;
  private context: StateContext | null = null;
  private config: StateMachineConfig;
  private phaseTimer: NodeJS.Timeout | null = null;
  private logger = createChildLogger({ component: 'StateMachine' });

  // Per-phase retry tracking for resilient self-healing
  private phaseRetries: OODAPhaseRetryState = {};
  private phaseRetryConfig: OODAPhaseRetryConfig;

  constructor(config: Partial<StateMachineConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.phaseRetryConfig = DEFAULT_OODA_PHASE_RETRY_CONFIG;
  }

  /**
   * Get current state
   */
  getState(): OODAState {
    return this.currentState;
  }

  /**
   * Get current context
   */
  getContext(): StateContext | null {
    return this.context;
  }

  /**
   * Check if state machine is active (not idle or terminal)
   */
  isActive(): boolean {
    return (
      this.currentState !== OODA_STATES.IDLE &&
      !transitionValidator.isTerminalState(this.currentState)
    );
  }

  /**
   * Start investigation for an incident
   */
  async start(incident: Incident): Promise<void> {
    if (this.isActive()) {
      throw new Error('State machine is already active');
    }

    // Reset per-phase retries for new investigation
    this.phaseRetries = {};

    this.context = {
      incident,
      evidence: [],
      hypotheses: [],
      actions: [],
      thoughtState: null,
      startedAt: new Date(),
      phaseStartedAt: new Date(),
      retryCount: 0, // Legacy global counter
      maxRetries: this.config.phases[OODA_STATES.OBSERVING].maxRetries, // Legacy
      // Verification retry tracking
      verificationRetryCount: 0,
      maxVerificationRetries: 3,
      // Per-phase retry tracking
      phaseRetries: {},
    };

    await this.transition(OODA_STATES.OBSERVING);
  }

  /**
   * Transition to a new state
   */
  async transition(toState: OODAState): Promise<void> {
    const fromState = this.currentState;

    // Validate transition
    transitionValidator.validateTransition(fromState, toState);

    // Clear any existing timer
    this.clearPhaseTimer();

    // Exit current state
    const phaseConfig = this.config.phases[fromState];
    if (phaseConfig.onExit && this.context) {
      await phaseConfig.onExit(this.context);
    }
    this.emit('state:exited', { state: fromState, context: this.context! });

    // Update state
    this.currentState = toState;
    if (this.context) {
      this.context.phaseStartedAt = new Date();
    }

    // Log transition
    logPhaseTransition(
      this.context?.incident.id ?? 'unknown',
      fromState,
      toState,
      'state_machine_transition'
    );

    // Emit change event
    this.emit('state:changed', { from: fromState, to: toState, context: this.context! });

    // Enter new state
    const newPhaseConfig = this.config.phases[toState];
    if (newPhaseConfig.onEnter && this.context) {
      await newPhaseConfig.onEnter(this.context);
    }
    this.emit('state:entered', { state: toState, context: this.context! });

    // Set phase timer if not terminal
    if (!transitionValidator.isTerminalState(toState)) {
      this.setPhaseTimer(toState);
    }

    // Handle terminal states
    if (toState === OODA_STATES.DONE && this.context) {
      const duration = Date.now() - this.context.startedAt.getTime();
      this.emit('incident:resolved', { incident: this.context.incident, duration });
      this.reset();
    } else if (toState === OODA_STATES.FAILED && this.context) {
      const lastAction = this.context.actions[this.context.actions.length - 1];
      this.emit('incident:failed', {
        incident: this.context.incident,
        reason: this.context.failureReason ?? 'investigation_failed',
        failureDetails: {
          phase: fromState,
          retryAttempts: this.context.verificationRetryCount,
          lastAction,
          lastVerificationResult: this.context.lastVerificationResult
            ? {
                success: this.context.lastVerificationResult.success,
                details: this.context.lastVerificationResult.details,
              }
            : undefined,
          timestamp: new Date(),
        },
      });
      this.reset();
    }
  }

  /**
   * Add evidence to context
   */
  addEvidence(evidence: StateContext['evidence'][0]): void {
    if (!this.context) {
      throw new Error('No active context');
    }
    this.context.evidence.push(evidence);
  }

  /**
   * Add hypothesis to context
   */
  addHypothesis(hypothesis: StateContext['hypotheses'][0]): void {
    if (!this.context) {
      throw new Error('No active context');
    }
    this.context.hypotheses.push(hypothesis);
  }

  /**
   * Add action to context
   */
  addAction(action: StateContext['actions'][0]): void {
    if (!this.context) {
      throw new Error('No active context');
    }
    this.context.actions.push(action);
  }

  /**
   * Update thought state
   */
  updateThoughtState(thoughtState: StateContext['thoughtState']): void {
    if (!this.context) {
      throw new Error('No active context');
    }
    this.context.thoughtState = thoughtState;
  }

  /**
   * Increment verification retry counter
   */
  incrementVerificationRetry(): void {
    if (!this.context) {
      throw new Error('No active context');
    }
    this.context.verificationRetryCount = (this.context.verificationRetryCount ?? 0) + 1;
  }

  /**
   * Set failure reason for FAILED state
   */
  setFailureReason(reason: string): void {
    if (!this.context) {
      throw new Error('No active context');
    }
    this.context.failureReason = reason;
  }

  /**
   * Get failure reason
   */
  getFailureReason(): string | undefined {
    return this.context?.failureReason;
  }

  /**
   * Set last verification result
   */
  setLastVerificationResult(result: { success: boolean; details: string }): void {
    if (!this.context) {
      throw new Error('No active context');
    }
    this.context.lastVerificationResult = {
      ...result,
      attemptNumber: this.context.verificationRetryCount,
      timestamp: new Date(),
    };
  }

  /**
   * Reset state machine
   */
  reset(): void {
    this.clearPhaseTimer();
    this.currentState = OODA_STATES.IDLE;
    this.context = null;
    this.phaseRetries = {}; // Reset per-phase retries
  }

  // ===========================================
  // Per-Phase Retry Methods (Resilient Self-Healing)
  // ===========================================

  /**
   * Get maximum retry count for a specific phase
   */
  getPhaseMaxRetries(state: OODAState): number {
    return (
      this.phaseRetryConfig.perPhase?.[state] ??
      this.phaseRetryConfig.defaultRetries
    );
  }

  /**
   * Check if a phase can be retried and increment the retry counter if so
   * Returns true if retry is allowed, false if max retries exceeded
   */
  canRetryPhase(state: OODAState): boolean {
    const maxRetries = this.getPhaseMaxRetries(state);
    const currentRetries = this.phaseRetries[state] ?? 0;

    if (currentRetries >= maxRetries) {
      this.logger.warn({
        state,
        currentRetries,
        maxRetries,
      }, 'Phase max retries exceeded');
      return false;
    }

    // Increment retry count
    this.phaseRetries[state] = currentRetries + 1;

    // Sync to context for persistence
    if (this.context) {
      this.context.phaseRetries = { ...this.phaseRetries };
    }

    this.logger.info({
      state,
      retryAttempt: this.phaseRetries[state],
      maxRetries,
    }, 'Phase retry allowed');

    return true;
  }

  /**
   * Get the retry target phase based on current phase
   * - Early phases (OBSERVING, ORIENTING, DECIDING): retry themselves
   * - Later phases (ACTING, VERIFYING): go back to OBSERVING for fresh data
   */
  getRetryTarget(state: OODAState): OODAState {
    // Early phases retry themselves - Gemini timeouts are recoverable
    if (
      state === OODA_STATES.OBSERVING ||
      state === OODA_STATES.ORIENTING ||
      state === OODA_STATES.DECIDING
    ) {
      return state;
    }

    // Later phases go back to OBSERVING for fresh observation data
    return OODA_STATES.OBSERVING;
  }

  /**
   * Get current phase retry state
   */
  getPhaseRetryState(): OODAPhaseRetryState {
    return { ...this.phaseRetries };
  }

  /**
   * Restore phase retry state (for resume after server restart)
   */
  restorePhaseRetryState(state: OODAPhaseRetryState): void {
    this.phaseRetries = { ...state };
    this.logger.info({ restoredState: this.phaseRetries }, 'Phase retry state restored');
  }

  /**
   * Resume an interrupted investigation
   * Used for server restart recovery
   */
  async resume(
    incident: Incident,
    state: OODAState,
    phaseRetries?: OODAPhaseRetryState
  ): Promise<void> {
    if (this.isActive()) {
      throw new Error('State machine is already active');
    }

    // Initialize context with resumed state
    this.context = {
      incident,
      evidence: [],
      hypotheses: [],
      actions: [],
      thoughtState: null,
      startedAt: new Date(),
      phaseStartedAt: new Date(),
      retryCount: 0, // Legacy
      maxRetries: 3, // Legacy
      verificationRetryCount: 0,
      maxVerificationRetries: 3,
      phaseRetries: phaseRetries ?? {},
    };

    this.currentState = state;

    // Restore phase retry state if available
    if (phaseRetries) {
      this.restorePhaseRetryState(phaseRetries);
    }

    this.logger.info({
      incidentId: incident.id,
      state,
      phaseRetries: this.phaseRetries,
    }, 'Resuming investigation from interrupted state');

    // Emit phase entered to restart processing
    this.emit('state:entered', { state, context: this.context });

    // Set phase timer
    if (!transitionValidator.isTerminalState(state)) {
      this.setPhaseTimer(state);
    }
  }

  /**
   * Set phase timeout timer
   * Uses per-phase retry logic for resilient self-healing
   */
  private setPhaseTimer(state: OODAState): void {
    const config = this.config.phases[state];
    if (config.timeoutMs === Infinity) return;

    this.phaseTimer = setTimeout(() => {
      // Guard: Don't process timeout if phase has already changed
      // This handles race conditions where the timer callback is queued
      // in the event loop before clearTimeout() is called
      if (this.currentState !== state) {
        this.logger.debug(
          { timerState: state, currentState: this.currentState },
          'Phase timer ignored - phase already changed'
        );
        return;
      }

      if (this.context) {
        const elapsed = Date.now() - this.context.phaseStartedAt.getTime();
        this.emit('phase:timeout', { state, elapsed, context: this.context });

        this.logger.warn(
          { incidentId: this.context.incident.id, state, elapsed, timeout: config.timeoutMs },
          'Phase timed out'
        );

        // Use per-phase retry logic for resilient self-healing
        if (this.canRetryPhase(state)) {
          const retryTarget = this.getRetryTarget(state);
          this.logger.info({
            incidentId: this.context.incident.id,
            state,
            retryTarget,
            phaseRetries: this.phaseRetries[state],
            maxRetries: this.getPhaseMaxRetries(state),
          }, 'Phase timeout - retrying');

          this.setFailureReason(`Phase ${state} timed out, retrying`);
          this.transition(retryTarget).catch((err) => {
            this.emit('error', { state, error: err, context: this.context! });
          });
        } else {
          // Per-phase max retries exceeded - fail
          this.logger.error({
            incidentId: this.context.incident.id,
            state,
            phaseRetries: this.phaseRetries[state],
            maxRetries: this.getPhaseMaxRetries(state),
          }, 'Phase max retries exceeded - failing investigation');

          this.setFailureReason(
            `Phase ${state} timed out after ${this.phaseRetries[state] ?? 0} retries`
          );
          this.transition(OODA_STATES.FAILED).catch((err) => {
            this.emit('error', { state, error: err, context: this.context! });
          });
        }
      }
    }, config.timeoutMs);
  }

  /**
   * Clear phase timer
   */
  private clearPhaseTimer(): void {
    if (this.phaseTimer) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }
  }
}

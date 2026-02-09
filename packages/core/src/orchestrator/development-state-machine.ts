/**
 * Development State Machine
 * Manages phase transitions for the development OODA loop
 */

import { EventEmitter } from 'eventemitter3';
import { createChildLogger } from '@chronosops/shared';
import {
  DEVELOPMENT_PHASES,
  type DevelopmentPhase,
  type DevelopmentCycle,
  type DevelopmentConfig,
  type PhaseRetryState,
  type PhaseRetryConfig,
  DEFAULT_DEVELOPMENT_CONFIG,
  DEFAULT_PHASE_RETRY_CONFIG,
} from '@chronosops/shared';

// Valid transitions map - includes self-retry transitions for resilient self-healing
const VALID_TRANSITIONS: Record<DevelopmentPhase, DevelopmentPhase[]> = {
  [DEVELOPMENT_PHASES.IDLE]: [DEVELOPMENT_PHASES.ANALYZING],
  [DEVELOPMENT_PHASES.ANALYZING]: [
    DEVELOPMENT_PHASES.DESIGNING,
    DEVELOPMENT_PHASES.ANALYZING, // Self-retry on timeout
    DEVELOPMENT_PHASES.FAILED,
  ],
  [DEVELOPMENT_PHASES.DESIGNING]: [
    DEVELOPMENT_PHASES.CODING,
    DEVELOPMENT_PHASES.DESIGNING, // Self-retry on timeout
    DEVELOPMENT_PHASES.FAILED,
  ],
  [DEVELOPMENT_PHASES.CODING]: [
    DEVELOPMENT_PHASES.TESTING,
    DEVELOPMENT_PHASES.CODING, // Retry: regenerate code
    DEVELOPMENT_PHASES.FAILED,
  ],
  [DEVELOPMENT_PHASES.TESTING]: [
    DEVELOPMENT_PHASES.BUILDING,
    DEVELOPMENT_PHASES.CODING, // Retry: fix code and retest
    DEVELOPMENT_PHASES.FAILED,
  ],
  [DEVELOPMENT_PHASES.BUILDING]: [
    DEVELOPMENT_PHASES.DEPLOYING,
    DEVELOPMENT_PHASES.CODING, // Retry: fix code and rebuild
    DEVELOPMENT_PHASES.FAILED,
  ],
  [DEVELOPMENT_PHASES.DEPLOYING]: [
    DEVELOPMENT_PHASES.VERIFYING,
    DEVELOPMENT_PHASES.CODING, // Retry: fix deployment issues and redeploy
    DEVELOPMENT_PHASES.FAILED,
  ],
  [DEVELOPMENT_PHASES.VERIFYING]: [
    DEVELOPMENT_PHASES.COMPLETED,
    DEVELOPMENT_PHASES.CODING, // Retry: fix code and redeploy
    DEVELOPMENT_PHASES.FAILED,
  ],
  [DEVELOPMENT_PHASES.COMPLETED]: [], // Terminal
  [DEVELOPMENT_PHASES.FAILED]: [], // Terminal
};

export interface DevelopmentStateMachineEvents {
  'phase:changed': {
    from: DevelopmentPhase;
    to: DevelopmentPhase;
    cycle: DevelopmentCycle;
  };
  'phase:entered': {
    phase: DevelopmentPhase;
    cycle: DevelopmentCycle;
  };
  'phase:exited': {
    phase: DevelopmentPhase;
    cycle: DevelopmentCycle;
  };
  'phase:timeout': {
    phase: DevelopmentPhase;
    elapsed: number;
    cycle: DevelopmentCycle;
  };
  'cycle:completed': {
    cycle: DevelopmentCycle;
    duration: number;
  };
  'cycle:failed': {
    cycle: DevelopmentCycle;
    reason: string;
    phase: DevelopmentPhase;
  };
  error: {
    phase: DevelopmentPhase;
    error: Error;
    cycle: DevelopmentCycle;
  };
}

export class DevelopmentStateMachine extends EventEmitter<DevelopmentStateMachineEvents> {
  private currentPhase: DevelopmentPhase = DEVELOPMENT_PHASES.IDLE;
  private cycle: DevelopmentCycle | null = null;
  private config: DevelopmentConfig;
  private phaseTimer: NodeJS.Timeout | null = null;
  private phaseStartedAt: Date | null = null;
  private logger = createChildLogger({ component: 'DevStateMachine' });

  // Per-phase retry tracking for resilient self-healing
  private phaseRetries: PhaseRetryState = {};
  private phaseRetryConfig: PhaseRetryConfig;

  constructor(config: Partial<DevelopmentConfig> = {}) {
    super();
    this.config = { ...DEFAULT_DEVELOPMENT_CONFIG, ...config };
    this.phaseRetryConfig = this.config.phaseRetries ?? DEFAULT_PHASE_RETRY_CONFIG;
  }

  /**
   * Get current phase
   */
  getPhase(): DevelopmentPhase {
    return this.currentPhase;
  }

  /**
   * Get current cycle
   */
  getCycle(): DevelopmentCycle | null {
    return this.cycle;
  }

  /**
   * Check if state machine is active (not idle or terminal)
   */
  isActive(): boolean {
    return (
      this.currentPhase !== DEVELOPMENT_PHASES.IDLE &&
      !this.isTerminalPhase(this.currentPhase)
    );
  }

  /**
   * Check if phase is terminal
   */
  isTerminalPhase(phase: DevelopmentPhase): boolean {
    return (
      phase === DEVELOPMENT_PHASES.COMPLETED ||
      phase === DEVELOPMENT_PHASES.FAILED
    );
  }

  /**
   * Start a new development cycle
   */
  async start(cycle: DevelopmentCycle): Promise<void> {
    if (this.isActive()) {
      throw new Error('Development state machine is already active');
    }

    this.cycle = cycle;
    this.logger.info({ cycleId: cycle.id }, 'Starting development cycle');

    await this.transition(DEVELOPMENT_PHASES.ANALYZING);
  }

  /**
   * Transition to a new phase
   */
  async transition(toPhase: DevelopmentPhase): Promise<void> {
    const fromPhase = this.currentPhase;

    // Validate transition
    if (!this.isValidTransition(fromPhase, toPhase)) {
      throw new Error(
        `Invalid transition from ${fromPhase} to ${toPhase}. Valid transitions: ${VALID_TRANSITIONS[fromPhase].join(', ')}`
      );
    }

    // Clear any existing timer
    this.clearPhaseTimer();

    // Exit current phase
    this.emit('phase:exited', { phase: fromPhase, cycle: this.cycle! });

    // Update phase
    this.currentPhase = toPhase;
    this.phaseStartedAt = new Date();

    if (this.cycle) {
      this.cycle.phase = toPhase;
      this.cycle.updatedAt = new Date().toISOString();
    }

    this.logger.info(
      { cycleId: this.cycle?.id, fromPhase, toPhase },
      `Phase transition: ${fromPhase} -> ${toPhase}`
    );

    // Emit change event
    this.emit('phase:changed', {
      from: fromPhase,
      to: toPhase,
      cycle: this.cycle!,
    });

    // Enter new phase
    this.emit('phase:entered', { phase: toPhase, cycle: this.cycle! });

    // Set phase timer if not terminal
    if (!this.isTerminalPhase(toPhase)) {
      this.setPhaseTimer(toPhase);
    }

    // Handle terminal phases
    if (toPhase === DEVELOPMENT_PHASES.COMPLETED && this.cycle) {
      const duration = Date.now() - new Date(this.cycle.createdAt).getTime();
      this.cycle.completedAt = new Date().toISOString();
      this.emit('cycle:completed', { cycle: this.cycle, duration });
      this.logger.info(
        { cycleId: this.cycle.id, duration },
        'Development cycle completed successfully'
      );
    } else if (toPhase === DEVELOPMENT_PHASES.FAILED && this.cycle) {
      const reason = this.cycle.error?.message ?? 'Unknown error';
      this.emit('cycle:failed', {
        cycle: this.cycle,
        reason,
        phase: fromPhase,
      });
      this.logger.error(
        { cycleId: this.cycle.id, reason, phase: fromPhase },
        'Development cycle failed'
      );
    }
  }

  /**
   * Check if transition is valid
   */
  isValidTransition(from: DevelopmentPhase, to: DevelopmentPhase): boolean {
    return VALID_TRANSITIONS[from]?.includes(to) ?? false;
  }

  /**
   * Increment iteration count
   */
  incrementIteration(): boolean {
    if (!this.cycle) {
      throw new Error('No active cycle');
    }

    this.cycle.iterations++;
    this.logger.info(
      { cycleId: this.cycle.id, iterations: this.cycle.iterations },
      'Incrementing iteration count'
    );

    // Check if max iterations reached
    if (this.cycle.iterations >= this.cycle.maxIterations) {
      this.logger.warn(
        { cycleId: this.cycle.id, maxIterations: this.cycle.maxIterations },
        'Max iterations reached'
      );
      return false;
    }

    return true;
  }

  /**
   * Set error on cycle
   */
  setError(phase: DevelopmentPhase, message: string, recoverable: boolean): void {
    if (!this.cycle) {
      throw new Error('No active cycle');
    }

    this.cycle.error = {
      phase,
      message,
      recoverable,
    };
  }

  /**
   * Update cycle data
   */
  updateCycle(updates: Partial<DevelopmentCycle>): void {
    if (!this.cycle) {
      throw new Error('No active cycle');
    }

    Object.assign(this.cycle, updates);
    this.cycle.updatedAt = new Date().toISOString();
  }

  /**
   * Reset state machine
   */
  reset(): void {
    this.clearPhaseTimer();
    this.currentPhase = DEVELOPMENT_PHASES.IDLE;
    this.cycle = null;
    this.phaseStartedAt = null;
    this.phaseRetries = {};
  }

  /**
   * Get elapsed time in current phase
   */
  getPhaseElapsed(): number {
    if (!this.phaseStartedAt) return 0;
    return Date.now() - this.phaseStartedAt.getTime();
  }

  // ===========================================
  // Per-Phase Retry Methods (Resilient Self-Healing)
  // ===========================================

  /**
   * Get maximum retry count for a specific phase
   */
  getPhaseMaxRetries(phase: DevelopmentPhase): number {
    return (
      this.phaseRetryConfig.perPhase?.[phase] ??
      this.phaseRetryConfig.defaultRetries
    );
  }

  /**
   * Check if a phase can be retried and increment the retry counter if so
   * Returns true if retry is allowed, false if max retries exceeded
   */
  canRetryPhase(phase: DevelopmentPhase): boolean {
    const maxRetries = this.getPhaseMaxRetries(phase);
    const currentRetries = this.phaseRetries[phase] ?? 0;

    if (currentRetries >= maxRetries) {
      this.logger.warn({
        phase,
        currentRetries,
        maxRetries,
      }, 'Phase max retries exceeded');
      return false;
    }

    // Increment retry count
    this.phaseRetries[phase] = currentRetries + 1;

    // Sync to cycle for persistence
    if (this.cycle) {
      this.cycle.phaseRetries = { ...this.phaseRetries };
    }

    this.logger.info({
      phase,
      retryAttempt: this.phaseRetries[phase],
      maxRetries,
    }, 'Phase retry allowed');

    return true;
  }

  /**
   * Get the retry target phase based on current phase
   * - Early phases (ANALYZING, DESIGNING): retry themselves
   * - Later phases: go back to CODING for regeneration
   */
  getRetryTarget(phase: DevelopmentPhase): DevelopmentPhase {
    // Early phases retry themselves - Gemini timeouts are recoverable
    if (
      phase === DEVELOPMENT_PHASES.ANALYZING ||
      phase === DEVELOPMENT_PHASES.DESIGNING
    ) {
      return phase;
    }

    // Later phases go back to CODING for code regeneration
    return DEVELOPMENT_PHASES.CODING;
  }

  /**
   * Get current phase retry state
   */
  getPhaseRetryState(): PhaseRetryState {
    return { ...this.phaseRetries };
  }

  /**
   * Restore phase retry state (for resume after server restart)
   */
  restorePhaseRetryState(state: PhaseRetryState): void {
    this.phaseRetries = { ...state };
    this.logger.info({ restoredState: this.phaseRetries }, 'Phase retry state restored');
  }

  /**
   * Resume an interrupted development cycle
   * Used for server restart recovery
   */
  async resume(cycle: DevelopmentCycle): Promise<void> {
    if (this.isActive()) {
      throw new Error('Development state machine is already active');
    }

    this.cycle = cycle;
    this.currentPhase = cycle.phase;
    this.phaseStartedAt = new Date();

    // Restore phase retry state if available
    if (cycle.phaseRetries) {
      this.restorePhaseRetryState(cycle.phaseRetries);
    }

    this.logger.info({
      cycleId: cycle.id,
      phase: cycle.phase,
      phaseRetries: this.phaseRetries,
    }, 'Resuming development cycle from interrupted state');

    // Emit phase entered to restart processing
    this.emit('phase:entered', { phase: cycle.phase, cycle });

    // Set phase timer
    if (!this.isTerminalPhase(cycle.phase)) {
      this.setPhaseTimer(cycle.phase);
    }
  }

  /**
   * Get phase timeout from config
   */
  private getPhaseTimeout(phase: DevelopmentPhase): number {
    const phaseKey = phase.toLowerCase() as keyof typeof this.config.phaseTimeouts;
    return this.config.phaseTimeouts[phaseKey] ?? 60000;
  }

  /**
   * Set phase timeout timer
   * Uses per-phase retry logic for resilient self-healing
   */
  private setPhaseTimer(phase: DevelopmentPhase): void {
    const timeout = this.getPhaseTimeout(phase);
    if (timeout === Infinity) return;

    this.phaseTimer = setTimeout(() => {
      // Guard: Don't process timeout if phase has already changed
      // This handles race conditions where the timer callback is queued
      // in the event loop before clearTimeout() is called
      if (this.currentPhase !== phase) {
        this.logger.debug(
          { cycleId: this.cycle?.id, timerPhase: phase, currentPhase: this.currentPhase },
          'Phase timer ignored - phase already changed'
        );
        return;
      }

      if (this.cycle) {
        const elapsed = this.getPhaseElapsed();
        this.emit('phase:timeout', {
          phase,
          elapsed,
          cycle: this.cycle,
        });

        this.logger.warn(
          { cycleId: this.cycle.id, phase, elapsed, timeout },
          'Phase timed out'
        );

        // Use per-phase retry logic for resilient self-healing
        // Early phases (ANALYZING, DESIGNING) can now retry themselves
        if (this.canRetryPhase(phase)) {
          const retryTarget = this.getRetryTarget(phase);
          this.logger.info({
            cycleId: this.cycle.id,
            phase,
            retryTarget,
            phaseRetries: this.phaseRetries[phase],
            maxRetries: this.getPhaseMaxRetries(phase),
          }, 'Phase timeout - retrying');

          this.setError(phase, `Phase ${phase} timed out, retrying`, true);
          this.transition(retryTarget).catch((err) => {
            this.emit('error', { phase, error: err, cycle: this.cycle! });
          });
        } else {
          // Per-phase max retries exceeded - fail
          this.logger.error({
            cycleId: this.cycle.id,
            phase,
            phaseRetries: this.phaseRetries[phase],
            maxRetries: this.getPhaseMaxRetries(phase),
          }, 'Phase max retries exceeded - failing cycle');

          this.setError(
            phase,
            `Phase ${phase} timed out after ${this.phaseRetries[phase] ?? 0} retries`,
            false
          );
          this.transition(DEVELOPMENT_PHASES.FAILED).catch((err) => {
            this.emit('error', { phase, error: err, cycle: this.cycle! });
          });
        }
      }
    }, timeout);
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

/**
 * State transition definitions and validation
 */

import { OODA_STATES, type OODAState } from '@chronosops/shared';
import { InvalidTransitionError } from '@chronosops/shared';

export interface StateTransition {
  from: OODAState;
  to: OODAState;
  condition?: string;
}

// Valid state transitions
// Includes self-retry transitions for resilient self-healing (Gemini timeout recovery)
const VALID_TRANSITIONS: StateTransition[] = [
  // From IDLE
  { from: OODA_STATES.IDLE, to: OODA_STATES.OBSERVING, condition: 'incident_triggered' },

  // From OBSERVING - add self-retry for timeout recovery
  { from: OODA_STATES.OBSERVING, to: OODA_STATES.OBSERVING, condition: 'retry_on_timeout' },
  { from: OODA_STATES.OBSERVING, to: OODA_STATES.ORIENTING, condition: 'observations_collected' },
  { from: OODA_STATES.OBSERVING, to: OODA_STATES.FAILED, condition: 'max_retries_exceeded' },

  // From ORIENTING - add self-retry for timeout recovery
  { from: OODA_STATES.ORIENTING, to: OODA_STATES.ORIENTING, condition: 'retry_on_timeout' },
  { from: OODA_STATES.ORIENTING, to: OODA_STATES.DECIDING, condition: 'correlations_found' },
  { from: OODA_STATES.ORIENTING, to: OODA_STATES.OBSERVING, condition: 'need_more_data' },
  { from: OODA_STATES.ORIENTING, to: OODA_STATES.FAILED, condition: 'max_retries_exceeded' },

  // From DECIDING - add self-retry for timeout recovery
  { from: OODA_STATES.DECIDING, to: OODA_STATES.DECIDING, condition: 'retry_on_timeout' },
  { from: OODA_STATES.DECIDING, to: OODA_STATES.ACTING, condition: 'hypothesis_confirmed' },
  { from: OODA_STATES.DECIDING, to: OODA_STATES.ORIENTING, condition: 'hypothesis_rejected' },
  { from: OODA_STATES.DECIDING, to: OODA_STATES.FAILED, condition: 'no_viable_hypothesis' },

  // From ACTING - later phases go back to OBSERVING for fresh data
  { from: OODA_STATES.ACTING, to: OODA_STATES.VERIFYING, condition: 'action_executed' },
  { from: OODA_STATES.ACTING, to: OODA_STATES.OBSERVING, condition: 'retry_from_failure' },
  { from: OODA_STATES.ACTING, to: OODA_STATES.FAILED, condition: 'action_failed' },

  // From VERIFYING - later phases go back to OBSERVING for fresh data
  { from: OODA_STATES.VERIFYING, to: OODA_STATES.DONE, condition: 'fix_verified' },
  { from: OODA_STATES.VERIFYING, to: OODA_STATES.OBSERVING, condition: 'fix_not_working' },
  { from: OODA_STATES.VERIFYING, to: OODA_STATES.FAILED, condition: 'verification_failed' },

  // Terminal states have no outgoing transitions
];

export class TransitionValidator {
  private transitionMap: Map<string, StateTransition[]>;

  constructor() {
    this.transitionMap = new Map();

    for (const transition of VALID_TRANSITIONS) {
      const key = transition.from;
      const existing = this.transitionMap.get(key) || [];
      existing.push(transition);
      this.transitionMap.set(key, existing);
    }
  }

  /**
   * Check if a transition is valid
   */
  isValidTransition(from: OODAState, to: OODAState): boolean {
    const transitions = this.transitionMap.get(from) || [];
    return transitions.some((t) => t.to === to);
  }

  /**
   * Get all valid transitions from a state
   */
  getValidTransitions(from: OODAState): OODAState[] {
    const transitions = this.transitionMap.get(from) || [];
    return transitions.map((t) => t.to);
  }

  /**
   * Validate and throw if invalid
   */
  validateTransition(from: OODAState, to: OODAState): void {
    if (!this.isValidTransition(from, to)) {
      throw new InvalidTransitionError(from, to, {
        validTransitions: this.getValidTransitions(from),
      });
    }
  }

  /**
   * Check if a state is terminal
   */
  isTerminalState(state: OODAState): boolean {
    return state === OODA_STATES.DONE || state === OODA_STATES.FAILED;
  }
}

// Singleton instance
export const transitionValidator = new TransitionValidator();

/**
 * OODA Loop State Machine
 *
 * States: IDLE → OBSERVING → ORIENTING → DECIDING → ACTING → VERIFYING → DONE/FAILED
 */

export { OODAStateMachine } from './ooda-state-machine.js';
export { TransitionValidator, transitionValidator } from './transitions.js';
export type { StateTransition } from './transitions.js';
export type { StateMachineEvents, StateContext } from './types.js';

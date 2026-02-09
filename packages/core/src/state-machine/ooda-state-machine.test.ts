/**
 * OODA State Machine Tests
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { OODAStateMachine } from './ooda-state-machine.js';
import { OODA_STATES } from '@chronosops/shared';
import type { Incident } from '@chronosops/shared';

// Mock incident for testing
const createMockIncident = (overrides?: Partial<Incident>): Incident => ({
  id: 'test-incident-123',
  title: 'Test Incident',
  description: 'A test incident for unit testing',
  severity: 'high',
  status: 'active',
  state: OODA_STATES.IDLE,
  namespace: 'demo',
  startedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('OODAStateMachine', () => {
  let stateMachine: OODAStateMachine;

  beforeEach(() => {
    stateMachine = new OODAStateMachine();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('should start in IDLE state', () => {
      expect(stateMachine.getState()).toBe(OODA_STATES.IDLE);
    });

    it('should have null context initially', () => {
      expect(stateMachine.getContext()).toBeNull();
    });

    it('should not be active in IDLE state', () => {
      expect(stateMachine.isActive()).toBe(false);
    });
  });

  describe('start()', () => {
    it('should transition to OBSERVING when started', async () => {
      const incident = createMockIncident();
      await stateMachine.start(incident);

      expect(stateMachine.getState()).toBe(OODA_STATES.OBSERVING);
    });

    it('should initialize context with incident', async () => {
      const incident = createMockIncident();
      await stateMachine.start(incident);

      const context = stateMachine.getContext();
      expect(context).not.toBeNull();
      expect(context?.incident).toBe(incident);
      expect(context?.evidence).toEqual([]);
      expect(context?.hypotheses).toEqual([]);
      expect(context?.actions).toEqual([]);
    });

    it('should throw if already active', async () => {
      const incident = createMockIncident();
      await stateMachine.start(incident);

      await expect(stateMachine.start(incident)).rejects.toThrow(
        'State machine is already active'
      );
    });

    it('should be active after start', async () => {
      await stateMachine.start(createMockIncident());
      expect(stateMachine.isActive()).toBe(true);
    });

    it('should emit state:changed event on start', async () => {
      const stateChangedSpy = vi.fn();
      stateMachine.on('state:changed', stateChangedSpy);

      await stateMachine.start(createMockIncident());

      expect(stateChangedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          from: OODA_STATES.IDLE,
          to: OODA_STATES.OBSERVING,
        })
      );
    });
  });

  describe('transition()', () => {
    beforeEach(async () => {
      await stateMachine.start(createMockIncident());
    });

    it('should transition OBSERVING -> ORIENTING', async () => {
      await stateMachine.transition(OODA_STATES.ORIENTING);
      expect(stateMachine.getState()).toBe(OODA_STATES.ORIENTING);
    });

    it('should transition ORIENTING -> DECIDING', async () => {
      await stateMachine.transition(OODA_STATES.ORIENTING);
      await stateMachine.transition(OODA_STATES.DECIDING);
      expect(stateMachine.getState()).toBe(OODA_STATES.DECIDING);
    });

    it('should transition DECIDING -> ACTING', async () => {
      await stateMachine.transition(OODA_STATES.ORIENTING);
      await stateMachine.transition(OODA_STATES.DECIDING);
      await stateMachine.transition(OODA_STATES.ACTING);
      expect(stateMachine.getState()).toBe(OODA_STATES.ACTING);
    });

    it('should transition ACTING -> VERIFYING', async () => {
      await stateMachine.transition(OODA_STATES.ORIENTING);
      await stateMachine.transition(OODA_STATES.DECIDING);
      await stateMachine.transition(OODA_STATES.ACTING);
      await stateMachine.transition(OODA_STATES.VERIFYING);
      expect(stateMachine.getState()).toBe(OODA_STATES.VERIFYING);
    });

    it('should transition VERIFYING -> DONE and reset to IDLE', async () => {
      const resolvedSpy = vi.fn();
      stateMachine.on('incident:resolved', resolvedSpy);

      await stateMachine.transition(OODA_STATES.ORIENTING);
      await stateMachine.transition(OODA_STATES.DECIDING);
      await stateMachine.transition(OODA_STATES.ACTING);
      await stateMachine.transition(OODA_STATES.VERIFYING);
      await stateMachine.transition(OODA_STATES.DONE);

      // State machine resets to IDLE after completion
      expect(stateMachine.getState()).toBe(OODA_STATES.IDLE);
      expect(resolvedSpy).toHaveBeenCalled();
    });

    it('should throw on invalid transition', async () => {
      // Cannot go directly from OBSERVING to DONE
      await expect(stateMachine.transition(OODA_STATES.DONE)).rejects.toThrow();
    });

    it('should emit state:changed for each transition', async () => {
      const stateChangedSpy = vi.fn();
      stateMachine.on('state:changed', stateChangedSpy);

      await stateMachine.transition(OODA_STATES.ORIENTING);

      expect(stateChangedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          from: OODA_STATES.OBSERVING,
          to: OODA_STATES.ORIENTING,
        })
      );
    });

    it('should allow transition to FAILED from any active state and reset to IDLE', async () => {
      const failedSpy = vi.fn();
      stateMachine.on('incident:failed', failedSpy);

      await stateMachine.transition(OODA_STATES.FAILED);

      // State machine resets to IDLE after failure
      expect(stateMachine.getState()).toBe(OODA_STATES.IDLE);
      expect(failedSpy).toHaveBeenCalled();
    });
  });

  describe('terminal states', () => {
    beforeEach(async () => {
      await stateMachine.start(createMockIncident());
    });

    it('should reset and not be active after DONE', async () => {
      // Complete the full loop
      await stateMachine.transition(OODA_STATES.ORIENTING);
      await stateMachine.transition(OODA_STATES.DECIDING);
      await stateMachine.transition(OODA_STATES.ACTING);
      await stateMachine.transition(OODA_STATES.VERIFYING);
      await stateMachine.transition(OODA_STATES.DONE);

      // After reset, machine is in IDLE and not active
      expect(stateMachine.isActive()).toBe(false);
      expect(stateMachine.getState()).toBe(OODA_STATES.IDLE);
    });

    it('should reset and not be active after FAILED', async () => {
      await stateMachine.transition(OODA_STATES.FAILED);
      // After reset, machine is in IDLE and not active
      expect(stateMachine.isActive()).toBe(false);
      expect(stateMachine.getState()).toBe(OODA_STATES.IDLE);
    });
  });

  describe('context management', () => {
    it('should update phaseStartedAt on transition', async () => {
      await stateMachine.start(createMockIncident());
      const initialPhaseStart = stateMachine.getContext()?.phaseStartedAt;

      // Advance time
      vi.advanceTimersByTime(1000);

      await stateMachine.transition(OODA_STATES.ORIENTING);
      const newPhaseStart = stateMachine.getContext()?.phaseStartedAt;

      expect(newPhaseStart?.getTime()).toBeGreaterThan(initialPhaseStart?.getTime() ?? 0);
    });

    it('should track startedAt across all phases', async () => {
      await stateMachine.start(createMockIncident());
      const startTime = stateMachine.getContext()?.startedAt;

      await stateMachine.transition(OODA_STATES.ORIENTING);

      // startedAt should remain the same
      expect(stateMachine.getContext()?.startedAt).toBe(startTime);
    });
  });

  describe('loop back transitions', () => {
    beforeEach(async () => {
      await stateMachine.start(createMockIncident());
      await stateMachine.transition(OODA_STATES.ORIENTING);
      await stateMachine.transition(OODA_STATES.DECIDING);
      await stateMachine.transition(OODA_STATES.ACTING);
      await stateMachine.transition(OODA_STATES.VERIFYING);
    });

    it('should allow VERIFYING -> OBSERVING for re-observation', async () => {
      await stateMachine.transition(OODA_STATES.OBSERVING);
      expect(stateMachine.getState()).toBe(OODA_STATES.OBSERVING);
    });
  });

  describe('event emissions', () => {
    it('should throw InvalidTransitionError on invalid transition', async () => {
      await stateMachine.start(createMockIncident());

      // Cannot go directly from OBSERVING to DONE - should throw
      await expect(stateMachine.transition(OODA_STATES.DONE)).rejects.toThrow(
        /Invalid state transition/
      );

      // State should remain unchanged after failed transition
      expect(stateMachine.getState()).toBe(OODA_STATES.OBSERVING);
    });
  });
});

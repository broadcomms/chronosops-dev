/**
 * ThoughtStateManager Tests
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ThoughtStateManager } from './thought-state-manager.js';

describe('ThoughtStateManager', () => {
  let manager: ThoughtStateManager;

  beforeEach(() => {
    manager = new ThoughtStateManager();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      expect(manager).toBeDefined();
    });

    it('should accept custom config', () => {
      const customManager = new ThoughtStateManager({
        defaultThinkingLevel: 'HIGH',
        escalationThreshold: 0.5,
      });
      expect(customManager).toBeDefined();
    });
  });

  describe('initialize()', () => {
    it('should create a new thought state', () => {
      const state = manager.initialize('incident-1');

      expect(state).toBeDefined();
      expect(state.incidentId).toBe('incident-1');
    });

    it('should initialize with empty reasoning chain', () => {
      const state = manager.initialize('incident-1');

      expect(state.reasoningChain).toEqual([]);
    });

    it('should set default thinking level', () => {
      const state = manager.initialize('incident-1');

      expect(state.thinkingLevel).toBe('MEDIUM');
    });

    it('should initialize observations, hypotheses, and insights', () => {
      const state = manager.initialize('incident-1');

      expect(state.observations).toEqual([]);
      expect(state.hypotheses).toEqual([]);
      expect(state.insights).toEqual([]);
    });
  });

  describe('getCurrentState()', () => {
    it('should return null before initialization', () => {
      expect(manager.getCurrentState()).toBeNull();
    });

    it('should return current state after initialization', () => {
      manager.initialize('incident-1');

      const state = manager.getCurrentState();

      expect(state).not.toBeNull();
      expect(state!.incidentId).toBe('incident-1');
    });
  });

  describe('addReasoning()', () => {
    it('should add reasoning step to chain', () => {
      manager.initialize('incident-1');

      manager.addReasoning({
        type: 'observation',
        content: 'High CPU detected',
        confidence: 0.8,
        evidence: ['cpu_metric_1'],
        phase: 'OBSERVING',
      });

      const chain = manager.getReasoningChain();

      expect(chain.length).toBe(1);
      expect(chain[0]!.type).toBe('observation');
      expect(chain[0]!.content).toBe('High CPU detected');
    });

    it('should return the created step with ID and timestamp', () => {
      manager.initialize('incident-1');

      const step = manager.addReasoning({
        type: 'inference',
        content: 'Memory leak suspected',
        confidence: 0.7,
        evidence: [],
        phase: 'ORIENTING',
      });

      expect(step.id).toBeDefined();
      expect(step.timestamp).toBeDefined();
      expect(step.type).toBe('inference');
    });

    it('should throw if state not initialized', () => {
      expect(() => {
        manager.addReasoning({
          type: 'observation',
          content: 'Test',
          confidence: 0.5,
          evidence: [],
          phase: 'OBSERVING',
        });
      }).toThrow('Thought state not initialized');
    });
  });

  describe('getReasoningChain()', () => {
    it('should return full reasoning chain', () => {
      manager.initialize('incident-1');

      manager.addReasoning({ type: 'observation', content: 'A', confidence: 0.5, evidence: [], phase: 'OBSERVING' });
      manager.addReasoning({ type: 'inference', content: 'B', confidence: 0.6, evidence: [], phase: 'ORIENTING' });
      manager.addReasoning({ type: 'conclusion', content: 'C', confidence: 0.7, evidence: [], phase: 'DECIDING' });

      const chain = manager.getReasoningChain();

      expect(chain).toHaveLength(3);
    });

    it('should return empty array if not initialized', () => {
      const chain = manager.getReasoningChain();
      expect(chain).toEqual([]);
    });
  });

  describe('getRecentReasoning()', () => {
    it('should return recent reasoning steps', () => {
      manager.initialize('incident-1');

      for (let i = 0; i < 10; i++) {
        manager.addReasoning({
          type: 'observation',
          content: `Step ${i}`,
          confidence: 0.5,
          evidence: [],
          phase: 'OBSERVING',
        });
      }

      const recent = manager.getRecentReasoning(3);

      expect(recent).toHaveLength(3);
      expect(recent[2]!.content).toBe('Step 9');
    });
  });

  describe('saveState() and loadState()', () => {
    it('should save and generate signature', () => {
      manager.initialize('incident-1');
      manager.addReasoning({
        type: 'observation',
        content: 'Test observation',
        confidence: 0.8,
        evidence: [],
        phase: 'OBSERVING',
      });

      const signature = manager.saveState();

      expect(signature).toBeDefined();
      expect(typeof signature).toBe('string');
    });

    it('should load state from signature', () => {
      manager.initialize('incident-1');
      manager.addObservation('Test observation');

      const signature = manager.saveState();
      manager.reset();

      const loaded = manager.loadState(signature);

      expect(loaded).not.toBeNull();
      expect(loaded!.incidentId).toBe('incident-1');
    });

    it('should return null for invalid signature', () => {
      const loaded = manager.loadState('invalid-signature');
      expect(loaded).toBeNull();
    });
  });

  describe('getCurrentLevel() and escalation', () => {
    it('should return default thinking level', () => {
      manager.initialize('incident-1');

      const level = manager.getCurrentLevel();

      expect(level).toBe('MEDIUM');
    });

    it('should escalate level when called', () => {
      manager.initialize('incident-1');

      const newLevel = manager.escalateLevel('Low confidence detected');

      expect(newLevel).toBe('HIGH');
    });

    it('should not escalate beyond HIGH', () => {
      const highManager = new ThoughtStateManager({ defaultThinkingLevel: 'HIGH' });
      highManager.initialize('incident-1');

      const level = highManager.escalateLevel('Already at max');

      expect(level).toBe('HIGH');
    });

    it('should deescalate level when called', () => {
      const highManager = new ThoughtStateManager({ defaultThinkingLevel: 'HIGH' });
      highManager.initialize('incident-1');

      const level = highManager.deescalateLevel();

      expect(level).toBe('MEDIUM');
    });
  });

  describe('evaluateEscalation()', () => {
    it('should evaluate escalation based on confidence', () => {
      manager.initialize('incident-1');

      const decision = manager.evaluateEscalation();

      expect(decision).toBeDefined();
      expect(decision.currentLevel).toBe('MEDIUM');
      expect(typeof decision.shouldEscalate).toBe('boolean');
    });

    it('should return default values if not initialized', () => {
      const decision = manager.evaluateEscalation();

      expect(decision.shouldEscalate).toBe(false);
      expect(decision.reason).toBe('No active state');
    });
  });

  describe('getThinkingBudget()', () => {
    it('should return thinking budget for current level', () => {
      manager.initialize('incident-1');

      const budget = manager.getThinkingBudget();

      expect(budget).toBe(8192); // MEDIUM default
    });

    it('should return default budget if not initialized', () => {
      const budget = manager.getThinkingBudget();

      expect(budget).toBe(8192); // MEDIUM default
    });
  });

  describe('addObservation()', () => {
    it('should add observation to state', () => {
      manager.initialize('incident-1');

      manager.addObservation('CPU usage at 95%');
      manager.addObservation('Memory usage at 80%');

      const state = manager.getCurrentState();

      expect(state!.observations).toHaveLength(2);
      expect(state!.observations).toContain('CPU usage at 95%');
    });
  });

  describe('addInsight()', () => {
    it('should add insight to state', () => {
      manager.initialize('incident-1');

      manager.addInsight('Deployment caused the issue');

      const state = manager.getCurrentState();

      expect(state!.insights).toContain('Deployment caused the issue');
    });
  });

  describe('addKeyFinding()', () => {
    it('should add key finding to state', () => {
      manager.initialize('incident-1');

      manager.addKeyFinding('Database connection pool exhausted');

      const state = manager.getCurrentState();

      expect(state!.keyFindings).toContain('Database connection pool exhausted');
    });
  });

  describe('addHypothesis()', () => {
    it('should add hypothesis and return ID', () => {
      manager.initialize('incident-1');

      const id = manager.addHypothesis({
        description: 'Memory leak in API service',
        confidence: 0.75,
        status: 'active',
      });

      expect(id).toBeDefined();

      const state = manager.getCurrentState();
      expect(state!.hypotheses).toHaveLength(1);
      expect(state!.hypotheses[0]!.description).toBe('Memory leak in API service');
    });
  });

  describe('updateHypothesis()', () => {
    it('should update hypothesis confidence', () => {
      manager.initialize('incident-1');

      const id = manager.addHypothesis({
        description: 'Test hypothesis',
        confidence: 0.5,
        status: 'active',
      });

      manager.updateHypothesis(id, { confidence: 0.9 });

      const state = manager.getCurrentState();
      expect(state!.hypotheses[0]!.confidence).toBe(0.9);
    });

    it('should update hypothesis status', () => {
      manager.initialize('incident-1');

      const id = manager.addHypothesis({
        description: 'Test hypothesis',
        confidence: 0.8,
        status: 'active',
      });

      manager.updateHypothesis(id, { status: 'confirmed' });

      const state = manager.getCurrentState();
      expect(state!.hypotheses[0]!.status).toBe('confirmed');
    });

    it('should move rejected hypotheses to rejected list', () => {
      manager.initialize('incident-1');

      const id = manager.addHypothesis({
        description: 'Wrong hypothesis',
        confidence: 0.3,
        status: 'active',
      });

      manager.updateHypothesis(id, { status: 'rejected' });

      const state = manager.getCurrentState();
      expect(state!.rejectedHypotheses).toHaveLength(1);
      expect(state!.rejectedHypotheses[0]!.description).toBe('Wrong hypothesis');
    });
  });

  describe('setFocus()', () => {
    it('should update current focus', () => {
      manager.initialize('incident-1');

      manager.setFocus('Investigating database connections');

      const state = manager.getCurrentState();
      expect(state!.currentFocus).toBe('Investigating database connections');
    });
  });

  describe('transitionPhase()', () => {
    it('should transition to new phase', () => {
      manager.initialize('incident-1');

      const transition = manager.transitionPhase('OBSERVING');

      expect(transition).toBeDefined();
      expect(transition.from).toBe('IDLE');
      expect(transition.to).toBe('OBSERVING');
    });

    it('should record transition summary', () => {
      manager.initialize('incident-1');
      manager.addObservation('Test observation');

      const transition = manager.transitionPhase('ORIENTING');

      expect(transition.summary).toBeDefined();
      expect(transition.carryForward).toBeDefined();
    });

    it('should throw if not initialized', () => {
      expect(() => {
        manager.transitionPhase('OBSERVING');
      }).toThrow('Thought state not initialized');
    });
  });

  describe('getContinuationContext()', () => {
    it('should generate continuation context', () => {
      manager.initialize('incident-1');
      manager.addObservation('Test observation');
      manager.addInsight('Test insight');

      const context = manager.getContinuationContext();

      expect(context).toBeDefined();
      expect(context.currentPhase).toBe('IDLE');
      expect(context.keyObservations).toContain('Test observation');
      expect(context.insights).toContain('Test insight');
    });

    it('should return empty context if not initialized', () => {
      const context = manager.getContinuationContext();

      expect(context.keyObservations).toEqual([]);
      expect(context.activeHypotheses).toEqual([]);
    });
  });

  describe('formatContinuationContext()', () => {
    it('should format context as string', () => {
      manager.initialize('incident-1');
      manager.addObservation('High CPU usage');
      manager.setFocus('CPU investigation');

      const formatted = manager.formatContinuationContext();

      expect(formatted).toContain('Current Phase:');
      expect(formatted).toContain('High CPU usage');
      expect(formatted).toContain('CPU investigation');
    });
  });

  describe('reset()', () => {
    it('should reset all state', () => {
      manager.initialize('incident-1');
      manager.addObservation('Test');
      manager.addReasoning({
        type: 'observation',
        content: 'Test',
        confidence: 0.5,
        evidence: [],
        phase: 'OBSERVING',
      });

      manager.reset();

      expect(manager.getCurrentState()).toBeNull();
      expect(manager.getReasoningChain()).toEqual([]);
    });
  });

  describe('getLatestState()', () => {
    it('should return latest state for incident', () => {
      manager.initialize('incident-1');
      manager.saveState();

      const latest = manager.getLatestState('incident-1');

      expect(latest).not.toBeNull();
      expect(latest!.incidentId).toBe('incident-1');
    });

    it('should return null for unknown incident', () => {
      const latest = manager.getLatestState('unknown');
      expect(latest).toBeNull();
    });
  });
});

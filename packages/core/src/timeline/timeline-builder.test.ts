/**
 * TimelineBuilder Tests
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TimelineBuilder } from './timeline-builder.js';

describe('TimelineBuilder', () => {
  let builder: TimelineBuilder;

  beforeEach(() => {
    builder = new TimelineBuilder();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      expect(builder).toBeDefined();
    });

    it('should extend EventEmitter', () => {
      expect(builder.emit).toBeDefined();
      expect(builder.on).toBeDefined();
    });
  });

  describe('initialize()', () => {
    it('should create a new timeline', () => {
      const timeline = builder.initialize('incident-1');

      expect(timeline).toBeDefined();
      expect(timeline.incidentId).toBe('incident-1');
      expect(timeline.events.length).toBeGreaterThan(0);
    });

    it('should add initial event', () => {
      const timeline = builder.initialize('incident-1');

      expect(timeline.events[0]!.type).toBe('incident_created');
    });

    it('should return the timeline', () => {
      const timeline = builder.initialize('incident-1');

      expect(builder.getTimeline()).toBe(timeline);
    });
  });

  describe('getTimeline()', () => {
    it('should return null before initialization', () => {
      expect(builder.getTimeline()).toBeNull();
    });

    it('should return timeline after initialization', () => {
      builder.initialize('incident-1');

      expect(builder.getTimeline()).not.toBeNull();
    });
  });

  describe('addEvent()', () => {
    it('should throw if timeline not initialized', () => {
      expect(() => {
        builder.addEvent('evidence_collected', {
          title: 'Evidence',
          description: 'Test',
        });
      }).toThrow('Timeline not initialized');
    });

    it('should add event to timeline', () => {
      builder.initialize('incident-1');

      builder.addEvent('evidence_collected', {
        title: 'Log Evidence',
        description: 'Found error logs',
      });

      const timeline = builder.getTimeline()!;
      expect(timeline.events.length).toBe(2); // initial + new
    });

    it('should return the created event', () => {
      builder.initialize('incident-1');

      const event = builder.addEvent('hypothesis_generated', {
        title: 'Memory Leak',
        description: 'Suspected memory leak',
      });

      expect(event).toBeDefined();
      expect(event.type).toBe('hypothesis_generated');
      expect(event.title).toBe('Memory Leak');
    });

    it('should emit eventAdded event', () => {
      builder.initialize('incident-1');

      const listener = vi.fn();
      builder.on('eventAdded', listener);

      builder.addEvent('action_executed', {
        title: 'Restart',
        description: 'Restarted pod',
      });

      expect(listener).toHaveBeenCalled();
    });

    it('should include optional data', () => {
      builder.initialize('incident-1');

      const event = builder.addEvent('evidence_collected', {
        title: 'Metric',
        description: 'CPU spike',
        data: { value: 95, threshold: 80 },
      });

      expect(event.data).toMatchObject({ value: 95, threshold: 80 });
    });
  });

  describe('transitionPhase()', () => {
    it('should record phase transition', () => {
      builder.initialize('incident-1');

      builder.transitionPhase('OBSERVING');

      const timeline = builder.getTimeline()!;
      const transitions = timeline.events.filter(e => e.type === 'phase_transition');

      expect(transitions.length).toBeGreaterThan(0);
    });

    it('should return null if not initialized', () => {
      const result = builder.transitionPhase('OBSERVING');
      expect(result).toBeNull();
    });
  });

  describe('recordEvidence()', () => {
    it('should add evidence collection event', () => {
      builder.initialize('incident-1');

      const evidence = {
        id: 'ev-1',
        incidentId: 'incident-1',
        type: 'log' as const,
        source: 'kubectl',
        content: 'Error log',
        timestamp: new Date(),
        confidence: 0.8,
        metadata: {},
        createdAt: new Date(),
      };

      builder.recordEvidence(evidence);

      const timeline = builder.getTimeline()!;
      const evidenceEvents = timeline.events.filter(e => e.type === 'evidence_collected');

      expect(evidenceEvents.length).toBe(1);
    });
  });

  describe('recordHypothesis()', () => {
    it('should add hypothesis generation event', () => {
      builder.initialize('incident-1');

      const hypothesis = {
        id: 'hyp-1',
        incidentId: 'incident-1',
        title: 'Memory Leak',
        description: 'App is leaking memory',
        confidence: 0.7,
        status: 'proposed' as const,
        evidence: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      builder.recordHypothesis(hypothesis);

      const timeline = builder.getTimeline()!;
      const hypEvents = timeline.events.filter(e => e.type === 'hypothesis_generated');

      expect(hypEvents.length).toBe(1);
    });
  });

  describe('recordAction()', () => {
    it('should add action taken event', () => {
      builder.initialize('incident-1');

      const action = {
        success: true,
        mode: 'simulated' as const,
        action: {
          type: 'restart' as const,
          target: { namespace: 'prod', deployment: 'api' },
          reason: 'High CPU',
        },
        timestamp: new Date(),
        durationMs: 5000,
        message: 'Done',
      };

      builder.recordAction(action);

      const timeline = builder.getTimeline()!;
      const actionEvents = timeline.events.filter(e => e.type === 'action_executed');

      expect(actionEvents.length).toBe(1);
    });
  });

  describe('recordVerification()', () => {
    it('should add verification event', () => {
      builder.initialize('incident-1');

      const verification = {
        actionId: 'act-123',
        incidentId: 'incident-1',
        success: true,
        confidence: 0.9,
        timestamp: new Date(),
        verdict: 'confirmed_success' as const,
        summary: 'Verification passed',
        checks: [
          { name: 'pod_health', status: 'passed' as const, message: 'Pods healthy' }
        ],
        shouldRetry: false,
      };

      builder.recordVerification(verification);

      const timeline = builder.getTimeline()!;
      const verificationEvents = timeline.events.filter(e => e.type === 'action_verified');

      expect(verificationEvents.length).toBe(1);
    });
  });

  describe('complete()', () => {
    it('should mark investigation as complete', () => {
      builder.initialize('incident-1');

      builder.complete('resolved', 'Issue fixed');

      const timeline = builder.getTimeline()!;
      const finalEvent = timeline.events.find(e => e.type === 'investigation_completed');

      expect(finalEvent).toBeDefined();
    });

    it('should calculate summary', () => {
      builder.initialize('incident-1');
      builder.addEvent('evidence_collected', { title: 'E1', description: 'D1' });
      builder.addEvent('hypothesis_generated', { title: 'H1', description: 'D2' });

      builder.complete('resolved', 'Fixed');

      const timeline = builder.getTimeline()!;

      expect(timeline.summary.totalEvents).toBeGreaterThan(0);
    });
  });

  describe('getSummary()', () => {
    it('should return timeline summary', () => {
      builder.initialize('incident-1');
      builder.addEvent('evidence_collected', { title: 'E1', description: 'D1' });

      const summary = builder.getSummary();

      expect(summary).toBeDefined();
      expect(summary!.totalEvents).toBeGreaterThan(0);
    });

    it('should return null if not initialized', () => {
      const summary = builder.getSummary();
      expect(summary).toBeNull();
    });
  });

  describe('buildPostmortemTimeline()', () => {
    it('should export timeline in postmortem format', () => {
      builder.initialize('incident-1');
      builder.addEvent('evidence_collected', { title: 'E1', description: 'D1' });
      builder.complete('resolved', 'Fixed');

      const postmortem = builder.buildPostmortemTimeline();

      expect(postmortem).toBeDefined();
      expect(postmortem!.incidentStart).toBeDefined();
      expect(postmortem!.phases).toBeDefined();
    });

    it('should return null if not initialized', () => {
      const postmortem = builder.buildPostmortemTimeline();
      expect(postmortem).toBeNull();
    });
  });

  describe('filter()', () => {
    it('should filter events by type', () => {
      builder.initialize('incident-1');
      builder.addEvent('evidence_collected', { title: 'E1', description: 'D1' });
      builder.addEvent('hypothesis_generated', { title: 'H1', description: 'D2' });
      builder.addEvent('evidence_collected', { title: 'E2', description: 'D3' });

      const filtered = builder.filter({ types: ['evidence_collected'] });

      expect(filtered.length).toBe(2);
    });

    it('should filter events by severity', () => {
      builder.initialize('incident-1');
      builder.addEvent('evidence_collected', { title: 'E1', description: 'D1', severity: 'critical' });
      builder.addEvent('evidence_collected', { title: 'E2', description: 'D2', severity: 'info' });

      const filtered = builder.filter({ severity: ['critical'] });

      expect(filtered.length).toBe(1);
    });

    it('should return empty array if not initialized', () => {
      const filtered = builder.filter({});
      expect(filtered).toEqual([]);
    });
  });

  describe('toMarkdown()', () => {
    it('should export timeline as markdown', () => {
      builder.initialize('incident-1');
      builder.addEvent('evidence_collected', { title: 'E1', description: 'D1' });

      const markdown = builder.toMarkdown();

      expect(markdown).toContain('# Investigation Timeline');
      expect(markdown).toContain('incident-1');
    });

    it('should return empty string if not initialized', () => {
      const markdown = builder.toMarkdown();
      expect(markdown).toBe('');
    });
  });

  describe('toJSON()', () => {
    it('should export timeline as JSON string', () => {
      builder.initialize('incident-1');

      const json = builder.toJSON();
      const parsed = JSON.parse(json);

      expect(parsed.incidentId).toBe('incident-1');
    });

    it('should return empty object if not initialized', () => {
      const json = builder.toJSON();
      expect(json).toBe('{}');
    });
  });

  describe('reset()', () => {
    it('should reset the timeline', () => {
      builder.initialize('incident-1');
      builder.addEvent('evidence_collected', { title: 'E1', description: 'D1' });

      builder.reset();

      expect(builder.getTimeline()).toBeNull();
    });
  });
});

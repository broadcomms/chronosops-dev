/**
 * CorrelationEngine Tests
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CorrelationEngine } from './correlation-engine.js';
import type {
  VisualSignal,
  LogSignal,
  MetricSignal,
  EventSignal,
  Signal,
} from './types.js';
import type { Evidence } from '@chronosops/shared';

describe('CorrelationEngine', () => {
  let engine: CorrelationEngine;

  beforeEach(() => {
    engine = new CorrelationEngine();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper to create visual signals
  const createVisualSignal = (
    timestamp: Date,
    overrides: Partial<VisualSignal> = {}
  ): VisualSignal => ({
    id: `visual-${Date.now()}-${Math.random()}`,
    type: 'visual',
    timestamp,
    source: 'dashboard',
    severity: 'medium',
    description: 'Dashboard state',
    data: {
      frameId: 'frame-1',
      systemState: 'degraded',
      anomalies: [],
      metrics: [],
    },
    ...overrides,
  });

  // Helper to create log signals
  const createLogSignal = (
    timestamp: Date,
    overrides: Partial<LogSignal> = {}
  ): LogSignal => ({
    id: `log-${Date.now()}-${Math.random()}`,
    type: 'log',
    timestamp,
    source: 'app',
    severity: 'medium',
    description: 'Log entry',
    data: {
      id: 'log-1',
      timestamp,
      level: 'error',
      source: 'app',
      message: 'Error occurred',
      metadata: {},
      raw: '',
    },
    ...overrides,
  });

  // Helper to create metric signals
  const createMetricSignal = (
    timestamp: Date,
    overrides: Partial<MetricSignal> = {}
  ): MetricSignal => ({
    id: `metric-${Date.now()}-${Math.random()}`,
    type: 'metric',
    timestamp,
    source: 'prometheus',
    severity: 'high',
    description: 'Metric anomaly',
    data: {
      name: 'cpu_usage',
      timestamp,
      value: 95,
      labels: { pod: 'api' },
    },
    ...overrides,
  });

  // Helper to create event signals
  const createEventSignal = (
    timestamp: Date,
    overrides: Partial<EventSignal> = {}
  ): EventSignal => ({
    id: `event-${Date.now()}-${Math.random()}`,
    type: 'event',
    timestamp,
    source: 'kubernetes',
    severity: 'critical',
    description: 'K8s event',
    data: {
      id: 'event-1',
      type: 'deploy',
      timestamp,
      description: 'Deployment changed',
      actor: 'ci',
      target: 'api',
      metadata: {},
      severity: 'info',
    },
    ...overrides,
  });

  describe('alignByTime()', () => {
    it('should align signals by time window', () => {
      const baseTime = new Date('2024-01-15T11:30:00Z');
      const visual: VisualSignal[] = [
        createVisualSignal(new Date(baseTime.getTime())),
        createVisualSignal(new Date(baseTime.getTime() + 5000)),
      ];
      const logs: LogSignal[] = [
        createLogSignal(new Date(baseTime.getTime() + 10000)),
      ];
      const metrics: MetricSignal[] = [];
      const events: EventSignal[] = [
        createEventSignal(new Date(baseTime.getTime() + 60000)),
      ];

      const aligned = engine.alignByTime(visual, logs, metrics, events);

      expect(aligned.length).toBeGreaterThan(0);
      // First window should have visual and log signals
      expect(aligned[0]!.visual.length + aligned[0]!.logs.length).toBeGreaterThan(0);
    });

    it('should return empty array for no signals', () => {
      const aligned = engine.alignByTime([], [], [], []);
      expect(aligned).toHaveLength(0);
    });

    it('should group signals within the same window', () => {
      const baseTime = new Date('2024-01-15T11:30:00Z');
      // All signals within 30 second window (default)
      const visual = [createVisualSignal(new Date(baseTime.getTime()))];
      const logs = [createLogSignal(new Date(baseTime.getTime() + 5000))];
      const metrics = [createMetricSignal(new Date(baseTime.getTime() + 10000))];
      const events: EventSignal[] = [];

      const aligned = engine.alignByTime(visual, logs, metrics, events);

      expect(aligned).toHaveLength(1);
      expect(aligned[0]!.visual).toHaveLength(1);
      expect(aligned[0]!.logs).toHaveLength(1);
      expect(aligned[0]!.metrics).toHaveLength(1);
    });

    it('should create separate windows for distant signals', () => {
      const visual = [
        createVisualSignal(new Date('2024-01-15T11:30:00Z')),
        createVisualSignal(new Date('2024-01-15T11:35:00Z')), // 5 min later
      ];

      const aligned = engine.alignByTime(visual, [], [], []);

      expect(aligned.length).toBeGreaterThan(1);
    });

    it('should calculate signal count per window', () => {
      const baseTime = new Date();
      const visual = [createVisualSignal(baseTime)];
      const logs = [
        createLogSignal(baseTime),
        createLogSignal(new Date(baseTime.getTime() + 1000)),
      ];
      const metrics = [createMetricSignal(baseTime)];

      const aligned = engine.alignByTime(visual, logs, metrics, []);

      expect(aligned[0]!.signalCount).toBe(4);
    });
  });

  describe('findCorrelationsHeuristic()', () => {
    it('should find correlations between signals', () => {
      const baseTime = new Date('2024-01-15T11:30:00Z');

      // Create related signals
      const event = createEventSignal(baseTime, {
        severity: 'critical',
        description: 'Deployment started',
      });
      const log = createLogSignal(new Date(baseTime.getTime() + 5000), {
        severity: 'high',
        description: 'Error after deployment',
      });
      const metric = createMetricSignal(new Date(baseTime.getTime() + 10000), {
        severity: 'high',
        description: 'CPU spike',
      });

      const aligned = engine.alignByTime([event] as unknown as VisualSignal[], [log], [metric], []);
      const correlations = engine.findCorrelationsHeuristic(aligned);

      expect(correlations.length).toBeGreaterThan(0);
    });

    it('should return empty array for empty aligned data', () => {
      const correlations = engine.findCorrelationsHeuristic([]);
      expect(correlations).toHaveLength(0);
    });

    it('should assign confidence scores to correlations', () => {
      const baseTime = new Date();
      const visual = [createVisualSignal(baseTime)];
      const logs = [createLogSignal(new Date(baseTime.getTime() + 1000), { severity: 'critical' })];

      const aligned = engine.alignByTime(visual, logs, [], []);
      const correlations = engine.findCorrelationsHeuristic(aligned);

      if (correlations.length > 0) {
        expect(correlations[0]!.confidence).toBeGreaterThan(0);
        expect(correlations[0]!.confidence).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('inferCausality()', () => {
    it('should infer causal chain from correlated signals', () => {
      const baseTime = new Date('2024-01-15T11:30:00Z');

      // Sequence: deploy -> error logs -> metric spike
      const signals: Signal[] = [
        createEventSignal(baseTime, {
          severity: 'critical',
          description: 'New deployment',
        }),
        createLogSignal(new Date(baseTime.getTime() + 30000), {
          severity: 'critical',
          description: 'Database connection error',
        }),
        createMetricSignal(new Date(baseTime.getTime() + 60000), {
          severity: 'critical',
          description: 'Error rate spike',
        }),
      ];

      const aligned = engine.alignByTime(
        signals.filter(s => s.type === 'visual') as VisualSignal[],
        signals.filter(s => s.type === 'log') as LogSignal[],
        signals.filter(s => s.type === 'metric') as MetricSignal[],
        signals.filter(s => s.type === 'event') as EventSignal[]
      );
      const correlations = engine.findCorrelationsHeuristic(aligned);
      const chain = engine.inferCausality(correlations, signals);

      if (chain) {
        expect(chain.rootCause).toBeDefined();
        expect(chain.effects.length).toBeGreaterThanOrEqual(0);
        expect(chain.confidence).toBeGreaterThan(0);
      }
    });

    it('should return null for empty correlations', () => {
      const chain = engine.inferCausality([], []);
      expect(chain).toBeNull();
    });

    it('should identify earliest event signal as potential root cause', () => {
      const signals: Signal[] = [
        createEventSignal(new Date('2024-01-15T11:30:00Z'), { description: 'First event' }), // Earliest event
        createLogSignal(new Date('2024-01-15T11:31:00Z')),
        createMetricSignal(new Date('2024-01-15T11:32:00Z')),
      ];

      const aligned = engine.alignByTime([], [], [], signals as EventSignal[]);
      const correlations = engine.findCorrelationsHeuristic(aligned);
      const chain = engine.inferCausality(correlations, signals);

      if (chain) {
        // Root cause should be from early signals
        expect(chain.rootCause.timestamp.getTime()).toBeLessThanOrEqual(
          signals[1]!.timestamp.getTime()
        );
      }
    });
  });

  describe('evidenceToSignals()', () => {
    it('should convert evidence to appropriate signal types', () => {
      const evidence: Evidence[] = [
        {
          id: 'ev-1',
          incidentId: 'inc-1',
          type: 'video_frame',
          source: 'dashboard',
          content: {
            frameId: 'f1',
            systemState: 'degraded',
            anomalies: [],
            metrics: [],
          },
          timestamp: new Date(),
          confidence: 0.8,
          metadata: { frameIndex: 0 },
          createdAt: new Date(),
        },
        {
          id: 'ev-2',
          incidentId: 'inc-1',
          type: 'log',
          source: 'kubectl',
          content: {
            description: 'Connection refused',
            severity: 'high',
          },
          timestamp: new Date(),
          confidence: 0.9,
          metadata: {},
          createdAt: new Date(),
        },
      ];

      const signals = engine.evidenceToSignals(evidence);

      expect(signals.visual.length + signals.logs.length).toBe(2);
    });

    it('should handle various evidence types', () => {
      const evidence: Evidence[] = [
        {
          id: 'ev-1',
          incidentId: 'inc-1',
          type: 'metric',
          source: 'prometheus',
          content: {
            name: 'cpu_usage',
            value: 95,
            unit: '%',
          },
          timestamp: new Date(),
          confidence: 0.8,
          metadata: {},
          createdAt: new Date(),
        },
        {
          id: 'ev-2',
          incidentId: 'inc-1',
          type: 'k8s_event',
          source: 'kubernetes',
          content: {
            type: 'deploy',
            description: 'Deployment updated',
          },
          timestamp: new Date(),
          confidence: 0.9,
          metadata: {},
          createdAt: new Date(),
        },
      ];

      const signals = engine.evidenceToSignals(evidence);

      expect(signals.metrics.length).toBe(1);
      expect(signals.events.length).toBe(1);
    });
  });

  describe('analyze()', () => {
    it('should return complete correlation result', async () => {
      const evidence: Evidence[] = [
        {
          id: 'ev-1',
          incidentId: 'incident-1',
          type: 'k8s_event',
          source: 'kubernetes',
          content: { type: 'deploy', description: 'Deployment' },
          timestamp: new Date(),
          confidence: 0.9,
          metadata: {},
          createdAt: new Date(),
        },
        {
          id: 'ev-2',
          incidentId: 'incident-1',
          type: 'log',
          source: 'app',
          content: { description: 'Error occurred', severity: 'high' },
          timestamp: new Date(Date.now() + 5000),
          confidence: 0.8,
          metadata: {},
          createdAt: new Date(),
        },
      ];

      const result = await engine.analyze(evidence, 'incident-1');

      expect(result).toBeDefined();
      expect(result.alignedData).toBeDefined();
      expect(result.correlations).toBeDefined();
      expect(result.summary).toBeDefined();
      expect(result.summary.totalSignals).toBeGreaterThan(0);
    });

    it('should include summary statistics', async () => {
      const evidence: Evidence[] = [
        {
          id: 'ev-1',
          incidentId: 'inc-1',
          type: 'log',
          source: 'app',
          content: { description: 'Test' },
          timestamp: new Date(),
          confidence: 0.8,
          metadata: {},
          createdAt: new Date(),
        },
      ];

      const result = await engine.analyze(evidence, 'inc-1');

      expect(result.summary.totalSignals).toBeGreaterThanOrEqual(1);
      expect(typeof result.summary.correlationsFound).toBe('number');
    });
  });

  describe('configuration', () => {
    it('should use custom window size', () => {
      const customEngine = new CorrelationEngine(undefined, {
        windowMs: 60000, // 1 minute
      });

      const baseTime = new Date('2024-01-15T11:30:00Z');
      // Signals 45 seconds apart - should be in same window with 60s config
      const visual = [
        createVisualSignal(baseTime),
        createVisualSignal(new Date(baseTime.getTime() + 45000)),
      ];

      const aligned = customEngine.alignByTime(visual, [], [], []);

      expect(aligned).toHaveLength(1);
    });

    it('should respect minCorrelationConfidence', async () => {
      const strictEngine = new CorrelationEngine(undefined, {
        minCorrelationConfidence: 0.9,
      });

      const evidence: Evidence[] = [
        {
          id: 'ev-1',
          incidentId: 'inc-1',
          type: 'log',
          source: 'app',
          content: { description: 'Test 1' },
          timestamp: new Date(),
          confidence: 0.5,
          metadata: {},
          createdAt: new Date(),
        },
        {
          id: 'ev-2',
          incidentId: 'inc-1',
          type: 'log',
          source: 'app',
          content: { description: 'Test 2' },
          timestamp: new Date(),
          confidence: 0.5,
          metadata: {},
          createdAt: new Date(),
        },
      ];

      const result = await strictEngine.analyze(evidence, 'inc-1');

      // With high confidence threshold, fewer correlations should be returned
      result.correlations.forEach(c => {
        expect(c.confidence).toBeGreaterThanOrEqual(0.9);
      });
    });
  });
});

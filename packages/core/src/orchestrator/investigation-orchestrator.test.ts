/**
 * Investigation Orchestrator Tests
 * Focus on initialization, configuration, and event emissions
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InvestigationOrchestrator } from './investigation-orchestrator.js';
import { OODA_STATES } from '@chronosops/shared';
import type { Incident } from '@chronosops/shared';
import type { GeminiClient } from '@chronosops/gemini';
import type { VideoWatcher } from '../observers/video-watcher.js';
import type { ExecutorFactory } from '../agents/executor/index.js';

// ===========================================
// Mock Types
// ===========================================

type MockGeminiClient = {
  analyzeFrames: ReturnType<typeof vi.fn>;
  generateHypotheses: ReturnType<typeof vi.fn>;
  analyzeLogs: ReturnType<typeof vi.fn>;
};

type MockVideoWatcher = {
  isAvailable: ReturnType<typeof vi.fn>;
  getConfig: ReturnType<typeof vi.fn>;
  getLatestFrames: ReturnType<typeof vi.fn>;
};

type MockExecutorFactory = {
  getExecutor: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  executeWithFallback: ReturnType<typeof vi.fn>;
  checkAvailability: ReturnType<typeof vi.fn>;
  checkCooldown: ReturnType<typeof vi.fn>;
  clearCooldown: ReturnType<typeof vi.fn>;
};

// ===========================================
// Mock Factories
// ===========================================

const createMockGeminiClient = (): MockGeminiClient => ({
  analyzeFrames: vi.fn().mockResolvedValue({
    success: true,
    data: {
      anomalies: [],
      metrics: [],
      dashboardState: { healthy: true, overallSeverity: 'healthy' },
    },
  }),
  generateHypotheses: vi.fn().mockResolvedValue({
    success: true,
    data: {
      hypotheses: [
        {
          rootCause: 'Test issue',
          confidence: 0.82,
          supportingEvidence: [],
          contradictingEvidence: [],
          suggestedActions: [
            {
              type: 'restart',
              target: 'demo-app',
              parameters: { namespace: 'demo' },
              riskLevel: 'low',
            },
          ],
          testingSteps: [],
        },
      ],
      reasoning: 'Test',
    },
  }),
  analyzeLogs: vi.fn().mockResolvedValue({
    success: true,
    data: { patterns: [], anomalies: [], timeline: [] },
  }),
});

const createMockVideoWatcher = (): MockVideoWatcher => ({
  isAvailable: vi.fn().mockResolvedValue(true),
  getConfig: vi.fn().mockReturnValue({ frameCount: 5, intervalMs: 500 }),
  getLatestFrames: vi.fn().mockResolvedValue([
    { data: Buffer.from('frame'), timestamp: new Date(), mimeType: 'image/png' },
  ]),
});

const createMockExecutorFactory = (): MockExecutorFactory => ({
  getExecutor: vi.fn().mockResolvedValue({
    name: 'SimulatedExecutor',
    mode: 'simulated',
    isAvailable: vi.fn().mockResolvedValue(true),
    execute: vi.fn().mockResolvedValue({
      success: true,
      mode: 'simulated',
      action: { type: 'restart', target: { namespace: 'demo', deployment: 'demo-app' } },
      timestamp: new Date(),
      durationMs: 100,
      message: 'Success',
    }),
    validate: vi.fn().mockResolvedValue({ valid: true, errors: [], warnings: [] }),
  }),
  execute: vi.fn().mockResolvedValue({
    success: true,
    mode: 'simulated',
    action: { type: 'restart', target: { namespace: 'demo', deployment: 'demo-app' } },
    timestamp: new Date(),
    durationMs: 100,
    message: 'Success',
  }),
  executeWithFallback: vi.fn().mockResolvedValue({
    success: true,
    mode: 'simulated',
    action: { type: 'restart', target: { namespace: 'demo', deployment: 'demo-app' } },
    timestamp: new Date(),
    durationMs: 100,
    message: 'Success',
  }),
  checkAvailability: vi.fn().mockResolvedValue({
    kubernetes: false,
    simulated: true,
    currentMode: 'auto',
    activeExecutor: 'SimulatedExecutor',
  }),
  checkCooldown: vi.fn().mockReturnValue({ allowed: true }),
  clearCooldown: vi.fn(),
});

// Create mock incident
const createMockIncident = (overrides?: Partial<Incident>): Incident => ({
  id: 'test-incident-123',
  title: 'Test Incident',
  description: 'A test incident',
  severity: 'high',
  status: 'active',
  state: OODA_STATES.IDLE,
  namespace: 'demo',
  startedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('InvestigationOrchestrator', () => {
  let mockGeminiClient: ReturnType<typeof createMockGeminiClient>;
  let mockVideoWatcher: ReturnType<typeof createMockVideoWatcher>;
  let mockExecutorFactory: ReturnType<typeof createMockExecutorFactory>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGeminiClient = createMockGeminiClient();
    mockVideoWatcher = createMockVideoWatcher();
    mockExecutorFactory = createMockExecutorFactory();
  });

  describe('constructor', () => {
    it('should create orchestrator with all dependencies', () => {
      const orchestrator = new InvestigationOrchestrator(
        {
          geminiClient: mockGeminiClient as unknown as GeminiClient,
          videoWatcher: mockVideoWatcher as unknown as VideoWatcher,
          executorFactory: mockExecutorFactory as unknown as ExecutorFactory,
        },
        { verificationWaitMs: 100 }
      );

      expect(orchestrator).toBeDefined();
    });

    it('should create orchestrator with minimal dependencies', () => {
      const orchestrator = new InvestigationOrchestrator({
        geminiClient: mockGeminiClient as unknown as GeminiClient,
      });

      expect(orchestrator).toBeDefined();
    });

    it('should accept custom configuration', () => {
      const orchestrator = new InvestigationOrchestrator(
        { geminiClient: mockGeminiClient as unknown as GeminiClient },
        {
          confidenceThreshold: 0.9,
          maxActionsPerIncident: 3,
          verificationWaitMs: 5000,
          maxVerificationAttempts: 5,
        }
      );

      expect(orchestrator).toBeDefined();
    });
  });

  describe('event registration', () => {
    it('should allow registering event listeners', () => {
      const orchestrator = new InvestigationOrchestrator({
        geminiClient: mockGeminiClient as unknown as GeminiClient,
      });

      const listener = vi.fn();
      orchestrator.on('investigation:started', listener);
      orchestrator.on('investigation:completed', listener);
      orchestrator.on('investigation:failed', listener);
      orchestrator.on('phase:changed', listener);
      orchestrator.on('observation:collected', listener);
      orchestrator.on('hypothesis:generated', listener);
      orchestrator.on('action:executed', listener);
      orchestrator.on('verification:completed', listener);

      // No errors thrown
      expect(true).toBe(true);
    });

    it('should emit investigation:started when investigate is called', async () => {
      const orchestrator = new InvestigationOrchestrator(
        {
          geminiClient: mockGeminiClient as unknown as GeminiClient,
          videoWatcher: mockVideoWatcher as unknown as VideoWatcher,
          executorFactory: mockExecutorFactory as unknown as ExecutorFactory,
        },
        { verificationWaitMs: 50, maxVerificationAttempts: 1 }
      );

      const startedSpy = vi.fn();
      orchestrator.on('investigation:started', startedSpy);

      const incident = createMockIncident();

      // Don't await - just start the investigation
      const promise = orchestrator.investigate(incident);

      // Wait a bit for the event to be emitted
      await new Promise((r) => setTimeout(r, 100));

      expect(startedSpy).toHaveBeenCalledWith({ incident });

      // Clean up
      await promise.catch(() => {});
    });
  });

  describe('investigate method', () => {
    it('should be callable with an incident', () => {
      const orchestrator = new InvestigationOrchestrator({
        geminiClient: mockGeminiClient as unknown as GeminiClient,
        videoWatcher: mockVideoWatcher as unknown as VideoWatcher,
        executorFactory: mockExecutorFactory as unknown as ExecutorFactory,
      });

      const incident = createMockIncident();

      // Should not throw when called
      expect(() => {
        orchestrator.investigate(incident).catch(() => {});
      }).not.toThrow();
    });

    it('should return a promise', () => {
      const orchestrator = new InvestigationOrchestrator({
        geminiClient: mockGeminiClient as unknown as GeminiClient,
        videoWatcher: mockVideoWatcher as unknown as VideoWatcher,
        executorFactory: mockExecutorFactory as unknown as ExecutorFactory,
      });

      const incident = createMockIncident();
      const result = orchestrator.investigate(incident);

      expect(result).toBeInstanceOf(Promise);

      // Clean up
      result.catch(() => {});
    });
  });

  describe('dependency injection', () => {
    it('should accept custom video watcher', () => {
      const customVideoWatcher = createMockVideoWatcher();

      const orchestrator = new InvestigationOrchestrator({
        geminiClient: mockGeminiClient as unknown as GeminiClient,
        videoWatcher: customVideoWatcher as unknown as VideoWatcher,
      });

      expect(orchestrator).toBeDefined();
    });

    it('should accept custom executor factory', () => {
      const customExecutorFactory = createMockExecutorFactory();

      const orchestrator = new InvestigationOrchestrator({
        geminiClient: mockGeminiClient as unknown as GeminiClient,
        executorFactory: customExecutorFactory as unknown as ExecutorFactory,
      });

      expect(orchestrator).toBeDefined();
    });

    it('should create defaults when dependencies not provided', () => {
      // Only GeminiClient is required
      const orchestrator = new InvestigationOrchestrator({
        geminiClient: mockGeminiClient as unknown as GeminiClient,
      });

      expect(orchestrator).toBeDefined();
    });
  });
});

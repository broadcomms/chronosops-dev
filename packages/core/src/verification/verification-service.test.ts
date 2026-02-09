/**
 * VerificationService Tests
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { VerificationService } from './verification-service.js';
import type { ActionResult } from '../agents/executor/types.js';

describe('VerificationService', () => {
  let service: VerificationService;

  beforeEach(() => {
    // Create service with zero cooldown for fast tests
    service = new VerificationService({
      defaultConfig: {
        strategy: 'multi_modal',
        timeoutMs: 5000,
        retryAttempts: 1,
        retryDelayMs: 100,
        successThreshold: 0.7,
        cooldownMs: 0, // No cooldown for tests
        enableVisualVerification: false, // Disable features requiring external services
        enableMetricVerification: false,
        enableLogVerification: true,
      },
      kubernetesEnabled: false,
      geminiEnabled: false,
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper to create an action result
  const createActionResult = (overrides: Partial<ActionResult> = {}): ActionResult => ({
    success: true,
    mode: 'simulated',
    action: {
      type: 'restart',
      target: {
        namespace: 'production',
        deployment: 'api-server',
      },
      reason: 'High CPU usage',
      incidentId: 'incident-1',
    },
    timestamp: new Date(),
    durationMs: 5000,
    message: 'Action completed',
    ...overrides,
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const svc = new VerificationService();
      expect(svc).toBeDefined();
    });

    it('should accept custom config', () => {
      const svc = new VerificationService({
        kubernetesEnabled: false,
        geminiEnabled: false,
      });
      expect(svc).toBeDefined();
    });

    it('should extend EventEmitter', () => {
      expect(service.emit).toBeDefined();
      expect(service.on).toBeDefined();
    });
  });

  describe('verify()', () => {
    it('should verify a successful action', async () => {
      const action = createActionResult();

      const resultPromise = service.verify(action, 'incident-1');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.confidence).toBe('number');
      expect(result.timestamp).toBeDefined();
    });

    it('should return verification result structure', async () => {
      const action = createActionResult();

      const resultPromise = service.verify(action, 'incident-1');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('actionId');
    });

    it('should handle action with pre/post state', async () => {
      const action = createActionResult();

      const resultPromise = service.verify(
        action,
        'incident-1',
        { logs: ['pre-action log'] },
        { logs: ['post-action log'] }
      );
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBeDefined();
    });
  });

  describe('setK8sClient()', () => {
    it('should accept K8s client injection', () => {
      const mockK8sClient = {
        getPodStatus: vi.fn(),
        exec: vi.fn(),
      };

      // Should not throw
      service.setK8sClient(mockK8sClient);
    });
  });

  describe('setGeminiClient()', () => {
    it('should accept Gemini client injection', () => {
      const mockGeminiClient = {
        generateContent: vi.fn(),
      };

      // Should not throw
      service.setGeminiClient(mockGeminiClient);
    });
  });

  describe('event emissions', () => {
    it('should emit verificationComplete event', async () => {
      const listener = vi.fn();
      service.on('verificationComplete', listener);

      const action = createActionResult();
      const resultPromise = service.verify(action, 'incident-1');
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(listener).toHaveBeenCalled();
    });

    it('should emit checkCompleted events when checks are performed', async () => {
      const listener = vi.fn();
      service.on('checkCompleted', listener);

      const action = createActionResult();
      // Provide post-action logs so that log verification check runs
      const resultPromise = service.verify(
        action,
        'incident-1',
        undefined,
        { logs: ['Service restarted successfully', 'Ready to accept connections'] }
      );
      await vi.runAllTimersAsync();
      await resultPromise;

      // Log verification check should be performed
      expect(listener).toHaveBeenCalled();
    });
  });
});

/**
 * RollbackManager Tests
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RollbackManager } from './rollback-manager.js';
import type { ActionResult, ActionRequest } from '../agents/executor/types.js';
import type { VerificationResult } from '../verification/types.js';
import type { RollbackTarget, RollbackTrigger } from './types.js';

describe('RollbackManager', () => {
  let manager: RollbackManager;

  beforeEach(() => {
    manager = new RollbackManager();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper to create action result
  const createActionResult = (overrides: Partial<ActionResult> = {}): ActionResult => ({
    success: true,
    mode: 'simulated',
    action: {
      type: 'restart',
      target: { namespace: 'prod', deployment: 'api' },
      reason: 'High CPU',
      incidentId: 'incident-1',
    },
    timestamp: new Date(),
    durationMs: 5000,
    message: 'Action completed',
    ...overrides,
  });

  // Helper to create verification result
  const createVerificationResult = (overrides: Partial<VerificationResult> = {}): VerificationResult => ({
    success: true,
    confidence: 0.9,
    timestamp: new Date(),
    action: createActionResult(),
    checksPerformed: 3,
    checksPassed: 3,
    checksFailed: 0,
    shouldRetry: false,
    ...overrides,
  });

  describe('evaluateRollbackNeed()', () => {
    it('should not recommend rollback for successful verification', () => {
      const action = createActionResult();
      const verification = createVerificationResult({ success: true });

      const decision = manager.evaluateRollbackNeed(action, verification, 'incident-1');

      expect(decision.shouldRollback).toBe(false);
    });

    it('should recommend rollback for failed verification', () => {
      const action = createActionResult();
      const verification = createVerificationResult({
        success: false,
        confidence: 0.1,
        healthCheck: {
          healthy: false,
          allPodsReady: false,
          readyPods: 0,
          totalPods: 3,
          unhealthyPods: ['api-1', 'api-2', 'api-3'],
        },
      });

      const decision = manager.evaluateRollbackNeed(action, verification, 'incident-1');

      expect(decision.shouldRollback).toBe(true);
      expect(decision.urgency).toBe('critical');
    });

    it('should include reasoning for decision', () => {
      const action = createActionResult();
      const verification = createVerificationResult({ success: false });

      const decision = manager.evaluateRollbackNeed(action, verification, 'incident-1');

      expect(decision.reasoning).toBeDefined();
      expect(decision.reasoning.length).toBeGreaterThan(0);
    });

    it('should assign confidence to decision', () => {
      const action = createActionResult();
      const verification = createVerificationResult({ success: false });

      const decision = manager.evaluateRollbackNeed(action, verification, 'incident-1');

      expect(decision.confidence).toBeGreaterThan(0);
      expect(decision.confidence).toBeLessThanOrEqual(1);
    });

    it('should emit decisionMade event', () => {
      const listener = vi.fn();
      manager.on('decisionMade', listener);

      const action = createActionResult();
      const verification = createVerificationResult();

      manager.evaluateRollbackNeed(action, verification, 'incident-1');

      expect(listener).toHaveBeenCalled();
    });

    it('should not exceed max rollbacks per incident', () => {
      // Simulate reaching max rollbacks
      for (let i = 0; i < 5; i++) {
        manager['incrementRollbackCount']('incident-1');
      }

      const action = createActionResult();
      const verification = createVerificationResult({ success: false });

      const decision = manager.evaluateRollbackNeed(action, verification, 'incident-1');

      expect(decision.shouldRollback).toBe(false);
      expect(decision.reasoning).toContain('limit');
    });
  });

  describe('requestRollback()', () => {
    it('should create rollback request', async () => {
      const targets: RollbackTarget[] = [
        { type: 'deployment', namespace: 'prod', name: 'api' },
      ];

      const request = await manager.requestRollback(
        'incident-1',
        targets,
        'verification_failure',
        'Health check failed'
      );

      expect(request).toBeDefined();
      expect(request.id).toBeDefined();
      expect(request.incidentId).toBe('incident-1');
      expect(request.targets).toEqual(targets);
    });

    it('should set pending status for requests requiring approval', async () => {
      // Configure to require approval
      const strictManager = new RollbackManager({
        policy: { requireApproval: true },
      });

      const request = await strictManager.requestRollback(
        'incident-1',
        [{ type: 'deployment', namespace: 'prod', name: 'api' }],
        'manual_request',
        'User requested'
      );

      expect(request.status).toBe('pending');
    });

    it('should emit rollbackRequested event', async () => {
      const listener = vi.fn();
      manager.on('rollbackRequested', listener);

      await manager.requestRollback(
        'incident-1',
        [{ type: 'deployment', namespace: 'prod', name: 'api' }],
        'verification_failure',
        'Test'
      );

      expect(listener).toHaveBeenCalled();
    });
  });

  describe('approveRollback()', () => {
    it('should approve pending rollback', async () => {
      const strictManager = new RollbackManager({
        policy: { requireApproval: true },
      });

      const request = await strictManager.requestRollback(
        'incident-1',
        [{ type: 'deployment', namespace: 'prod', name: 'api' }],
        'manual_request',
        'Test'
      );

      const approved = await strictManager.approveRollback(request.id, 'admin@example.com');

      expect(approved).not.toBeNull();
      expect(approved!.status).not.toBe('pending');
    });

    it('should return null for unknown request', async () => {
      const approved = await manager.approveRollback('unknown-id', 'admin');
      expect(approved).toBeNull();
    });

    it('should emit rollbackApproved event', async () => {
      const strictManager = new RollbackManager({
        policy: { requireApproval: true },
      });

      const listener = vi.fn();
      strictManager.on('rollbackApproved', listener);

      const request = await strictManager.requestRollback(
        'incident-1',
        [{ type: 'deployment', namespace: 'prod', name: 'api' }],
        'manual_request',
        'Test'
      );

      await strictManager.approveRollback(request.id, 'admin');

      expect(listener).toHaveBeenCalled();
    });
  });

  describe('cancelRollback()', () => {
    it('should cancel pending rollback', async () => {
      const strictManager = new RollbackManager({
        policy: { requireApproval: true },
      });

      const request = await strictManager.requestRollback(
        'incident-1',
        [{ type: 'deployment', namespace: 'prod', name: 'api' }],
        'manual_request',
        'Test'
      );

      const cancelled = strictManager.cancelRollback(request.id, 'Changed mind');

      expect(cancelled).toBe(true);
    });

    it('should return false for unknown request', () => {
      const cancelled = manager.cancelRollback('unknown-id', 'reason');
      expect(cancelled).toBe(false);
    });
  });

  describe('takeSnapshot()', () => {
    it('should return null without K8s client', async () => {
      const snapshot = await manager.takeSnapshot('incident-1', 'prod');
      expect(snapshot).toBeNull();
    });

    it('should take snapshot with K8s client', async () => {
      const mockK8sClient = {
        rollback: vi.fn(),
        getDeployment: vi.fn(),
        listDeployments: vi.fn().mockResolvedValue([
          { name: 'api', namespace: 'prod', replicas: 3, revision: 5, image: 'api:v1' },
        ]),
      };

      manager.setK8sClient(mockK8sClient);

      const snapshot = await manager.takeSnapshot('incident-1', 'prod');

      expect(snapshot).not.toBeNull();
      expect(snapshot!.deployments.length).toBe(1);
    });
  });

  describe('getLatestSnapshot()', () => {
    it('should return null for no snapshots', () => {
      const snapshot = manager.getLatestSnapshot('unknown-incident');
      expect(snapshot).toBeNull();
    });
  });

  describe('getHistory()', () => {
    it('should return empty array for new incident', () => {
      const history = manager.getHistory('incident-1');
      expect(history).toEqual([]);
    });
  });

  describe('getPendingApprovals()', () => {
    it('should list pending approvals', async () => {
      const strictManager = new RollbackManager({
        policy: { requireApproval: true },
      });

      await strictManager.requestRollback(
        'incident-1',
        [{ type: 'deployment', namespace: 'prod', name: 'api' }],
        'manual_request',
        'Test'
      );

      const pending = strictManager.getPendingApprovals();

      expect(pending.length).toBe(1);
    });
  });

  describe('getRollbackCount()', () => {
    it('should return 0 for new incident', () => {
      const count = manager.getRollbackCount('incident-1');
      expect(count).toBe(0);
    });
  });

  describe('resetRollbackCount()', () => {
    it('should reset rollback count', () => {
      manager['incrementRollbackCount']('incident-1');
      expect(manager.getRollbackCount('incident-1')).toBe(1);

      manager.resetRollbackCount('incident-1');

      expect(manager.getRollbackCount('incident-1')).toBe(0);
    });
  });

  describe('checkCascadeProtection()', () => {
    it('should not trigger when disabled', () => {
      const noProtectionManager = new RollbackManager({
        enableCascadeProtection: false,
      });

      const triggered = noProtectionManager.checkCascadeProtection(
        'incident-1',
        [{ type: 'deployment', namespace: 'prod', name: 'api' }]
      );

      expect(triggered).toBe(false);
    });

    it('should trigger on escalation threshold', () => {
      // Increment to exceed threshold
      for (let i = 0; i < 5; i++) {
        manager['incrementRollbackCount']('incident-1');
      }

      const triggered = manager.checkCascadeProtection(
        'incident-1',
        [{ type: 'deployment', namespace: 'prod', name: 'api' }]
      );

      expect(triggered).toBe(true);
    });
  });

  describe('cooldown handling', () => {
    it('should respect cooldown between rollbacks', () => {
      const action = createActionResult();
      const verification = createVerificationResult({ success: false });

      // First rollback
      manager.evaluateRollbackNeed(action, verification, 'incident-1');
      manager['incrementRollbackCount']('incident-1');

      // Immediate second evaluation (within cooldown)
      const decision = manager.evaluateRollbackNeed(action, verification, 'incident-1');

      expect(decision.shouldRollback).toBe(false);
      expect(decision.reasoning).toContain('cooldown');
    });

    it('should allow rollback after cooldown expires', () => {
      const action = createActionResult();
      const verification = createVerificationResult({
        success: false,
        healthCheck: {
          healthy: false,
          allPodsReady: false,
          readyPods: 0,
          totalPods: 3,
          unhealthyPods: ['api-1', 'api-2', 'api-3'],
        },
      });

      // First rollback
      manager.evaluateRollbackNeed(action, verification, 'incident-1');
      manager['incrementRollbackCount']('incident-1');

      // Advance past cooldown
      vi.advanceTimersByTime(120000); // 2 minutes

      const decision = manager.evaluateRollbackNeed(action, verification, 'incident-1');

      // Should now allow rollback (not blocked by cooldown)
      expect(decision.reasoning).not.toContain('cooldown');
    });
  });

  describe('protected namespaces', () => {
    it('should require approval for protected namespaces', async () => {
      const protectedManager = new RollbackManager({
        policy: {
          protectedNamespaces: ['production', 'kube-system'],
        },
      });

      const request = await protectedManager.requestRollback(
        'incident-1',
        [{ type: 'deployment', namespace: 'production', name: 'api' }],
        'verification_failure',
        'Test'
      );

      expect(request.status).toBe('pending');
    });
  });

  describe('protected deployments', () => {
    it('should require approval for protected deployments', async () => {
      const protectedManager = new RollbackManager({
        policy: {
          protectedDeployments: ['api-gateway', 'database'],
        },
      });

      const request = await protectedManager.requestRollback(
        'incident-1',
        [{ type: 'deployment', namespace: 'prod', name: 'api-gateway' }],
        'verification_failure',
        'Test'
      );

      expect(request.status).toBe('pending');
    });
  });
});

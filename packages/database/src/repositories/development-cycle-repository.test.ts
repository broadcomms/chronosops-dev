/**
 * Development Cycle Repository Tests
 * Integration tests for database operations on development cycles
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { DevelopmentCycleRepository } from './development-cycle-repository.js';
import { initializeDatabase, getDatabase, closeDatabase } from '../connection.js';
import { developmentCycles } from '../schema.js';
import { eq } from 'drizzle-orm';
import type { DevelopmentPhase } from '@chronosops/shared';

// ===========================================
// Test Setup
// ===========================================

describe('DevelopmentCycleRepository', () => {
  let repository: DevelopmentCycleRepository;
  const testCycleIds: string[] = [];

  beforeAll(async () => {
    // Initialize in-memory database for testing
    await initializeDatabase(':memory:');
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(() => {
    repository = new DevelopmentCycleRepository();
  });

  afterEach(async () => {
    // Clean up test cycles
    const db = getDatabase();
    for (const id of testCycleIds) {
      try {
        await db.delete(developmentCycles).where(eq(developmentCycles.id, id));
      } catch {
        // Ignore cleanup errors
      }
    }
    testCycleIds.length = 0;
  });

  describe('create', () => {
    it('should create a new development cycle with required fields', async () => {
      const cycle = await repository.create({
        requirementSource: 'user',
        requirementRaw: 'Create a REST API for task management',
        requirementPriority: 'medium',
      });

      testCycleIds.push(cycle.id);

      expect(cycle.id).toBeDefined();
      expect(cycle.id).toHaveLength(36); // UUID format
      expect(cycle.phase).toBe('IDLE');
      expect(cycle.serviceType).toBe('backend');
      expect(cycle.requirementSource).toBe('user');
      expect(cycle.requirementRaw).toBe('Create a REST API for task management');
      expect(cycle.requirementPriority).toBe('medium');
      expect(cycle.iterations).toBe(0);
      expect(cycle.maxIterations).toBe(5);
      expect(cycle.createdAt).toBeInstanceOf(Date);
      expect(cycle.updatedAt).toBeInstanceOf(Date);
      expect(cycle.completedAt).toBeNull();
    });

    it('should create cycle with all optional fields', async () => {
      const cycle = await repository.create({
        requirementSource: 'incident',
        requirementRaw: 'Fix memory leak in service',
        requirementPriority: 'critical',
        triggeredByIncidentId: 'incident-123',
        maxIterations: 10,
        serviceType: 'fullstack',
        frontendConfig: JSON.stringify({
          framework: 'react',
          bundler: 'vite',
          styling: 'tailwind',
        }),
      });

      testCycleIds.push(cycle.id);

      expect(cycle.triggeredByIncidentId).toBe('incident-123');
      expect(cycle.maxIterations).toBe(10);
      expect(cycle.serviceType).toBe('fullstack');
      expect(cycle.frontendConfig).toBe(
        JSON.stringify({ framework: 'react', bundler: 'vite', styling: 'tailwind' })
      );
    });

    it('should create cycle with different service types', async () => {
      const backendCycle = await repository.create({
        requirementSource: 'user',
        requirementRaw: 'Create backend API',
        requirementPriority: 'medium',
        serviceType: 'backend',
      });
      testCycleIds.push(backendCycle.id);

      const frontendCycle = await repository.create({
        requirementSource: 'user',
        requirementRaw: 'Create frontend app',
        requirementPriority: 'medium',
        serviceType: 'frontend',
      });
      testCycleIds.push(frontendCycle.id);

      const fullstackCycle = await repository.create({
        requirementSource: 'user',
        requirementRaw: 'Create fullstack app',
        requirementPriority: 'medium',
        serviceType: 'fullstack',
      });
      testCycleIds.push(fullstackCycle.id);

      expect(backendCycle.serviceType).toBe('backend');
      expect(frontendCycle.serviceType).toBe('frontend');
      expect(fullstackCycle.serviceType).toBe('fullstack');
    });

    it('should create cycles with different priorities', async () => {
      const priorities = ['low', 'medium', 'high', 'critical'] as const;

      for (const priority of priorities) {
        const cycle = await repository.create({
          requirementSource: 'user',
          requirementRaw: `Test cycle with ${priority} priority`,
          requirementPriority: priority,
        });
        testCycleIds.push(cycle.id);
        expect(cycle.requirementPriority).toBe(priority);
      }
    });

    it('should create cycles with different sources', async () => {
      const sources = ['user', 'incident', 'improvement', 'pattern'] as const;

      for (const source of sources) {
        const cycle = await repository.create({
          requirementSource: source,
          requirementRaw: `Test cycle from ${source}`,
          requirementPriority: 'medium',
        });
        testCycleIds.push(cycle.id);
        expect(cycle.requirementSource).toBe(source);
      }
    });
  });

  describe('getById', () => {
    it('should return cycle by ID', async () => {
      const created = await repository.create({
        requirementSource: 'user',
        requirementRaw: 'Test requirement',
        requirementPriority: 'medium',
      });
      testCycleIds.push(created.id);

      const retrieved = await repository.getById(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.requirementRaw).toBe('Test requirement');
    });

    it('should return null for non-existent ID', async () => {
      const retrieved = await repository.getById('non-existent-id');
      expect(retrieved).toBeNull();
    });
  });

  describe('update', () => {
    it('should update cycle phase', async () => {
      const cycle = await repository.create({
        requirementSource: 'user',
        requirementRaw: 'Test requirement',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      const updated = await repository.update(cycle.id, {
        phase: 'ANALYZING' as DevelopmentPhase,
      });

      expect(updated?.phase).toBe('ANALYZING');
    });

    it('should update analyzed requirement JSON', async () => {
      const cycle = await repository.create({
        requirementSource: 'user',
        requirementRaw: 'Test requirement',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      const analyzedReq = JSON.stringify({
        title: 'Test API',
        description: 'A test API',
        features: ['feature1', 'feature2'],
      });

      const updated = await repository.update(cycle.id, {
        analyzedRequirement: analyzedReq,
      });

      expect(updated?.analyzedRequirement).toBe(analyzedReq);
    });

    it('should update architecture JSON', async () => {
      const cycle = await repository.create({
        requirementSource: 'user',
        requirementRaw: 'Test requirement',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      const architecture = JSON.stringify({
        overview: 'REST API architecture',
        components: [],
      });

      const updated = await repository.update(cycle.id, {
        architecture,
      });

      expect(updated?.architecture).toBe(architecture);
    });

    it('should update build result', async () => {
      const cycle = await repository.create({
        requirementSource: 'user',
        requirementRaw: 'Test requirement',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      const buildResult = JSON.stringify({
        success: true,
        imageTag: 'latest',
        logs: ['Build started', 'Build completed'],
      });

      const updated = await repository.update(cycle.id, {
        buildResult,
      });

      expect(updated?.buildResult).toBe(buildResult);
    });

    it('should update deployment information', async () => {
      const cycle = await repository.create({
        requirementSource: 'user',
        requirementRaw: 'Test requirement',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      const deployment = JSON.stringify({
        deploymentName: 'test-app',
        namespace: 'development',
        serviceUrl: 'http://localhost:30001',
      });

      const updated = await repository.update(cycle.id, {
        deployment,
      });

      expect(updated?.deployment).toBe(deployment);
    });

    it('should update iterations count', async () => {
      const cycle = await repository.create({
        requirementSource: 'user',
        requirementRaw: 'Test requirement',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      const updated = await repository.update(cycle.id, {
        iterations: 3,
      });

      expect(updated?.iterations).toBe(3);
    });

    it('should update thought signature', async () => {
      const cycle = await repository.create({
        requirementSource: 'user',
        requirementRaw: 'Test requirement',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      const updated = await repository.update(cycle.id, {
        thoughtSignature: 'test-thought-signature-abc123',
      });

      expect(updated?.thoughtSignature).toBe('test-thought-signature-abc123');
    });

    it('should update multiple fields at once', async () => {
      const cycle = await repository.create({
        requirementSource: 'user',
        requirementRaw: 'Test requirement',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      const updated = await repository.update(cycle.id, {
        phase: 'CODING' as DevelopmentPhase,
        iterations: 2,
        architecture: JSON.stringify({ overview: 'Test' }),
      });

      expect(updated?.phase).toBe('CODING');
      expect(updated?.iterations).toBe(2);
      expect(updated?.architecture).toBe(JSON.stringify({ overview: 'Test' }));
    });

    it('should update updatedAt timestamp', async () => {
      const cycle = await repository.create({
        requirementSource: 'user',
        requirementRaw: 'Test requirement',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      const originalUpdatedAt = cycle.updatedAt;

      // Wait a bit to ensure timestamp difference
      await new Promise((r) => setTimeout(r, 10));

      const updated = await repository.update(cycle.id, {
        phase: 'ANALYZING' as DevelopmentPhase,
      });

      expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(
        originalUpdatedAt.getTime()
      );
    });

    it('should return null for non-existent ID', async () => {
      const updated = await repository.update('non-existent-id', {
        phase: 'ANALYZING' as DevelopmentPhase,
      });

      expect(updated).toBeNull();
    });
  });

  describe('updatePhase', () => {
    it('should update only the phase', async () => {
      const cycle = await repository.create({
        requirementSource: 'user',
        requirementRaw: 'Test requirement',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      const updated = await repository.updatePhase(cycle.id, 'DESIGNING');

      expect(updated?.phase).toBe('DESIGNING');
    });
  });

  describe('incrementIterations', () => {
    it('should increment iterations by one', async () => {
      const cycle = await repository.create({
        requirementSource: 'user',
        requirementRaw: 'Test requirement',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      expect(cycle.iterations).toBe(0);

      const updated = await repository.incrementIterations(cycle.id);
      expect(updated?.iterations).toBe(1);

      const updated2 = await repository.incrementIterations(cycle.id);
      expect(updated2?.iterations).toBe(2);
    });

    it('should return null for non-existent ID', async () => {
      const updated = await repository.incrementIterations('non-existent-id');
      expect(updated).toBeNull();
    });
  });

  describe('complete', () => {
    it('should mark cycle as completed', async () => {
      const cycle = await repository.create({
        requirementSource: 'user',
        requirementRaw: 'Test requirement',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      const verification = JSON.stringify({
        healthy: true,
        checks: ['health endpoint', 'response time'],
      });

      const completed = await repository.complete(cycle.id, verification);

      expect(completed?.phase).toBe('COMPLETED');
      expect(completed?.verification).toBe(verification);
      expect(completed?.completedAt).toBeInstanceOf(Date);
    });

    it('should complete without verification', async () => {
      const cycle = await repository.create({
        requirementSource: 'user',
        requirementRaw: 'Test requirement',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      const completed = await repository.complete(cycle.id);

      expect(completed?.phase).toBe('COMPLETED');
      expect(completed?.completedAt).toBeInstanceOf(Date);
    });
  });

  describe('fail', () => {
    it('should mark cycle as failed with error', async () => {
      const cycle = await repository.create({
        requirementSource: 'user',
        requirementRaw: 'Test requirement',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      const failed = await repository.fail(cycle.id, 'Build failed: TypeScript errors');

      expect(failed?.phase).toBe('FAILED');
      expect(failed?.error).toBe('Build failed: TypeScript errors');
      expect(failed?.completedAt).toBeInstanceOf(Date);
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      // Create test cycles with different properties
      const cycle1 = await repository.create({
        requirementSource: 'user',
        requirementRaw: 'User cycle 1',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle1.id);

      const cycle2 = await repository.create({
        requirementSource: 'incident',
        requirementRaw: 'Incident cycle',
        requirementPriority: 'critical',
        triggeredByIncidentId: 'inc-123',
      });
      testCycleIds.push(cycle2.id);

      const cycle3 = await repository.create({
        requirementSource: 'user',
        requirementRaw: 'User cycle 2',
        requirementPriority: 'low',
      });
      testCycleIds.push(cycle3.id);
      await repository.complete(cycle3.id);
    });

    it('should list all cycles', async () => {
      const cycles = await repository.list();

      expect(cycles.length).toBeGreaterThanOrEqual(3);
    });

    it('should filter by phase', async () => {
      const idleCycles = await repository.list({ phase: 'IDLE' });
      const completedCycles = await repository.list({ phase: 'COMPLETED' });

      expect(idleCycles.every((c) => c.phase === 'IDLE')).toBe(true);
      expect(completedCycles.every((c) => c.phase === 'COMPLETED')).toBe(true);
    });

    it('should filter by requirement source', async () => {
      const userCycles = await repository.list({ requirementSource: 'user' });
      const incidentCycles = await repository.list({ requirementSource: 'incident' });

      expect(userCycles.every((c) => c.requirementSource === 'user')).toBe(true);
      expect(incidentCycles.every((c) => c.requirementSource === 'incident')).toBe(true);
    });

    it('should filter by requirement priority', async () => {
      const criticalCycles = await repository.list({ requirementPriority: 'critical' });

      expect(criticalCycles.every((c) => c.requirementPriority === 'critical')).toBe(true);
    });

    it('should filter by triggered by incident ID', async () => {
      const cycles = await repository.list({ triggeredByIncidentId: 'inc-123' });

      expect(cycles.every((c) => c.triggeredByIncidentId === 'inc-123')).toBe(true);
    });

    it('should filter active cycles', async () => {
      const activeCycles = await repository.list({ isActive: true });

      expect(
        activeCycles.every((c) => c.phase !== 'COMPLETED' && c.phase !== 'FAILED')
      ).toBe(true);
    });

    it('should respect limit parameter', async () => {
      const cycles = await repository.list({}, 2);

      expect(cycles.length).toBeLessThanOrEqual(2);
    });

    it('should respect offset parameter', async () => {
      const allCycles = await repository.list({}, 100, 0);
      const offsetCycles = await repository.list({}, 100, 1);

      expect(offsetCycles.length).toBeLessThan(allCycles.length);
    });

    it('should order by createdAt descending', async () => {
      const cycles = await repository.list();

      for (let i = 1; i < cycles.length; i++) {
        expect(cycles[i - 1]!.createdAt.getTime()).toBeGreaterThanOrEqual(
          cycles[i]!.createdAt.getTime()
        );
      }
    });
  });

  describe('getActive', () => {
    it('should return only active cycles (not completed)', async () => {
      const activeCycle = await repository.create({
        requirementSource: 'user',
        requirementRaw: 'Active cycle',
        requirementPriority: 'medium',
      });
      testCycleIds.push(activeCycle.id);

      const completedCycle = await repository.create({
        requirementSource: 'user',
        requirementRaw: 'Completed cycle',
        requirementPriority: 'medium',
      });
      testCycleIds.push(completedCycle.id);
      await repository.complete(completedCycle.id);

      const activeCycles = await repository.getActive();

      expect(activeCycles.some((c) => c.id === activeCycle.id)).toBe(true);
      expect(activeCycles.some((c) => c.id === completedCycle.id)).toBe(false);
    });
  });

  describe('getByIncident', () => {
    it('should return cycles triggered by specific incident', async () => {
      const incidentId = 'test-incident-456';

      const cycle1 = await repository.create({
        requirementSource: 'incident',
        requirementRaw: 'Fix from incident',
        requirementPriority: 'high',
        triggeredByIncidentId: incidentId,
      });
      testCycleIds.push(cycle1.id);

      const cycle2 = await repository.create({
        requirementSource: 'incident',
        requirementRaw: 'Another fix from incident',
        requirementPriority: 'high',
        triggeredByIncidentId: incidentId,
      });
      testCycleIds.push(cycle2.id);

      const cycle3 = await repository.create({
        requirementSource: 'user',
        requirementRaw: 'Unrelated cycle',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle3.id);

      const incidentCycles = await repository.getByIncident(incidentId);

      expect(incidentCycles.length).toBe(2);
      expect(incidentCycles.every((c) => c.triggeredByIncidentId === incidentId)).toBe(
        true
      );
    });

    it('should return empty array for non-existent incident', async () => {
      const cycles = await repository.getByIncident('non-existent-incident');
      expect(cycles).toHaveLength(0);
    });
  });

  describe('delete', () => {
    it('should delete cycle by ID', async () => {
      const cycle = await repository.create({
        requirementSource: 'user',
        requirementRaw: 'To be deleted',
        requirementPriority: 'medium',
      });

      await repository.delete(cycle.id);

      const retrieved = await repository.getById(cycle.id);
      expect(retrieved).toBeNull();
    });

    it('should not throw for non-existent ID', async () => {
      await expect(repository.delete('non-existent-id')).resolves.not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle very long requirement text', async () => {
      const longText = 'A'.repeat(10000);

      const cycle = await repository.create({
        requirementSource: 'user',
        requirementRaw: longText,
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      expect(cycle.requirementRaw).toBe(longText);
    });

    it('should handle special characters in requirement', async () => {
      const specialText = `Create API with "quotes", 'apostrophes', & symbols <>\n\t\r`;

      const cycle = await repository.create({
        requirementSource: 'user',
        requirementRaw: specialText,
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      expect(cycle.requirementRaw).toBe(specialText);
    });

    it('should handle unicode in requirement', async () => {
      const unicodeText = 'Create API for 日本語 data with émojis 🚀';

      const cycle = await repository.create({
        requirementSource: 'user',
        requirementRaw: unicodeText,
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      expect(cycle.requirementRaw).toBe(unicodeText);
    });

    it('should handle complex JSON in fields', async () => {
      const cycle = await repository.create({
        requirementSource: 'user',
        requirementRaw: 'Test',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      const complexJson = JSON.stringify({
        nested: {
          deeply: {
            data: [1, 2, 3],
            special: "value with \"quotes\"",
          },
        },
        array: [{ a: 1 }, { b: 2 }],
        unicode: '日本語',
      });

      const updated = await repository.update(cycle.id, {
        architecture: complexJson,
      });

      expect(updated?.architecture).toBe(complexJson);
      expect(JSON.parse(updated?.architecture ?? '{}')).toEqual(JSON.parse(complexJson));
    });
  });
});

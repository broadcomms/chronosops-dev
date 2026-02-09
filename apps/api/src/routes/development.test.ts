/**
 * Development API Routes Tests
 * Integration tests for development cycle API endpoints
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { developmentRoutes } from './development.js';
import { initializeDatabase, closeDatabase, developmentCycleRepository, generatedFileRepository } from '@chronosops/database';
import type { GeminiClient } from '@chronosops/gemini';
import type { K8sClient } from '@chronosops/kubernetes';
import type { DevelopmentOrchestrator } from '@chronosops/core';

// ===========================================
// Mock Types & Factories
// ===========================================

const createMockGeminiClient = () => ({
  analyzeRequirement: vi.fn().mockResolvedValue({
    success: true,
    data: {
      title: 'Task API',
      description: 'A REST API for tasks',
      features: ['CRUD operations'],
      estimatedComplexity: 'medium',
      requiredCapabilities: ['rest-api'],
    },
  }),
  designArchitecture: vi.fn().mockResolvedValue({
    success: true,
    data: {
      overview: 'REST API architecture',
      components: [{ name: 'TaskController', type: 'controller' }],
      dataFlow: [],
    },
  }),
  generateCode: vi.fn().mockResolvedValue({
    success: true,
    data: { files: [], dependencies: [] },
  }),
  fixCode: vi.fn().mockResolvedValue({
    success: true,
    data: { fixedCode: '', changes: [] },
  }),
  generateTests: vi.fn().mockResolvedValue({
    success: true,
    data: { tests: [] },
  }),
  getModelForTask: vi.fn().mockReturnValue('gemini-3-flash-preview'),
});

const createMockK8sClient = () => ({
  createDeployment: vi.fn().mockResolvedValue({ success: true }),
  createNodePortService: vi.fn().mockResolvedValue({ success: true, nodePort: 30001 }),
  waitForRollout: vi.fn().mockResolvedValue({ success: true }),
  checkDeploymentHealth: vi.fn().mockResolvedValue({ healthy: true }),
  getDeployment: vi.fn().mockResolvedValue({ name: 'test-app', status: 'available' }),
  deleteDeployment: vi.fn().mockResolvedValue({ success: true }),
  deleteService: vi.fn().mockResolvedValue({ success: true }),
  updateDeploymentImage: vi.fn().mockResolvedValue({ success: true }),
});

const createMockDevelopmentOrchestrator = () => ({
  develop: vi.fn().mockResolvedValue({
    id: 'test-cycle-123',
    phase: 'COMPLETED',
    iterations: 1,
  }),
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
});

// ===========================================
// Test Setup
// ===========================================

describe('Development API Routes', () => {
  let app: FastifyInstance;
  const testCycleIds: string[] = [];

  beforeAll(async () => {
    // Initialize in-memory database
    await initializeDatabase(':memory:');
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    // Create fresh Fastify instance for each test
    app = Fastify({ logger: false });

    // Mock services
    const mockGeminiClient = createMockGeminiClient();
    const mockK8sClient = createMockK8sClient();
    const mockDevelopmentOrchestrator = createMockDevelopmentOrchestrator();

    // Decorate app with mocked services
    app.decorate('services', {
      geminiClient: mockGeminiClient as unknown as GeminiClient,
      k8sClient: mockK8sClient as unknown as K8sClient,
      createDevelopmentOrchestrator: () => mockDevelopmentOrchestrator as unknown as DevelopmentOrchestrator,
    });

    // Register routes
    await app.register(async (fastify) => {
      await developmentRoutes(fastify);
    }, { prefix: '/api/v1/development' });

    await app.ready();
  });

  afterEach(async () => {
    // Cleanup test cycles
    for (const id of testCycleIds) {
      try {
        await developmentCycleRepository.delete(id);
      } catch {
        // Ignore cleanup errors
      }
    }
    testCycleIds.length = 0;

    await app.close();
  });

  // ===========================================
  // POST /api/v1/development - Create Cycle
  // ===========================================

  describe('POST /api/v1/development', () => {
    it('should create a new development cycle', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/development',
        payload: {
          requirement: 'Create a REST API for task management',
          priority: 'medium',
          source: 'user',
          serviceType: 'backend',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as { data: { id: string; phase: string; requirementRaw: string } };
      expect(body.data.id).toBeDefined();
      expect(body.data.phase).toBe('IDLE');
      expect(body.data.requirementRaw).toBe('Create a REST API for task management');

      testCycleIds.push(body.data.id);
    });

    it('should create cycle with default values', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/development',
        payload: {
          requirement: 'Simple API',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as { data: { requirementPriority: string; requirementSource: string; serviceType: string } };
      expect(body.data.requirementPriority).toBe('medium');
      expect(body.data.requirementSource).toBe('user');
      expect(body.data.serviceType).toBe('backend');

      testCycleIds.push((body as { data: { id: string } }).data.id);
    });

    it('should create cycle with all options', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/development',
        payload: {
          requirement: 'Full stack app',
          priority: 'critical',
          source: 'incident',
          triggeredByIncidentId: 'inc-123',
          maxIterations: 10,
          serviceType: 'fullstack',
          frontendConfig: {
            framework: 'react',
            bundler: 'vite',
            styling: 'tailwind',
            stateManagement: 'tanstack-query',
            consumesServices: [],
          },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as {
        data: {
          requirementPriority: string;
          requirementSource: string;
          maxIterations: number;
          serviceType: string;
          id: string;
        }
      };
      expect(body.data.requirementPriority).toBe('critical');
      expect(body.data.requirementSource).toBe('incident');
      expect(body.data.maxIterations).toBe(10);
      expect(body.data.serviceType).toBe('fullstack');

      testCycleIds.push(body.data.id);
    });

    it('should reject empty requirement', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/development',
        payload: {
          requirement: '',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject invalid priority', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/development',
        payload: {
          requirement: 'Test API',
          priority: 'invalid',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject invalid service type', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/development',
        payload: {
          requirement: 'Test API',
          serviceType: 'invalid',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ===========================================
  // GET /api/v1/development - List Cycles
  // ===========================================

  describe('GET /api/v1/development', () => {
    beforeEach(async () => {
      // Create test cycles
      const cycle1 = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Test cycle 1',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle1.id);

      const cycle2 = await developmentCycleRepository.create({
        requirementSource: 'incident',
        requirementRaw: 'Test cycle 2',
        requirementPriority: 'high',
        triggeredByIncidentId: 'inc-test',
      });
      testCycleIds.push(cycle2.id);

      const cycle3 = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Test cycle 3',
        requirementPriority: 'low',
      });
      testCycleIds.push(cycle3.id);
      await developmentCycleRepository.complete(cycle3.id);
    });

    it('should list all development cycles', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/development',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: Array<{ id: string }> };
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(3);
    });

    it('should filter by source', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/development?source=incident',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: Array<{ requirementSource: string }> };
      expect(body.data.every((c) => c.requirementSource === 'incident')).toBe(true);
    });

    it('should filter by priority', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/development?priority=high',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: Array<{ requirementPriority: string }> };
      expect(body.data.every((c) => c.requirementPriority === 'high')).toBe(true);
    });

    it('should filter by phase', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/development?phase=COMPLETED',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: Array<{ phase: string }> };
      expect(body.data.every((c) => c.phase === 'COMPLETED')).toBe(true);
    });

    it('should filter active cycles', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/development?isActive=true',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: Array<{ phase: string }> };
      expect(body.data.every((c) => c.phase !== 'COMPLETED' && c.phase !== 'FAILED')).toBe(true);
    });

    it('should respect limit parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/development?limit=2',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: Array<unknown> };
      expect(body.data.length).toBeLessThanOrEqual(2);
    });
  });

  // ===========================================
  // GET /api/v1/development/active - Active Cycles
  // ===========================================

  describe('GET /api/v1/development/active', () => {
    it('should return only active cycles', async () => {
      const activeCycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Active',
        requirementPriority: 'medium',
      });
      testCycleIds.push(activeCycle.id);

      const completedCycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Completed',
        requirementPriority: 'medium',
      });
      testCycleIds.push(completedCycle.id);
      await developmentCycleRepository.complete(completedCycle.id);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/development/active',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: Array<{ id: string }> };
      expect(body.data.some((c) => c.id === activeCycle.id)).toBe(true);
      expect(body.data.some((c) => c.id === completedCycle.id)).toBe(false);
    });
  });

  // ===========================================
  // GET /api/v1/development/:id - Get Cycle
  // ===========================================

  describe('GET /api/v1/development/:id', () => {
    it('should return cycle by ID with files', async () => {
      const cycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Test API',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      // Add a generated file
      await generatedFileRepository.create({
        developmentCycleId: cycle.id,
        path: 'src/index.ts',
        content: 'console.log("test")',
        language: 'typescript',
        purpose: 'Entry point',
        isNew: true,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/development/${cycle.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: { id: string; files: Array<{ path: string }> } };
      expect(body.data.id).toBe(cycle.id);
      expect(body.data.files).toBeDefined();
      expect(body.data.files.length).toBeGreaterThanOrEqual(1);
    });

    it('should return 404 for non-existent cycle', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/development/non-existent-id',
      });

      expect(response.statusCode).toBe(404);
    });

    it('should parse JSON fields in response', async () => {
      const cycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Test API',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      await developmentCycleRepository.update(cycle.id, {
        analyzedRequirement: JSON.stringify({ title: 'Test', features: ['a', 'b'] }),
        architecture: JSON.stringify({ overview: 'Test arch' }),
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/development/${cycle.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: { analyzedRequirement: { title: string }; architecture: { overview: string } } };
      expect(body.data.analyzedRequirement?.title).toBe('Test');
      expect(body.data.architecture?.overview).toBe('Test arch');
    });
  });

  // ===========================================
  // POST /api/v1/development/:id/start - Start Cycle
  // ===========================================

  describe('POST /api/v1/development/:id/start', () => {
    it('should start a development cycle', async () => {
      const cycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Test API',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/development/${cycle.id}/start`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { message: string; data: { id: string; phase: string } };
      expect(body.message).toBe('Development cycle started');
      expect(body.data.id).toBe(cycle.id);
      expect(body.data.phase).toBe('ANALYZING');
    });

    it('should return 404 for non-existent cycle', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/development/non-existent/start',
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 400 for already completed cycle', async () => {
      const cycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Test API',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);
      await developmentCycleRepository.complete(cycle.id);

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/development/${cycle.id}/start`,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toContain('already completed');
    });

    it('should return 400 for failed cycle', async () => {
      const cycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Test API',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);
      await developmentCycleRepository.fail(cycle.id, 'Test failure');

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/development/${cycle.id}/start`,
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ===========================================
  // GET /api/v1/development/:id/status - Get Status
  // ===========================================

  describe('GET /api/v1/development/:id/status', () => {
    it('should return cycle status', async () => {
      const cycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Test API',
        requirementPriority: 'medium',
        maxIterations: 5,
      });
      testCycleIds.push(cycle.id);

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/development/${cycle.id}/status`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        data: {
          id: string;
          phase: string;
          isRunning: boolean;
          iterations: number;
          maxIterations: number;
        }
      };
      expect(body.data.id).toBe(cycle.id);
      expect(body.data.phase).toBe('IDLE');
      expect(body.data.isRunning).toBe(false);
      expect(body.data.iterations).toBe(0);
      expect(body.data.maxIterations).toBe(5);
    });

    it('should return 404 for non-existent cycle', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/development/non-existent/status',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ===========================================
  // GET /api/v1/development/:id/files - Get Files
  // ===========================================

  describe('GET /api/v1/development/:id/files', () => {
    it('should return generated files', async () => {
      const cycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Test API',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      await generatedFileRepository.create({
        developmentCycleId: cycle.id,
        path: 'src/index.ts',
        content: 'export const app = {};',
        language: 'typescript',
        purpose: 'Main entry',
        isNew: true,
      });

      await generatedFileRepository.create({
        developmentCycleId: cycle.id,
        path: 'package.json',
        content: '{"name": "test"}',
        language: 'json',
        purpose: 'Package config',
        isNew: true,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/development/${cycle.id}/files`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: Array<{ path: string }> };
      expect(body.data.length).toBe(2);
      expect(body.data.some((f) => f.path === 'src/index.ts')).toBe(true);
    });

    it('should return empty array when no files', async () => {
      const cycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Test API',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/development/${cycle.id}/files`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: Array<unknown> };
      expect(body.data).toHaveLength(0);
    });

    it('should return 404 for non-existent cycle', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/development/non-existent/files',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ===========================================
  // POST /api/v1/development/:id/cancel - Cancel Cycle
  // ===========================================

  describe('POST /api/v1/development/:id/cancel', () => {
    it('should cancel a running cycle', async () => {
      const cycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Test API',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      // Update to a running phase
      await developmentCycleRepository.updatePhase(cycle.id, 'ANALYZING');

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/development/${cycle.id}/cancel`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { message: string };
      expect(body.message).toBe('Development cycle cancelled');

      // Verify cycle is now failed
      const updated = await developmentCycleRepository.getById(cycle.id);
      expect(updated?.phase).toBe('FAILED');
      expect(updated?.error).toContain('Cancelled');
    });

    it('should return 404 for non-existent cycle', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/development/non-existent/cancel',
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 400 for non-running cycle', async () => {
      const cycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Test API',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);
      await developmentCycleRepository.complete(cycle.id);

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/development/${cycle.id}/cancel`,
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ===========================================
  // DELETE /api/v1/development/:id - Delete Cycle
  // ===========================================

  describe('DELETE /api/v1/development/:id', () => {
    it('should delete a development cycle', async () => {
      const cycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Test API',
        requirementPriority: 'medium',
      });

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/development/${cycle.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { message: string };
      expect(body.message).toBe('Development cycle deleted successfully');

      // Verify cycle is deleted
      const deleted = await developmentCycleRepository.getById(cycle.id);
      expect(deleted).toBeNull();
    });

    it('should return 404 for non-existent cycle', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/development/non-existent',
      });

      expect(response.statusCode).toBe(404);
    });

    it('should delete associated files', async () => {
      const cycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Test API',
        requirementPriority: 'medium',
      });

      await generatedFileRepository.create({
        developmentCycleId: cycle.id,
        path: 'src/index.ts',
        content: 'test',
        language: 'typescript',
        purpose: 'Test',
        isNew: true,
      });

      await app.inject({
        method: 'DELETE',
        url: `/api/v1/development/${cycle.id}`,
      });

      // Verify files are deleted
      const files = await generatedFileRepository.getByDevelopmentCycle(cycle.id);
      expect(files).toHaveLength(0);
    });
  });

  // ===========================================
  // GET /api/v1/development/by-incident/:id
  // ===========================================

  describe('GET /api/v1/development/by-incident/:incidentId', () => {
    it('should return cycles triggered by incident', async () => {
      const incidentId = 'test-incident-123';

      const cycle1 = await developmentCycleRepository.create({
        requirementSource: 'incident',
        requirementRaw: 'Fix from incident',
        requirementPriority: 'high',
        triggeredByIncidentId: incidentId,
      });
      testCycleIds.push(cycle1.id);

      const cycle2 = await developmentCycleRepository.create({
        requirementSource: 'incident',
        requirementRaw: 'Another fix',
        requirementPriority: 'high',
        triggeredByIncidentId: incidentId,
      });
      testCycleIds.push(cycle2.id);

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/development/by-incident/${incidentId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: Array<{ triggeredByIncidentId: string }> };
      expect(body.data.length).toBe(2);
      expect(body.data.every((c) => c.triggeredByIncidentId === incidentId)).toBe(true);
    });

    it('should return empty array for incident with no cycles', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/development/by-incident/no-cycles-incident',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: Array<unknown> };
      expect(body.data).toHaveLength(0);
    });
  });

  // ===========================================
  // GET /api/v1/development/:id/analysis
  // ===========================================

  describe('GET /api/v1/development/:id/analysis', () => {
    it('should return requirement analysis', async () => {
      const cycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Test API requirement',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      await developmentCycleRepository.update(cycle.id, {
        analyzedRequirement: JSON.stringify({
          title: 'Task API',
          description: 'API for tasks',
          features: ['CRUD'],
        }),
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/development/${cycle.id}/analysis`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        data: {
          requirementRaw: string;
          analyzedRequirement: { title: string };
          source: string;
          priority: string;
        }
      };
      expect(body.data.requirementRaw).toBe('Test API requirement');
      expect(body.data.analyzedRequirement?.title).toBe('Task API');
      expect(body.data.source).toBe('user');
      expect(body.data.priority).toBe('medium');
    });

    it('should return 404 for non-existent cycle', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/development/non-existent/analysis',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ===========================================
  // GET /api/v1/development/:id/architecture
  // ===========================================

  describe('GET /api/v1/development/:id/architecture', () => {
    it('should return architecture design', async () => {
      const cycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Test API',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      await developmentCycleRepository.update(cycle.id, {
        architecture: JSON.stringify({
          overview: 'REST API architecture',
          components: [{ name: 'Controller', type: 'controller' }],
        }),
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/development/${cycle.id}/architecture`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: { overview: string; components: Array<{ name: string }> } };
      expect(body.data?.overview).toBe('REST API architecture');
      expect(body.data?.components).toHaveLength(1);
    });

    it('should return null when no architecture', async () => {
      const cycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Test API',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/development/${cycle.id}/architecture`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: unknown };
      expect(body.data).toBeNull();
    });
  });

  // ===========================================
  // GET /api/v1/development/:id/tests
  // ===========================================

  describe('GET /api/v1/development/:id/tests', () => {
    it('should return test results', async () => {
      const cycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Test API',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      await developmentCycleRepository.update(cycle.id, {
        testResults: JSON.stringify({
          passed: 10,
          failed: 0,
          coverage: 85.5,
        }),
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/development/${cycle.id}/tests`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: { passed: number; failed: number; coverage: number } };
      expect(body.data?.passed).toBe(10);
      expect(body.data?.coverage).toBe(85.5);
    });
  });

  // ===========================================
  // GET /api/v1/development/:id/build
  // ===========================================

  describe('GET /api/v1/development/:id/build', () => {
    it('should return build result', async () => {
      const cycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Test API',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      await developmentCycleRepository.update(cycle.id, {
        buildResult: JSON.stringify({
          success: true,
          imageTag: 'latest',
          duration: 45000,
        }),
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/development/${cycle.id}/build`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: { success: boolean; imageTag: string } };
      expect(body.data?.success).toBe(true);
      expect(body.data?.imageTag).toBe('latest');
    });
  });

  // ===========================================
  // GET /api/v1/development/:id/deployment
  // ===========================================

  describe('GET /api/v1/development/:id/deployment', () => {
    it('should return deployment details', async () => {
      const cycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Test API',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      await developmentCycleRepository.update(cycle.id, {
        deployment: JSON.stringify({
          deploymentName: 'test-app',
          namespace: 'development',
          serviceUrl: 'http://localhost:30001',
          replicas: 1,
        }),
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/development/${cycle.id}/deployment`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: { deploymentName: string; serviceUrl: string } };
      expect(body.data?.deploymentName).toBe('test-app');
      expect(body.data?.serviceUrl).toBe('http://localhost:30001');
    });
  });

  // ===========================================
  // GET /api/v1/development/:id/reasoning
  // ===========================================

  describe('GET /api/v1/development/:id/reasoning', () => {
    it('should return AI reasoning data', async () => {
      const cycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Test API',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      await developmentCycleRepository.update(cycle.id, {
        thoughtSignature: 'thought-sig-123',
        verification: JSON.stringify({
          healthy: true,
          checks: ['health', 'response time'],
        }),
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/development/${cycle.id}/reasoning`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: { thoughtSignature: string; verification: { healthy: boolean } } };
      expect(body.data.thoughtSignature).toBe('thought-sig-123');
      expect(body.data.verification?.healthy).toBe(true);
    });
  });
});

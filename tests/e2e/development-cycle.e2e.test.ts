/**
 * Development Cycle E2E Tests
 * End-to-end tests for the complete development OODA loop
 * Tests the full flow from requirement to deployment with mocked external services
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../setup.js';
import { DevelopmentOrchestrator, DevelopmentStateMachine } from '@chronosops/core';
import { GeminiClient } from '@chronosops/gemini';
import {
  initializeDatabase,
  closeDatabase,
  developmentCycleRepository,
  generatedFileRepository,
} from '@chronosops/database';
import {
  DEVELOPMENT_PHASES,
  type Requirement,
  type DevelopmentCycle,
  type DevelopmentPhase,
} from '@chronosops/shared';

// ===========================================
// Enhanced Gemini Mock Handlers for E2E
// ===========================================

const mockRequirementAnalysis = {
  candidates: [
    {
      content: {
        parts: [
          {
            text: JSON.stringify({
              title: 'Task Management API',
              description: 'A RESTful API for managing tasks with CRUD operations',
              features: [
                'Create new tasks',
                'List all tasks',
                'Get task by ID',
                'Update task status',
                'Delete tasks',
              ],
              estimatedComplexity: 'medium',
              requiredCapabilities: ['rest-api', 'json-validation', 'error-handling'],
            }),
          },
        ],
      },
    },
  ],
  usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 300, totalTokenCount: 800 },
};

const mockArchitectureDesign = {
  candidates: [
    {
      content: {
        parts: [
          {
            text: JSON.stringify({
              overview: 'Express.js REST API with in-memory storage',
              components: [
                {
                  name: 'TaskController',
                  type: 'controller',
                  responsibility: 'Handle HTTP requests',
                  interfaces: ['GET /tasks', 'POST /tasks', 'GET /tasks/:id', 'DELETE /tasks/:id'],
                  dependencies: ['TaskService'],
                },
                {
                  name: 'TaskService',
                  type: 'service',
                  responsibility: 'Business logic for task operations',
                  dependencies: [],
                },
              ],
              dataFlow: [
                { from: 'Client', to: 'TaskController', description: 'HTTP requests' },
                { from: 'TaskController', to: 'TaskService', description: 'Service calls' },
              ],
              securityConsiderations: ['Input validation with Zod', 'Proper error handling'],
              scalabilityApproach: 'Stateless design for horizontal scaling',
            }),
          },
        ],
      },
    },
  ],
  usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 500, totalTokenCount: 1300 },
};

const mockCodeGeneration = {
  candidates: [
    {
      content: {
        parts: [
          {
            text: JSON.stringify({
              files: [
                {
                  path: 'src/index.ts',
                  content: `import express, { Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';

const app = express();
app.use(express.json());

interface Task {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
}

const tasks: Task[] = [];

const CreateTaskSchema = z.object({
  title: z.string().min(1, 'Title is required'),
});

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.get('/tasks', (req: Request, res: Response) => {
  res.json(tasks);
});

app.post('/tasks', (req: Request, res: Response) => {
  try {
    const input = CreateTaskSchema.parse(req.body);
    const task: Task = {
      id: randomUUID(),
      title: input.title,
      completed: false,
      createdAt: new Date().toISOString(),
    };
    tasks.push(task);
    res.status(201).json(task);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/tasks/:id', (req: Request, res: Response) => {
  const task = tasks.find(t => t.id === req.params.id);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json(task);
});

app.delete('/tasks/:id', (req: Request, res: Response) => {
  const index = tasks.findIndex(t => t.id === req.params.id);
  if (index === -1) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  tasks.splice(index, 1);
  res.status(204).send();
});

export { app };
export function start() {
  const port = process.env.PORT || 8080;
  app.listen(port, () => {
    console.log(\\\`Server running on port \\\${port}\\\`);
  });
}`,
                  language: 'typescript',
                  purpose: 'Main application with Express server',
                },
                {
                  path: 'package.json',
                  content: JSON.stringify({
                    name: 'task-api',
                    version: '1.0.0',
                    type: 'module',
                    main: 'dist/index.js',
                    scripts: {
                      build: 'tsc',
                      start: 'node dist/index.js',
                      test: 'vitest run',
                    },
                    dependencies: {
                      express: '^4.18.2',
                      zod: '^3.23.0',
                    },
                    devDependencies: {
                      '@types/express': '^4.17.21',
                      typescript: '^5.3.0',
                      vitest: '^1.0.0',
                      supertest: '^6.3.0',
                    },
                  }, null, 2),
                  language: 'json',
                  purpose: 'Package configuration',
                },
                {
                  path: 'tsconfig.json',
                  content: JSON.stringify({
                    compilerOptions: {
                      target: 'ES2022',
                      module: 'NodeNext',
                      moduleResolution: 'NodeNext',
                      outDir: './dist',
                      strict: true,
                    },
                    include: ['src/**/*'],
                  }, null, 2),
                  language: 'json',
                  purpose: 'TypeScript config',
                },
              ],
              dependencies: ['express', 'zod'],
              explanation: 'Generated Task Management API with Express and Zod validation',
            }),
          },
        ],
      },
    },
  ],
  usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 1000, totalTokenCount: 2500 },
};

const mockTestGeneration = {
  candidates: [
    {
      content: {
        parts: [
          {
            text: JSON.stringify({
              tests: [
                {
                  path: 'src/index.test.ts',
                  content: `import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from './index';

describe('Task API', () => {
  it('should return health status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('should create a task', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({ title: 'Test Task' });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Test Task');
    expect(res.body.id).toBeDefined();
  });

  it('should list tasks', async () => {
    const res = await request(app).get('/tasks');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('should reject empty title', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({ title: '' });
    expect(res.status).toBe(400);
  });
});`,
                  language: 'typescript',
                  purpose: 'API integration tests',
                },
              ],
            }),
          },
        ],
      },
    },
  ],
  usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 400, totalTokenCount: 900 },
};

// ===========================================
// Test Setup
// ===========================================

describe('Development Cycle E2E', () => {
  beforeAll(async () => {
    // Initialize in-memory database
    await initializeDatabase(':memory:');

    // Add custom handlers for development-related Gemini calls
    server.use(
      // Requirement analysis
      http.post('*/models/gemini-3-flash-preview:generateContent', ({ request }) => {
        return HttpResponse.json(mockRequirementAnalysis);
      }),
      // Architecture design (Pro model)
      http.post('*/models/gemini-3-pro-preview:generateContent', async ({ request }) => {
        // Check request body to determine which response to send
        const body = await request.text();
        if (body.includes('architecture') || body.includes('design')) {
          return HttpResponse.json(mockArchitectureDesign);
        }
        if (body.includes('code') || body.includes('generate')) {
          return HttpResponse.json(mockCodeGeneration);
        }
        return HttpResponse.json(mockArchitectureDesign);
      })
    );
  });

  afterAll(async () => {
    await closeDatabase();
    server.resetHandlers();
  });

  // ===========================================
  // Integration: Full Cycle Tests
  // ===========================================

  describe('Full Development Cycle Integration', () => {
    let testCycleIds: string[] = [];

    afterEach(async () => {
      // Cleanup test data
      for (const id of testCycleIds) {
        try {
          await developmentCycleRepository.delete(id);
        } catch {
          // Ignore
        }
      }
      testCycleIds = [];
    });

    it('should create and track development cycle through database', async () => {
      // Create cycle in database
      const cycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Create a REST API for task management',
        requirementPriority: 'medium',
        serviceType: 'backend',
      });
      testCycleIds.push(cycle.id);

      // Verify initial state
      expect(cycle.phase).toBe('IDLE');
      expect(cycle.iterations).toBe(0);
      expect(cycle.serviceType).toBe('backend');

      // Simulate phase transitions
      await developmentCycleRepository.updatePhase(cycle.id, 'ANALYZING');
      let updated = await developmentCycleRepository.getById(cycle.id);
      expect(updated?.phase).toBe('ANALYZING');

      await developmentCycleRepository.updatePhase(cycle.id, 'DESIGNING');
      updated = await developmentCycleRepository.getById(cycle.id);
      expect(updated?.phase).toBe('DESIGNING');

      // Update with analysis results
      await developmentCycleRepository.update(cycle.id, {
        analyzedRequirement: JSON.stringify({
          title: 'Task API',
          features: ['CRUD operations'],
        }),
      });
      updated = await developmentCycleRepository.getById(cycle.id);
      expect(updated?.analyzedRequirement).toBeDefined();
    });

    it('should track iterations during retry', async () => {
      const cycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Test retry',
        requirementPriority: 'medium',
        maxIterations: 5,
      });
      testCycleIds.push(cycle.id);

      // Simulate retries
      for (let i = 0; i < 3; i++) {
        await developmentCycleRepository.incrementIterations(cycle.id);
      }

      const updated = await developmentCycleRepository.getById(cycle.id);
      expect(updated?.iterations).toBe(3);
    });

    it('should store generated files', async () => {
      const cycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Test files',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      // Store generated files
      await generatedFileRepository.create({
        developmentCycleId: cycle.id,
        path: 'src/index.ts',
        content: 'const app = express();',
        language: 'typescript',
        purpose: 'Main entry point',
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

      // Retrieve files
      const files = await generatedFileRepository.getByDevelopmentCycle(cycle.id);
      expect(files).toHaveLength(2);
      expect(files.some((f) => f.path === 'src/index.ts')).toBe(true);
    });

    it('should complete cycle with all artifacts', async () => {
      const cycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Complete cycle test',
        requirementPriority: 'high',
      });
      testCycleIds.push(cycle.id);

      // Simulate full cycle
      await developmentCycleRepository.updatePhase(cycle.id, 'ANALYZING');
      await developmentCycleRepository.update(cycle.id, {
        analyzedRequirement: JSON.stringify({
          title: 'Test API',
          description: 'Test API description',
        }),
      });

      await developmentCycleRepository.updatePhase(cycle.id, 'DESIGNING');
      await developmentCycleRepository.update(cycle.id, {
        architecture: JSON.stringify({
          overview: 'REST API',
          components: [],
        }),
      });

      await developmentCycleRepository.updatePhase(cycle.id, 'CODING');
      await developmentCycleRepository.update(cycle.id, {
        generatedCodeSummary: JSON.stringify({
          fileCount: 3,
          languages: ['typescript', 'json'],
        }),
      });

      await developmentCycleRepository.updatePhase(cycle.id, 'TESTING');
      await developmentCycleRepository.update(cycle.id, {
        testResults: JSON.stringify({
          passed: 5,
          failed: 0,
          coverage: 90,
        }),
      });

      await developmentCycleRepository.updatePhase(cycle.id, 'BUILDING');
      await developmentCycleRepository.update(cycle.id, {
        buildResult: JSON.stringify({
          success: true,
          imageTag: 'latest',
        }),
      });

      await developmentCycleRepository.updatePhase(cycle.id, 'DEPLOYING');
      await developmentCycleRepository.update(cycle.id, {
        deployment: JSON.stringify({
          name: 'test-api',
          namespace: 'development',
          serviceUrl: 'http://localhost:30001',
        }),
      });

      await developmentCycleRepository.updatePhase(cycle.id, 'VERIFYING');
      await developmentCycleRepository.complete(cycle.id, JSON.stringify({
        healthy: true,
        checks: ['health endpoint', 'response time'],
      }));

      // Verify final state
      const completed = await developmentCycleRepository.getById(cycle.id);
      expect(completed?.phase).toBe('COMPLETED');
      expect(completed?.completedAt).toBeDefined();
      expect(completed?.verification).toBeDefined();
    });

    it('should handle failed cycle correctly', async () => {
      const cycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Failure test',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      await developmentCycleRepository.updatePhase(cycle.id, 'ANALYZING');
      await developmentCycleRepository.updatePhase(cycle.id, 'DESIGNING');
      await developmentCycleRepository.updatePhase(cycle.id, 'CODING');

      // Simulate failure
      await developmentCycleRepository.fail(
        cycle.id,
        'Build failed: TypeScript compilation errors'
      );

      const failed = await developmentCycleRepository.getById(cycle.id);
      expect(failed?.phase).toBe('FAILED');
      expect(failed?.error).toContain('TypeScript');
      expect(failed?.completedAt).toBeDefined();
    });
  });

  // ===========================================
  // State Machine E2E Tests
  // ===========================================

  describe('State Machine E2E', () => {
    it('should complete full state machine cycle with events', async () => {
      const stateMachine = new DevelopmentStateMachine({
        phaseTimeouts: {
          analyzing: 60000,
          designing: 60000,
          coding: 60000,
          testing: 60000,
          building: 60000,
          deploying: 60000,
          verifying: 60000,
        },
      });

      const events: string[] = [];
      const phases: DevelopmentPhase[] = [];

      stateMachine.on('phase:changed', ({ from, to }) => {
        events.push(`changed:${from}->${to}`);
        phases.push(to);
      });

      stateMachine.on('cycle:completed', () => {
        events.push('completed');
      });

      const cycle: DevelopmentCycle = {
        id: 'e2e-test-cycle',
        phase: DEVELOPMENT_PHASES.IDLE,
        serviceType: 'backend',
        requirement: {
          id: 'req-e2e',
          rawText: 'E2E test requirement',
          source: 'user',
          priority: 'medium',
          createdAt: new Date().toISOString(),
        },
        iterations: 0,
        maxIterations: 5,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Start cycle
      await stateMachine.start(cycle);
      expect(stateMachine.getPhase()).toBe(DEVELOPMENT_PHASES.ANALYZING);

      // Progress through phases
      await stateMachine.transition(DEVELOPMENT_PHASES.DESIGNING);
      await stateMachine.transition(DEVELOPMENT_PHASES.CODING);
      await stateMachine.transition(DEVELOPMENT_PHASES.TESTING);
      await stateMachine.transition(DEVELOPMENT_PHASES.BUILDING);
      await stateMachine.transition(DEVELOPMENT_PHASES.DEPLOYING);
      await stateMachine.transition(DEVELOPMENT_PHASES.VERIFYING);
      await stateMachine.transition(DEVELOPMENT_PHASES.COMPLETED);

      // Verify all phases were traversed
      expect(phases).toContain(DEVELOPMENT_PHASES.ANALYZING);
      expect(phases).toContain(DEVELOPMENT_PHASES.DESIGNING);
      expect(phases).toContain(DEVELOPMENT_PHASES.CODING);
      expect(phases).toContain(DEVELOPMENT_PHASES.TESTING);
      expect(phases).toContain(DEVELOPMENT_PHASES.BUILDING);
      expect(phases).toContain(DEVELOPMENT_PHASES.DEPLOYING);
      expect(phases).toContain(DEVELOPMENT_PHASES.VERIFYING);
      expect(phases).toContain(DEVELOPMENT_PHASES.COMPLETED);

      expect(events).toContain('completed');
      expect(stateMachine.isActive()).toBe(false);

      stateMachine.reset();
    });

    it('should handle retry flow correctly', async () => {
      const stateMachine = new DevelopmentStateMachine();

      const cycle: DevelopmentCycle = {
        id: 'retry-test-cycle',
        phase: DEVELOPMENT_PHASES.IDLE,
        serviceType: 'backend',
        requirement: {
          id: 'req-retry',
          rawText: 'Retry test',
          source: 'user',
          priority: 'medium',
          createdAt: new Date().toISOString(),
        },
        iterations: 0,
        maxIterations: 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await stateMachine.start(cycle);
      await stateMachine.transition(DEVELOPMENT_PHASES.DESIGNING);
      await stateMachine.transition(DEVELOPMENT_PHASES.CODING);
      await stateMachine.transition(DEVELOPMENT_PHASES.TESTING);

      // Simulate test failure and retry
      expect(stateMachine.incrementIteration()).toBe(true);
      await stateMachine.transition(DEVELOPMENT_PHASES.CODING);
      expect(stateMachine.getCycle()?.iterations).toBe(1);

      // Continue to success
      await stateMachine.transition(DEVELOPMENT_PHASES.TESTING);
      await stateMachine.transition(DEVELOPMENT_PHASES.BUILDING);
      await stateMachine.transition(DEVELOPMENT_PHASES.DEPLOYING);
      await stateMachine.transition(DEVELOPMENT_PHASES.VERIFYING);
      await stateMachine.transition(DEVELOPMENT_PHASES.COMPLETED);

      expect(stateMachine.getPhase()).toBe(DEVELOPMENT_PHASES.COMPLETED);

      stateMachine.reset();
    });

    it('should fail when max iterations exceeded', async () => {
      const stateMachine = new DevelopmentStateMachine();

      const cycle: DevelopmentCycle = {
        id: 'max-iter-test',
        phase: DEVELOPMENT_PHASES.IDLE,
        serviceType: 'backend',
        requirement: {
          id: 'req-max',
          rawText: 'Max iterations test',
          source: 'user',
          priority: 'medium',
          createdAt: new Date().toISOString(),
        },
        iterations: 2, // Already at 2
        maxIterations: 2, // Max is 2
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await stateMachine.start(cycle);
      await stateMachine.transition(DEVELOPMENT_PHASES.DESIGNING);
      await stateMachine.transition(DEVELOPMENT_PHASES.CODING);
      await stateMachine.transition(DEVELOPMENT_PHASES.TESTING);

      // Should not allow another retry
      expect(stateMachine.incrementIteration()).toBe(false);

      stateMachine.reset();
    });
  });

  // ===========================================
  // Multi-Service Tests
  // ===========================================

  describe('Multi-Service Development', () => {
    let testCycleIds: string[] = [];

    afterEach(async () => {
      for (const id of testCycleIds) {
        try {
          await developmentCycleRepository.delete(id);
        } catch {
          // Ignore
        }
      }
      testCycleIds = [];
    });

    it('should support frontend service type', async () => {
      const cycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Create a React dashboard',
        requirementPriority: 'medium',
        serviceType: 'frontend',
        frontendConfig: JSON.stringify({
          framework: 'react',
          bundler: 'vite',
          styling: 'tailwind',
          stateManagement: 'tanstack-query',
          consumesServices: [],
        }),
      });
      testCycleIds.push(cycle.id);

      expect(cycle.serviceType).toBe('frontend');
      expect(cycle.frontendConfig).toBeDefined();

      const config = JSON.parse(cycle.frontendConfig!);
      expect(config.framework).toBe('react');
    });

    it('should support fullstack service type', async () => {
      const cycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Create a full stack task app',
        requirementPriority: 'high',
        serviceType: 'fullstack',
        frontendConfig: JSON.stringify({
          framework: 'react',
          bundler: 'vite',
          styling: 'tailwind',
          stateManagement: 'zustand',
          consumesServices: [],
        }),
      });
      testCycleIds.push(cycle.id);

      expect(cycle.serviceType).toBe('fullstack');
    });

    it('should track service dependencies', async () => {
      // Create backend service first
      const backendCycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Create task API backend',
        requirementPriority: 'high',
        serviceType: 'backend',
      });
      testCycleIds.push(backendCycle.id);

      // Update backend with deployment info
      await developmentCycleRepository.update(backendCycle.id, {
        deployment: JSON.stringify({
          name: 'task-api',
          serviceUrl: 'http://task-api:8080',
        }),
      });

      // Create frontend that consumes backend
      const frontendCycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Create task dashboard frontend',
        requirementPriority: 'high',
        serviceType: 'frontend',
        frontendConfig: JSON.stringify({
          framework: 'react',
          bundler: 'vite',
          styling: 'tailwind',
          stateManagement: 'tanstack-query',
          consumesServices: [backendCycle.id],
        }),
      });
      testCycleIds.push(frontendCycle.id);

      const config = JSON.parse(frontendCycle.frontendConfig!);
      expect(config.consumesServices).toContain(backendCycle.id);
    });
  });

  // ===========================================
  // Incident-Triggered Development Tests
  // ===========================================

  describe('Incident-Triggered Development', () => {
    let testCycleIds: string[] = [];

    afterEach(async () => {
      for (const id of testCycleIds) {
        try {
          await developmentCycleRepository.delete(id);
        } catch {
          // Ignore
        }
      }
      testCycleIds = [];
    });

    it('should link cycle to incident', async () => {
      const incidentId = 'incident-123';

      const cycle = await developmentCycleRepository.create({
        requirementSource: 'incident',
        requirementRaw: 'Fix memory leak in user service',
        requirementPriority: 'critical',
        triggeredByIncidentId: incidentId,
      });
      testCycleIds.push(cycle.id);

      expect(cycle.requirementSource).toBe('incident');
      expect(cycle.triggeredByIncidentId).toBe(incidentId);
      expect(cycle.requirementPriority).toBe('critical');
    });

    it('should retrieve cycles by incident', async () => {
      const incidentId = 'incident-456';

      // Create multiple cycles for same incident
      const cycle1 = await developmentCycleRepository.create({
        requirementSource: 'incident',
        requirementRaw: 'First fix attempt',
        requirementPriority: 'high',
        triggeredByIncidentId: incidentId,
      });
      testCycleIds.push(cycle1.id);

      const cycle2 = await developmentCycleRepository.create({
        requirementSource: 'incident',
        requirementRaw: 'Second fix attempt after rollback',
        requirementPriority: 'high',
        triggeredByIncidentId: incidentId,
      });
      testCycleIds.push(cycle2.id);

      // Retrieve by incident
      const incidentCycles = await developmentCycleRepository.getByIncident(incidentId);

      expect(incidentCycles).toHaveLength(2);
      expect(incidentCycles.every((c) => c.triggeredByIncidentId === incidentId)).toBe(true);
    });
  });

  // ===========================================
  // Error Recovery Tests
  // ===========================================

  describe('Error Recovery', () => {
    let testCycleIds: string[] = [];

    afterEach(async () => {
      for (const id of testCycleIds) {
        try {
          await developmentCycleRepository.delete(id);
        } catch {
          // Ignore
        }
      }
      testCycleIds = [];
    });

    it('should track error details on failure', async () => {
      const cycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Error tracking test',
        requirementPriority: 'medium',
      });
      testCycleIds.push(cycle.id);

      // Progress to coding phase
      await developmentCycleRepository.updatePhase(cycle.id, 'ANALYZING');
      await developmentCycleRepository.updatePhase(cycle.id, 'DESIGNING');
      await developmentCycleRepository.updatePhase(cycle.id, 'CODING');

      // Fail with detailed error
      await developmentCycleRepository.update(cycle.id, {
        phase: 'FAILED' as DevelopmentPhase,
        error: JSON.stringify({
          phase: 'CODING',
          message: 'Code generation failed',
          details: {
            errors: [
              { file: 'src/index.ts', line: 10, message: 'Cannot find module' },
            ],
          },
        }),
        completedAt: new Date(),
      });

      const failed = await developmentCycleRepository.getById(cycle.id);
      expect(failed?.phase).toBe('FAILED');
      expect(failed?.error).toBeDefined();

      const errorDetails = JSON.parse(failed!.error!);
      expect(errorDetails.phase).toBe('CODING');
      expect(errorDetails.details.errors).toHaveLength(1);
    });

    it('should support recovery from specific phase', async () => {
      const cycle = await developmentCycleRepository.create({
        requirementSource: 'user',
        requirementRaw: 'Recovery test',
        requirementPriority: 'medium',
        maxIterations: 5,
      });
      testCycleIds.push(cycle.id);

      // Simulate progress then failure
      await developmentCycleRepository.updatePhase(cycle.id, 'ANALYZING');
      await developmentCycleRepository.updatePhase(cycle.id, 'DESIGNING');
      await developmentCycleRepository.updatePhase(cycle.id, 'CODING');
      await developmentCycleRepository.updatePhase(cycle.id, 'TESTING');

      // Test failure - retry from CODING
      await developmentCycleRepository.incrementIterations(cycle.id);
      await developmentCycleRepository.update(cycle.id, {
        error: 'Tests failed: 3 assertions failed',
      });
      await developmentCycleRepository.updatePhase(cycle.id, 'CODING');

      const recovered = await developmentCycleRepository.getById(cycle.id);
      expect(recovered?.phase).toBe('CODING');
      expect(recovered?.iterations).toBe(1);

      // Clear error and continue
      await developmentCycleRepository.update(cycle.id, { error: null });
      await developmentCycleRepository.updatePhase(cycle.id, 'TESTING');
      await developmentCycleRepository.updatePhase(cycle.id, 'BUILDING');

      const progressed = await developmentCycleRepository.getById(cycle.id);
      expect(progressed?.phase).toBe('BUILDING');
      expect(progressed?.error).toBeNull();
    });
  });
});

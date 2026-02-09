/**
 * Development API Routes
 * Endpoints for managing development cycles (self-regenerating app ecosystem)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  developmentCycleRepository,
  generatedFileRepository,
  serviceRegistryRepository,
  gitRepositoryRepository,
  editLockRepository,
  fileVersionRepository,
  codeEvolutionRepository,
  incidentRepository,
  monitoredAppRepository,
  evidenceRepository,
  hypothesisRepository,
  actionRepository,
  thoughtStateRepository,
  timelineRepository,
  postmortemRepository,
  learnedPatternRepository,
  reconstructedIncidentRepository,
} from '@chronosops/database';
import type { FileLanguage } from '@chronosops/database';
import type { DevelopmentPhase, Requirement } from '@chronosops/shared';
import { createChildLogger, getConfig } from '@chronosops/shared';
import { BuildOrchestrator, ImageBuilder } from '@chronosops/core';
import { GeminiClient } from '@chronosops/gemini';
import { GitService } from '@chronosops/git';
import {
  broadcastDevelopmentPhaseChange,
  broadcastDevelopmentComplete,
  broadcastDevelopmentFailed,
  broadcastDevelopmentDeleted,
} from '../websocket/index.js';

const logger = createChildLogger({ component: 'DevelopmentAPI' });

// Track active development cycles by ID
const activeDevelopmentCycles = new Map<string, { startedAt: Date; phase: string }>();

// Track active orchestrators for cancellation support
// Import type for orchestrator from core package
import type { DevelopmentOrchestrator } from '@chronosops/core';
const activeOrchestrators = new Map<string, DevelopmentOrchestrator>();

// Max rebuild retries with code fixes
const MAX_REBUILD_FIX_RETRIES = 3;

/**
 * Extract TypeScript/build errors from error message for code fixing
 */
function extractBuildErrors(errorMessage: string): Array<{ file: string; line: number; message: string }> {
  const errors: Array<{ file: string; line: number; message: string }> = [];
  
  // Parse TypeScript error format: file(line,col): error TSxxxx: message
  const tsErrorRegex = /([^(\s]+)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+?)(?=\n|$)/g;
  let match;
  
  while ((match = tsErrorRegex.exec(errorMessage)) !== null) {
    const file = match[1] || '';
    const line = match[2] || '0';
    const code = match[4] || '';
    const message = match[5] || '';
    if (file && line) {
      errors.push({ file, line: parseInt(line), message: `${code}: ${message}` });
    }
  }
  
  // Also try simpler format: file:line:col - message
  const simpleRegex = /([^:\s]+):(\d+):\d+\s*-?\s*(.+?)(?=\n|$)/g;
  while ((match = simpleRegex.exec(errorMessage)) !== null) {
    const file = match[1] || '';
    const line = match[2] || '0';
    const message = match[3] || '';
    if (file && line && !errors.some(e => e.file === file && e.line === parseInt(line))) {
      errors.push({ file, line: parseInt(line), message });
    }
  }
  
  return errors;
}

/**
 * Fix code files using Gemini based on build errors
 */
async function fixCodeWithGemini(
  files: Array<{ id: string; path: string; content: string; language: FileLanguage }>,
  buildErrors: Array<{ file: string; line: number; message: string }>,
  geminiClient: GeminiClient
): Promise<Array<{ id: string; path: string; content: string; language: FileLanguage; fixed: boolean }>> {
  const results: Array<{ id: string; path: string; content: string; language: FileLanguage; fixed: boolean }> = [];
  
  // Group errors by file
  const errorsByFile = new Map<string, Array<{ line: number; message: string }>>();
  for (const error of buildErrors) {
    // Normalize file path (remove src/ prefix if present in error but not in file)
    const normalizedPath = error.file.replace(/^src\//, '');
    const existing = errorsByFile.get(normalizedPath) || [];
    existing.push({ line: error.line, message: error.message });
    errorsByFile.set(normalizedPath, existing);
  }
  
  for (const file of files) {
    const normalizedFilePath = file.path.replace(/^src\//, '');
    const fileErrors = errorsByFile.get(normalizedFilePath) || 
                       errorsByFile.get(file.path) ||
                       errorsByFile.get(`src/${normalizedFilePath}`);
    
    if (!fileErrors || fileErrors.length === 0) {
      results.push({ id: file.id, path: file.path, content: file.content, language: file.language, fixed: false });
      continue;
    }
    
    logger.info({ file: file.path, errorCount: fileErrors.length }, 'Fixing file with Gemini');
    
    const errorDescription = fileErrors
      .map(e => `Line ${e.line}: ${e.message}`)
      .join('\n');
    
    try {
      const fixResult = await geminiClient.fixCode({
        code: file.content,
        errors: errorDescription,
        language: file.language === 'javascript' ? 'javascript' : 'typescript',
        context: `File: ${file.path}`,
      });
      
      if (fixResult.success && fixResult.data?.fixedCode) {
        logger.info({ file: file.path }, 'File fixed successfully');
        results.push({ 
          id: file.id, 
          path: file.path, 
          content: fixResult.data.fixedCode, 
          language: file.language,
          fixed: true 
        });
      } else {
        logger.warn({ file: file.path, error: fixResult.error }, 'Failed to fix file');
        results.push({ id: file.id, path: file.path, content: file.content, language: file.language, fixed: false });
      }
    } catch (error) {
      logger.error({ file: file.path, error }, 'Error fixing file');
      results.push({ id: file.id, path: file.path, content: file.content, language: file.language, fixed: false });
    }
  }
  
  return results;
}

/**
 * Safely parse JSON string, returning null if invalid
 */
function safeJsonParse<T>(json: string | null): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/**
 * Parse all JSON fields in a development cycle record for API response
 */
function parseJsonFields<T extends {
  analyzedRequirement: string | null;
  architecture: string | null;
  generatedCodeSummary: string | null;
  testResults: string | null;
  buildResult: string | null;
  deployment: string | null;
  verification: string | null;
  error: string | null;
  frontendConfig?: string | null;
}>(cycle: T) {
  return {
    ...cycle,
    analyzedRequirement: safeJsonParse(cycle.analyzedRequirement),
    architecture: safeJsonParse(cycle.architecture),
    generatedCodeSummary: safeJsonParse(cycle.generatedCodeSummary),
    testResults: safeJsonParse(cycle.testResults),
    buildResult: safeJsonParse(cycle.buildResult),
    deployment: safeJsonParse(cycle.deployment),
    verification: safeJsonParse(cycle.verification),
    frontendConfig: cycle.frontendConfig ? safeJsonParse(cycle.frontendConfig) : null,
    // error is a plain string, not JSON - don't parse it
    error: cycle.error,
  };
}

// Request schemas
const createDevelopmentCycleSchema = z.object({
  requirement: z.string().min(1, 'Requirement description is required'),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  source: z.enum(['user', 'incident', 'improvement', 'pattern']).default('user'),
  triggeredByIncidentId: z.string().optional(),
  maxIterations: z.coerce.number().min(1).max(10).default(5),
  serviceType: z.enum(['backend', 'frontend', 'fullstack']).default('backend'),
  // Storage mode for database persistence
  storageMode: z.enum(['memory', 'sqlite', 'postgres']).default('memory'),
  frontendConfig: z.object({
    framework: z.enum(['react', 'vue']).default('react'),
    bundler: z.enum(['vite', 'webpack']).default('vite'),
    consumesServices: z.array(z.string()).default([]),
    styling: z.enum(['tailwind', 'css-modules', 'styled-components']).default('tailwind'),
    stateManagement: z.enum(['tanstack-query', 'zustand', 'redux']).default('tanstack-query'),
  }).optional(),
});

const listDevelopmentCyclesSchema = z.object({
  phase: z.string().optional(),
  source: z.enum(['user', 'incident', 'improvement', 'pattern']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  isActive: z.coerce.boolean().optional(),
  triggeredByIncidentId: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

export async function developmentRoutes(app: FastifyInstance): Promise<void> {
  // List development cycles
  app.get('/', async (request: FastifyRequest, _reply: FastifyReply) => {
    const query = listDevelopmentCyclesSchema.parse(request.query);

    const cycles = await developmentCycleRepository.list(
      {
        phase: query.phase as DevelopmentPhase | undefined,
        requirementSource: query.source,
        requirementPriority: query.priority,
        isActive: query.isActive,
        triggeredByIncidentId: query.triggeredByIncidentId,
      },
      query.limit,
      query.offset
    );

    // Enrich with active status
    const enrichedCycles = cycles.map((cycle) => ({
      ...cycle,
      isRunning: activeDevelopmentCycles.has(cycle.id),
      runStatus: activeDevelopmentCycles.get(cycle.id) ?? null,
    }));

    return { data: enrichedCycles };
  });

  // Get active development cycles
  app.get('/active', async (_request: FastifyRequest, _reply: FastifyReply) => {
    const cycles = await developmentCycleRepository.getActive();

    const enrichedCycles = cycles.map((cycle) => ({
      ...cycle,
      isRunning: activeDevelopmentCycles.has(cycle.id),
      runStatus: activeDevelopmentCycles.get(cycle.id) ?? null,
    }));

    return { data: enrichedCycles };
  });

  // Get development cycle by ID with full artifact details
  app.get(
    '/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      const cycle = await developmentCycleRepository.getById(id);

      if (!cycle) {
        return reply.status(404).send({ error: 'Development cycle not found' });
      }

      // Get generated files for this cycle
      const files = await generatedFileRepository.getByDevelopmentCycle(id);

      // Include run status if active
      const runStatus = activeDevelopmentCycles.get(id);

      // Parse all JSON fields for frontend consumption
      const parsedCycle = parseJsonFields(cycle);

      return {
        data: {
          ...parsedCycle,
          files,
          isRunning: !!runStatus,
          runStatus: runStatus ?? null,
        },
      };
    }
  );

  // Get requirement analysis for a development cycle
  app.get(
    '/:id/analysis',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const cycle = await developmentCycleRepository.getById(id);

      if (!cycle) {
        return reply.status(404).send({ error: 'Development cycle not found' });
      }

      return {
        data: {
          requirementRaw: cycle.requirementRaw,
          analyzedRequirement: safeJsonParse(cycle.analyzedRequirement),
          source: cycle.requirementSource,
          priority: cycle.requirementPriority,
        },
      };
    }
  );

  // Get architecture design for a development cycle
  app.get(
    '/:id/architecture',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const cycle = await developmentCycleRepository.getById(id);

      if (!cycle) {
        return reply.status(404).send({ error: 'Development cycle not found' });
      }

      return {
        data: safeJsonParse(cycle.architecture),
        architectureDiagramUrl: cycle.architectureDiagramUrl ?? null,
      };
    }
  );

  // Get test results for a development cycle
  app.get(
    '/:id/tests',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const cycle = await developmentCycleRepository.getById(id);

      if (!cycle) {
        return reply.status(404).send({ error: 'Development cycle not found' });
      }

      return {
        data: safeJsonParse(cycle.testResults),
      };
    }
  );

  // Get build result for a development cycle
  app.get(
    '/:id/build',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const cycle = await developmentCycleRepository.getById(id);

      if (!cycle) {
        return reply.status(404).send({ error: 'Development cycle not found' });
      }

      return {
        data: safeJsonParse(cycle.buildResult),
      };
    }
  );

  // Get deployment details for a development cycle
  app.get(
    '/:id/deployment',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const cycle = await developmentCycleRepository.getById(id);

      if (!cycle) {
        return reply.status(404).send({ error: 'Development cycle not found' });
      }

      return {
        data: safeJsonParse(cycle.deployment),
      };
    }
  );

  // Get AI reasoning/thinking for a development cycle
  app.get(
    '/:id/reasoning',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const cycle = await developmentCycleRepository.getById(id);

      if (!cycle) {
        return reply.status(404).send({ error: 'Development cycle not found' });
      }

      return {
        data: {
          thoughtSignature: cycle.thoughtSignature,
          verification: safeJsonParse(cycle.verification),
        },
      };
    }
  );

  // Proxy health check to deployed app (avoids CORS issues)
  // Also fetches live K8s deployment status
  app.post(
    '/:id/health-check',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const cycle = await developmentCycleRepository.getById(id);

      if (!cycle) {
        return reply.status(404).send({ error: 'Development cycle not found' });
      }

      const deployment = safeJsonParse<{
        serviceUrl?: string;
        deploymentName?: string;
        namespace?: string;
      }>(cycle.deployment);
      if (!deployment?.serviceUrl) {
        return reply.status(400).send({ error: 'No deployment URL available' });
      }

      // Fetch live K8s deployment status if available
      let liveStatus: { replicas: number; availableReplicas: number; podStatus: string } | null = null;
      if (deployment.deploymentName && deployment.namespace && app.services.k8sClient) {
        try {
          const deploymentInfo = await app.services.k8sClient.getDeployment(
            deployment.deploymentName,
            deployment.namespace
          );
          if (deploymentInfo) {
            liveStatus = {
              replicas: deploymentInfo.replicas,
              availableReplicas: deploymentInfo.availableReplicas,
              podStatus: deploymentInfo.status === 'available' ? 'Running' :
                         deploymentInfo.status === 'progressing' ? 'Pending' : 'Failed',
            };
          }
        } catch (err) {
          logger.warn({ err, deployment: deployment.deploymentName }, 'Failed to fetch live K8s status');
        }
      }

      // If serviceUrl is a relative proxy path (e.g. /apps/<name>/), the backend
      // must use the internal K8s ClusterIP DNS to reach the service instead.
      // Node.js fetch cannot use relative URLs.
      const serviceUrl = deployment.serviceUrl!;
      const proxyMatch = serviceUrl.match(/^\/apps\/([^/]+)/);
      let healthUrl: string;
      if (proxyMatch) {
        const svcName = proxyMatch[1];
        const ns = deployment.namespace || process.env.DEV_NAMESPACE || 'development';
        healthUrl = `http://${svcName}.${ns}.svc.cluster.local:80/health`;
      } else {
        healthUrl = `${serviceUrl.replace(/\/$/, '')}/health`;
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(healthUrl, {
          method: 'GET',
          signal: controller.signal,
        });
        clearTimeout(timeout);

        const data = await response.json().catch(() => null) as { status?: string } | null;

        return {
          data: {
            success: response.ok,
            status: response.status,
            message: response.ok
              ? data?.status === 'ok'
                ? 'Healthy'
                : `Status ${response.status}`
              : `Error ${response.status}`,
            response: data,
            endpoint: healthUrl,
            timestamp: new Date().toISOString(),
            liveStatus,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Connection failed';
        return {
          data: {
            success: false,
            status: 0,
            message: errorMessage.includes('abort') ? 'Timeout' : 'Connection failed',
            endpoint: healthUrl,
            timestamp: new Date().toISOString(),
            liveStatus,
          },
        };
      }
    }
  );

  // Create and start a new development cycle
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createDevelopmentCycleSchema.parse(request.body);

    // Create the cycle record in database
    const cycle = await developmentCycleRepository.create({
      requirementSource: body.source,
      requirementRaw: body.requirement,
      requirementPriority: body.priority,
      triggeredByIncidentId: body.triggeredByIncidentId,
      maxIterations: body.maxIterations,
      serviceType: body.serviceType,
      storageMode: body.storageMode,
      frontendConfig: body.frontendConfig ? JSON.stringify(body.frontendConfig) : undefined,
    });

    logger.info({ cycleId: cycle.id, serviceType: body.serviceType, storageMode: body.storageMode }, 'Development cycle created');

    return reply.status(201).send({ data: cycle });
  });

  // Start development cycle (execute the OODA loop)
  app.post(
    '/:id/start',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      // Check if cycle is already running
      if (activeDevelopmentCycles.has(id)) {
        return reply.status(409).send({
          error: 'Development cycle already in progress',
          runStatus: activeDevelopmentCycles.get(id),
        });
      }

      const cycle = await developmentCycleRepository.getById(id);

      if (!cycle) {
        return reply.status(404).send({ error: 'Development cycle not found' });
      }

      // Check if cycle is already completed or failed
      if (cycle.phase === 'COMPLETED' || cycle.phase === 'FAILED') {
        return reply.status(400).send({
          error: `Development cycle is already ${cycle.phase.toLowerCase()}`,
        });
      }

      // Create orchestrator
      const orchestrator = await app.services.createDevelopmentOrchestrator();

      // Track development status and orchestrator reference for cancellation
      activeDevelopmentCycles.set(id, { startedAt: new Date(), phase: 'ANALYZING' });
      activeOrchestrators.set(id, orchestrator);

      // Build requirement object
      const requirement: Requirement = {
        id: cycle.id,
        rawText: cycle.requirementRaw,
        source: cycle.requirementSource,
        priority: cycle.requirementPriority,
        createdAt: cycle.createdAt.toISOString(),
      };

      // Listen for phase changes
      orchestrator.on('phase:changed', async ({ phase, cycle: devCycle }) => {
        const status = activeDevelopmentCycles.get(id);
        if (status) {
          status.phase = phase;
        }

        // Update database with full artifact data
        await developmentCycleRepository.update(id, {
          phase,
          analyzedRequirement: devCycle.analyzedRequirement
            ? JSON.stringify(devCycle.analyzedRequirement)
            : undefined,
          architecture: devCycle.architecture
            ? JSON.stringify(devCycle.architecture)
            : undefined,
          generatedCodeSummary: devCycle.generatedCode
            ? JSON.stringify({
                totalFiles: devCycle.generatedCode.files.length,
                entryPoint: devCycle.generatedCode.entryPoint ?? 'src/index.ts',
                byLanguage: devCycle.generatedCode.files.reduce(
                  (acc: Record<string, number>, f: { language: string }) => {
                    acc[f.language] = (acc[f.language] ?? 0) + 1;
                    return acc;
                  },
                  {} as Record<string, number>
                ),
              })
            : undefined,
          testResults: devCycle.testResults
            ? JSON.stringify(devCycle.testResults)
            : undefined,
          buildResult: devCycle.buildResult
            ? JSON.stringify(devCycle.buildResult)
            : undefined,
          deployment: devCycle.deployment
            ? JSON.stringify(devCycle.deployment)
            : undefined,
          thoughtSignature: devCycle.thoughtSignature ?? undefined,
          iterations: devCycle.iterations,
        });

        // Broadcast via WebSocket
        broadcastDevelopmentPhaseChange(id, phase, {
          phase,
          cycleId: devCycle.id,
          iterations: devCycle.iterations,
        });

        logger.info({ cycleId: id, phase }, 'Development phase changed');
      });

      // Listen for cycle completion
      orchestrator.on('development:completed', async ({ cycle: devCycle, duration }) => {
        activeDevelopmentCycles.delete(id);
        activeOrchestrators.delete(id);

        // Update database with final artifact data including deployment
        await developmentCycleRepository.update(id, {
          phase: 'COMPLETED',
          deployment: devCycle.deployment
            ? JSON.stringify(devCycle.deployment)
            : undefined,
          verification: devCycle.verification
            ? JSON.stringify(devCycle.verification)
            : undefined,
          thoughtSignature: devCycle.thoughtSignature ?? undefined,
          completedAt: new Date(),
        });

        // Store generated files
        const generatedFiles = devCycle.generatedCode?.files ?? [];
        if (generatedFiles.length > 0) {
          for (const file of generatedFiles) {
            // Map language to valid FileLanguage type
            const languageMap: Record<string, 'typescript' | 'javascript' | 'json' | 'yaml' | 'dockerfile' | 'markdown' | 'shell' | 'css' | 'html'> = {
              typescript: 'typescript',
              javascript: 'javascript',
              json: 'json',
              yaml: 'yaml',
              dockerfile: 'dockerfile',
              markdown: 'markdown',
              shell: 'shell',
              css: 'css',
              html: 'html',
            };
            const language = languageMap[file.language] ?? 'typescript';

            await generatedFileRepository.create({
              developmentCycleId: id,
              path: file.path,
              content: file.content,
              language,
              purpose: file.purpose,
              isNew: true,
            });
          }
        }

        broadcastDevelopmentComplete(id, {
          cycleId: id,
          duration,
          phase: 'COMPLETED',
        });

        logger.info({ cycleId: id, duration }, 'Development cycle completed');
      });

      // Listen for cycle failure
      orchestrator.on('development:failed', async ({ cycle: devCycle, reason }) => {
        activeDevelopmentCycles.delete(id);
        activeOrchestrators.delete(id);

        // Update database
        await developmentCycleRepository.fail(id, reason);

        broadcastDevelopmentFailed(id, reason, devCycle.phase);

        logger.error({ cycleId: id, reason, phase: devCycle.phase }, 'Development cycle failed');
      });

      // Parse frontend config if present
      const frontendConfig = cycle.frontendConfig
        ? safeJsonParse<{
            framework: 'react' | 'vue';
            bundler: 'vite' | 'webpack';
            consumesServices: string[];
            styling: 'tailwind' | 'css-modules' | 'styled-components';
            stateManagement: 'tanstack-query' | 'zustand' | 'redux';
          }>(cycle.frontendConfig)
        : undefined;

      // Start development in background (non-blocking)
      orchestrator.develop(requirement, {
        serviceType: cycle.serviceType,
        storageMode: cycle.storageMode as 'memory' | 'sqlite' | 'postgres',
        frontendConfig: frontendConfig ?? undefined,
      }).catch((err) => {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        logger.error({ cycleId: id, error: errorMessage }, 'Development orchestration error');

        activeDevelopmentCycles.delete(id);
        activeOrchestrators.delete(id);
        developmentCycleRepository.fail(id, errorMessage);
        broadcastDevelopmentFailed(id, errorMessage, 'UNKNOWN');
      });

      logger.info({ cycleId: id }, 'Development cycle started');

      return {
        message: 'Development cycle started',
        data: {
          id,
          phase: 'ANALYZING',
          startedAt: new Date().toISOString(),
        },
      };
    }
  );

  // Rebuild a completed development cycle (used after applying evolutions)
  // This only runs BUILD → DEPLOY → VERIFY, skipping analysis/architecture/coding
  app.post(
    '/:id/rebuild',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      // Check if cycle is already running
      if (activeDevelopmentCycles.has(id)) {
        return reply.status(409).send({
          error: 'Development cycle already in progress',
          runStatus: activeDevelopmentCycles.get(id),
        });
      }

      const cycle = await developmentCycleRepository.getById(id);

      if (!cycle) {
        return reply.status(404).send({ error: 'Development cycle not found' });
      }

      // Rebuild is only valid for completed cycles
      if (cycle.phase !== 'COMPLETED' && cycle.phase !== 'FAILED') {
        return reply.status(400).send({
          error: `Cannot rebuild cycle in phase ${cycle.phase}. Rebuild is only available for COMPLETED or FAILED cycles.`,
        });
      }

      // Get current generated files
      const files = await generatedFileRepository.getByDevelopmentCycle(id);
      if (files.length === 0) {
        return reply.status(400).send({ error: 'No generated files found for this cycle' });
      }

      logger.info({ cycleId: id, fileCount: files.length }, 'Starting rebuild for development cycle');

      // Track rebuild status
      activeDevelopmentCycles.set(id, { startedAt: new Date(), phase: 'BUILDING' });

      // Update cycle phase to BUILDING
      await developmentCycleRepository.update(id, { phase: 'BUILDING' as DevelopmentPhase });
      broadcastDevelopmentPhaseChange(id, 'BUILDING', { cycleId: id, isRebuild: true });

      // Run rebuild in background (non-blocking) with self-repair loop
      (async () => {
        const config = getConfig();
        
        // Build config from environment - must match DevelopmentOrchestrator's config
        const buildMode = config.docker.buildMode;
        const kanikoConfig = buildMode === 'kaniko' ? {
          namespace: config.docker.kanikoNamespace,
          serviceAccount: config.docker.kanikoServiceAccount,
        } : undefined;
        const buildConfig = {
          registry: config.docker.registry || 'localhost:5000',
          baseImage: config.docker.baseImage || 'node:20-alpine',
          buildMode,
          kaniko: kanikoConfig,
        };
        const deploymentNamespace = config.kubernetes.namespace;
        
        // Get app name from analyzed requirement with unique cycle ID suffix
        const analyzedReq = cycle.analyzedRequirement ? JSON.parse(cycle.analyzedRequirement) : null;
        const baseName = (analyzedReq?.title || 'app')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 53); // Leave room for 8-char suffix + dash
        const appName = `${baseName}-${id.slice(0, 8)}`;
        
        // Initialize Gemini client for code fixes - use model config from environment
        const geminiClient = new GeminiClient({
          apiKey: config.gemini.apiKey,
          model: config.gemini.model as import('@chronosops/gemini').GeminiModel,
          proModel: config.gemini.proModel as import('@chronosops/gemini').GeminiModel,
          modelAssignments: config.gemini.modelAssignments,
        });
        
        // Current files (may be updated by fix loop)
        let currentFiles: Array<{ id: string; path: string; content: string; language: FileLanguage }> = files.map(f => ({
          id: f.id,
          path: f.path,
          content: f.content,
          language: f.language as FileLanguage,
        }));
        
        let buildResult: Awaited<ReturnType<BuildOrchestrator['build']>> | null = null;
        let lastError = '';
        
        // Self-repair loop: try to build, fix errors, retry
        for (let attempt = 1; attempt <= MAX_REBUILD_FIX_RETRIES; attempt++) {
          try {
            logger.info({ cycleId: id, attempt, maxAttempts: MAX_REBUILD_FIX_RETRIES }, 
              'Rebuild attempt starting');
            
            // Update phase
            activeDevelopmentCycles.set(id, { startedAt: new Date(), phase: 'BUILDING' });
            await developmentCycleRepository.update(id, { phase: 'BUILDING' as DevelopmentPhase });
            broadcastDevelopmentPhaseChange(id, 'BUILDING', { cycleId: id, isRebuild: true, attempt });
            
            const buildOrchestrator = new BuildOrchestrator({
              registry: buildConfig.registry,
              baseImage: buildConfig.baseImage,
              buildMode: buildConfig.buildMode,
              kaniko: buildConfig.kaniko,
            });
            
            buildResult = await buildOrchestrator.build(
              currentFiles.map(f => ({
                path: f.path,
                content: f.content,
                language: f.language as 'typescript' | 'javascript' | 'json' | 'yaml' | 'dockerfile' | 'markdown' | 'shell' | 'css' | 'html',
                purpose: 'application file',
                isNew: false,
              })),
              appName
            );
            
            if (buildResult.success) {
              logger.info({ cycleId: id, attempt, imageTag: buildResult.imageTag }, 
                'Rebuild: Docker image built successfully');
              break; // Success! Exit retry loop
            }
            
            // Build failed - extract errors and try to fix
            lastError = buildResult.error || 'Build failed with unknown error';
            const buildErrors = extractBuildErrors(lastError);
            
            logger.warn({ cycleId: id, attempt, errorCount: buildErrors.length, error: lastError.substring(0, 500) }, 
              'Build failed, attempting to fix code');
            
            if (buildErrors.length === 0) {
              logger.warn({ cycleId: id }, 'No parseable errors found, cannot auto-fix');
              break; // Can't fix what we can't parse
            }
            
            if (attempt >= MAX_REBUILD_FIX_RETRIES) {
              logger.error({ cycleId: id, attempt }, 'Max fix retries reached');
              break;
            }
            
            // Update phase to indicate fixing
            activeDevelopmentCycles.set(id, { startedAt: new Date(), phase: 'FIXING' });
            broadcastDevelopmentPhaseChange(id, 'BUILDING', { cycleId: id, isRebuild: true, fixing: true, attempt });
            
            // Fix the code using Gemini
            const fixedFiles = await fixCodeWithGemini(currentFiles, buildErrors, geminiClient);
            
            // Count how many files were actually fixed
            const fixedCount = fixedFiles.filter(f => f.fixed).length;
            logger.info({ cycleId: id, fixedCount, totalFiles: fixedFiles.length }, 
              'Code fix attempt completed');
            
            if (fixedCount === 0) {
              logger.warn({ cycleId: id }, 'No files were fixed, cannot improve');
              break; // No progress, stop trying
            }
            
            // Update files in database
            for (const file of fixedFiles) {
              if (file.fixed) {
                await generatedFileRepository.update(file.id, { content: file.content });
                logger.info({ file: file.path }, 'Updated fixed file in database');
              }
            }
            
            // Update current files for next attempt (strip 'fixed' property)
            currentFiles = fixedFiles.map(f => ({
              id: f.id,
              path: f.path,
              content: f.content,
              language: f.language,
            }));
            
            logger.info({ cycleId: id, attempt, nextAttempt: attempt + 1 }, 
              'Retrying build with fixed code');
            
          } catch (err) {
            lastError = err instanceof Error ? err.message : 'Unknown error';
            logger.error({ cycleId: id, attempt, error: lastError }, 'Error during rebuild attempt');
            
            if (attempt >= MAX_REBUILD_FIX_RETRIES) {
              break;
            }
          }
        }
        
        // Check final result
        if (!buildResult?.success) {
          const errorMessage = `Build failed after ${MAX_REBUILD_FIX_RETRIES} attempts: ${lastError}`;
          logger.error({ cycleId: id, error: errorMessage }, 'Rebuild failed - all fix attempts exhausted');
          
          activeDevelopmentCycles.delete(id);
          await developmentCycleRepository.update(id, {
            phase: 'FAILED' as DevelopmentPhase,
            error: JSON.stringify({ message: errorMessage, phase: 'REBUILD' }),
          });
          
          broadcastDevelopmentFailed(id, errorMessage, 'REBUILD');
          return;
        }
        
        // Build succeeded! Continue with deployment
        try {
          // Update build result in database
          await developmentCycleRepository.update(id, {
            buildResult: JSON.stringify({
              success: buildResult.success,
              buildId: id.slice(0, 8),
              imageTag: buildResult.imageTag,
              logs: buildResult.logs.map(l => l.message),
              testResults: buildResult.testResults,
              duration: buildResult.processingTimeMs,
              completedAt: new Date().toISOString(),
            }),
          });
          
          // Step 2: Deploy to Kubernetes
          activeDevelopmentCycles.set(id, { startedAt: new Date(), phase: 'DEPLOYING' });
          await developmentCycleRepository.update(id, { phase: 'DEPLOYING' as DevelopmentPhase });
          broadcastDevelopmentPhaseChange(id, 'DEPLOYING', { cycleId: id, isRebuild: true });
          
          // Get existing deployment info - use its namespace, not config namespace
          const existingDeployment = cycle.deployment ? JSON.parse(cycle.deployment) : null;
          const imageFullName = `${buildConfig.registry}/${appName}:${buildResult.imageTag}`;
          // Use namespace from existing deployment, fallback to config
          const namespace = existingDeployment?.namespace || deploymentNamespace;
          const k8sClient = app.services.k8sClient;
          
          if (k8sClient && existingDeployment?.deploymentName) {
            // Update existing deployment with new image
            logger.info({ cycleId: id, deployment: existingDeployment.deploymentName, namespace, newImage: imageFullName }, 
              'Updating Kubernetes deployment with new image');
            
            const updateResult = await k8sClient.updateDeploymentImage(
              existingDeployment.deploymentName,
              namespace,
              imageFullName
            );
            
            if (!updateResult.success) {
              throw new Error(`Deployment update failed: ${updateResult.error}`);
            }
            
            // Wait for rollout
            const rolloutResult = await k8sClient.waitForRollout(
              existingDeployment.deploymentName,
              namespace,
              120000 // 2 minute timeout
            );
            
            if (!rolloutResult.success) {
              logger.warn({ cycleId: id, error: rolloutResult.error }, 
                'Rollout did not complete successfully, continuing anyway');
            }
            
            // Check deployment health
            const healthResult = await k8sClient.checkDeploymentHealth(
              existingDeployment.deploymentName, 
              namespace
            );
            
            // Update deployment info
            const updatedDeployment = {
              ...existingDeployment,
              image: imageFullName,
              availableReplicas: healthResult.readyPods,
              status: healthResult.healthy ? 'running' : 'degraded',
              lastRebuiltAt: new Date().toISOString(),
              rebuildCount: (existingDeployment.rebuildCount || 0) + 1,
            };
            
            await developmentCycleRepository.update(id, {
              deployment: JSON.stringify(updatedDeployment),
            });
            
            logger.info({ cycleId: id, healthy: healthResult.healthy, readyPods: healthResult.readyPods }, 
              'Rebuild: Kubernetes deployment updated successfully');
          } else {
            // No K8s client or no existing deployment - simulate
            logger.info({ cycleId: id }, 'Rebuild: Simulating deployment update (K8s client not available)');
            
            const simulatedDeployment = {
              ...existingDeployment,
              image: imageFullName,
              status: 'running',
              lastRebuiltAt: new Date().toISOString(),
              rebuildCount: (existingDeployment?.rebuildCount || 0) + 1,
            };
            
            await developmentCycleRepository.update(id, {
              deployment: JSON.stringify(simulatedDeployment),
            });
          }
          
          // Step 3: Mark as completed
          activeDevelopmentCycles.delete(id);
          await developmentCycleRepository.update(id, { 
            phase: 'COMPLETED' as DevelopmentPhase,
            completedAt: new Date(),
          });
          
          broadcastDevelopmentComplete(id, {
            cycleId: id,
            phase: 'COMPLETED',
            isRebuild: true,
            newImageTag: buildResult.imageTag,
          });
          
          logger.info({ cycleId: id, newImageTag: buildResult.imageTag }, 'Rebuild completed successfully');
          
        } catch (err) {
          // Deployment failed (build already succeeded at this point)
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          logger.error({ cycleId: id, error: errorMessage }, 'Deployment failed after successful build');
          
          activeDevelopmentCycles.delete(id);
          await developmentCycleRepository.update(id, {
            phase: 'FAILED' as DevelopmentPhase,
            error: JSON.stringify({ message: errorMessage, phase: 'DEPLOYING' }),
          });
          
          broadcastDevelopmentFailed(id, errorMessage, 'DEPLOYING');
        }
      })();

      return {
        message: 'Rebuild started',
        data: {
          id,
          phase: 'BUILDING',
          startedAt: new Date().toISOString(),
          isRebuild: true,
        },
      };
    }
  );

  // Get development cycle status
  app.get(
    '/:id/status',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      const cycle = await developmentCycleRepository.getById(id);

      if (!cycle) {
        return reply.status(404).send({ error: 'Development cycle not found' });
      }

      const runStatus = activeDevelopmentCycles.get(id);

      return {
        data: {
          id: cycle.id,
          phase: cycle.phase,
          isRunning: !!runStatus,
          runStatus: runStatus ?? null,
          iterations: cycle.iterations,
          maxIterations: cycle.maxIterations,
          error: cycle.error ? JSON.parse(cycle.error) : null,
          createdAt: cycle.createdAt,
          updatedAt: cycle.updatedAt,
          completedAt: cycle.completedAt,
        },
      };
    }
  );

  // Get generated files for a development cycle
  app.get(
    '/:id/files',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      const cycle = await developmentCycleRepository.getById(id);

      if (!cycle) {
        return reply.status(404).send({ error: 'Development cycle not found' });
      }

      const files = await generatedFileRepository.getByDevelopmentCycle(id);

      return { data: files };
    }
  );

  // Get generated file content by ID
  app.get(
    '/:cycleId/files/:fileId',
    async (
      request: FastifyRequest<{ Params: { cycleId: string; fileId: string } }>,
      reply: FastifyReply
    ) => {
      const { cycleId, fileId } = request.params;

      const cycle = await developmentCycleRepository.getById(cycleId);

      if (!cycle) {
        return reply.status(404).send({ error: 'Development cycle not found' });
      }

      const file = await generatedFileRepository.getById(fileId);

      if (!file || file.developmentCycleId !== cycleId) {
        return reply.status(404).send({ error: 'Generated file not found' });
      }

      return { data: file };
    }
  );

  // Get development cycles triggered by an incident
  app.get(
    '/by-incident/:incidentId',
    async (request: FastifyRequest<{ Params: { incidentId: string } }>, _reply: FastifyReply) => {
      const { incidentId } = request.params;

      const cycles = await developmentCycleRepository.getByIncident(incidentId);

      return { data: cycles };
    }
  );

  // Cancel a running development cycle
  app.post(
    '/:id/cancel',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      // Check if cycle exists and is in a running phase
      const cycle = await developmentCycleRepository.getById(id);
      if (!cycle) {
        return reply.status(404).send({ error: 'Development cycle not found' });
      }

      // Running phases that can be cancelled
      const runningPhases = ['ANALYZING', 'DESIGNING', 'CODING', 'TESTING', 'BUILDING', 'DEPLOYING', 'VERIFYING'];
      const isRunningPhase = runningPhases.includes(cycle.phase);
      const isInActiveMap = activeDevelopmentCycles.has(id);
      const hasOrchestrator = activeOrchestrators.has(id);

      if (!isRunningPhase && !isInActiveMap && !hasOrchestrator) {
        return reply.status(400).send({ error: 'Development cycle is not running' });
      }

      // Signal cancellation to the orchestrator (this triggers abort signal)
      const orchestrator = activeOrchestrators.get(id);
      if (orchestrator) {
        const cancelled = orchestrator.cancel(id);
        logger.info({ cycleId: id, cancelled }, 'Signalled cancellation to orchestrator');
        activeOrchestrators.delete(id);
      }

      // Remove from active tracking (if present)
      if (isInActiveMap) {
        activeDevelopmentCycles.delete(id);
      }

      // Mark as failed in database
      await developmentCycleRepository.fail(id, 'Cancelled by user');

      broadcastDevelopmentFailed(id, 'Cancelled by user', 'CANCELLED');

      logger.info({ cycleId: id, wasOrphaned: !hasOrchestrator }, 'Development cycle cancelled');

      return { message: 'Development cycle cancelled' };
    }
  );

  // Retry the current phase of a development cycle
  // This cancels any current operation and restarts from the current phase
  app.post(
    '/:id/retry-phase',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      // Check if cycle exists
      const cycle = await developmentCycleRepository.getById(id);
      if (!cycle) {
        return reply.status(404).send({ error: 'Development cycle not found' });
      }

      // Only allow retry on running phases
      const runningPhases = ['ANALYZING', 'DESIGNING', 'CODING', 'TESTING', 'BUILDING', 'DEPLOYING', 'VERIFYING'];
      if (!runningPhases.includes(cycle.phase)) {
        return reply.status(400).send({
          error: 'Cannot retry phase - cycle is not in a running phase',
          phase: cycle.phase,
        });
      }

      // Cancel any running orchestrator first
      const existingOrchestrator = activeOrchestrators.get(id);
      if (existingOrchestrator) {
        existingOrchestrator.cancel(id);
        activeOrchestrators.delete(id);
      }

      // Remove from active tracking (if present) to cancel current operation
      const wasRunning = activeDevelopmentCycles.has(id);
      if (wasRunning) {
        activeDevelopmentCycles.delete(id);
      }

      // Reset phase retry counter for the current phase only
      const currentRetries = cycle.phaseRetries ? JSON.parse(cycle.phaseRetries) : {};
      currentRetries[cycle.phase] = 0;

      // Update cycle with reset retry count
      await developmentCycleRepository.update(id, {
        phaseRetries: JSON.stringify(currentRetries),
        error: undefined, // Clear any previous error
      });

      // Get updated cycle
      const updatedCycle = await developmentCycleRepository.getById(id);
      if (!updatedCycle) {
        return reply.status(500).send({ error: 'Failed to reload cycle after retry reset' });
      }

      logger.info({
        cycleId: id,
        phase: cycle.phase,
        wasRunning,
        resetRetries: currentRetries,
      }, 'Retrying development cycle phase');

      // Create a new orchestrator and resume the cycle
      const orchestrator = await app.services.createDevelopmentOrchestrator();

      // Track as active and store orchestrator for cancellation support
      activeDevelopmentCycles.set(id, { startedAt: new Date(), phase: cycle.phase });
      activeOrchestrators.set(id, orchestrator);

      // Broadcast phase change to trigger UI update
      broadcastDevelopmentPhaseChange(id, cycle.phase, { retrying: true });

      // Run asynchronously (don't wait for completion)
      (async () => {
        try {
          // Parse stored JSON fields
          const analyzedRequirement = updatedCycle.analyzedRequirement
            ? JSON.parse(updatedCycle.analyzedRequirement)
            : undefined;
          const architecture = updatedCycle.architecture
            ? JSON.parse(updatedCycle.architecture)
            : undefined;

          // Convert repository record to DevelopmentCycle type for orchestrator
          // Must include all stored state for proper phase resumption
          const developmentCycle = {
            id: updatedCycle.id,
            phase: updatedCycle.phase as DevelopmentPhase,
            serviceType: updatedCycle.serviceType as 'backend' | 'frontend' | 'fullstack',
            requirement: {
              id: updatedCycle.id,
              source: updatedCycle.requirementSource as 'user' | 'incident' | 'improvement' | 'pattern',
              rawText: updatedCycle.requirementRaw,
              priority: updatedCycle.requirementPriority as 'low' | 'medium' | 'high' | 'critical',
            },
            analyzedRequirement,
            architecture,
            iterations: updatedCycle.iterations,
            maxIterations: updatedCycle.maxIterations,
            createdAt: new Date(updatedCycle.createdAt).toISOString(),
            updatedAt: new Date(updatedCycle.updatedAt).toISOString(),
            phaseRetries: currentRetries,
          };

          const result = await orchestrator.resume(developmentCycle);

          // Success - broadcast completion and cleanup
          broadcastDevelopmentComplete(id, result.phase === 'COMPLETED' ? 'success' : 'failed');
          activeDevelopmentCycles.delete(id);
          activeOrchestrators.delete(id);

          logger.info({ cycleId: id, finalPhase: result.phase }, 'Retried phase completed');
        } catch (error) {
          const err = error as Error;
          logger.error({ cycleId: id, error: err.message }, 'Phase retry failed');

          await developmentCycleRepository.fail(id, `Phase retry failed: ${err.message}`);
          broadcastDevelopmentFailed(id, err.message, cycle.phase);
          activeDevelopmentCycles.delete(id);
          activeOrchestrators.delete(id);
        }
      })();

      return {
        message: 'Phase retry initiated',
        phase: cycle.phase,
        cycleId: id,
      };
    }
  );

  // Delete a development cycle and all associated resources
  app.delete(
    '/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      // 1. Check if cycle is running - cancel it automatically if so
      const wasRunning = activeDevelopmentCycles.has(id) || activeOrchestrators.has(id);
      if (wasRunning) {
        logger.info({ cycleId: id }, 'Cycle is running, will cancel during deletion');
      }

      // 2. Get cycle (need deployment info for cleanup)
      const cycle = await developmentCycleRepository.getById(id);
      if (!cycle) {
        return reply.status(404).send({ error: 'Development cycle not found' });
      }

      // 3. Parse deployment info for K8s and Docker cleanup
      const deployment = safeJsonParse<{
        deploymentName?: string;
        serviceName?: string;
        namespace?: string;
        image?: string;
      }>(cycle.deployment);

      const cleanupResults: {
        k8sService?: { success: boolean; error?: string };
        k8sDeployment?: { success: boolean; error?: string };
        dockerImage?: { success: boolean; localDeleted?: boolean; registryDeleted?: boolean; error?: string };
        tempDirectory?: { success: boolean; error?: string };
        gitRepository?: { success: boolean; localDeleted?: boolean; remoteDeleted?: boolean; error?: string };
        editLocks?: { success: boolean; count?: number; error?: string };
        fileVersions?: { success: boolean; count?: number; error?: string };
        codeEvolutions?: { success: boolean; count?: number; error?: string };
        relatedIncidents?: { success: boolean; count?: number; error?: string };
      } = {};

      // 3.5. Cancel any running orchestrator (in case the cycle was forcibly deleted)
      const runningOrchestrator = activeOrchestrators.get(id);
      if (runningOrchestrator) {
        runningOrchestrator.cancel(id);
        activeOrchestrators.delete(id);
        activeDevelopmentCycles.delete(id);
        logger.info({ cycleId: id }, 'Cancelled running orchestrator during delete');
      }

      // 3.6. Cascade delete ALL incidents and their children for this app
      try {
        // Find the monitored app for this cycle to get all linked incidents
        const monitoredApp = await monitoredAppRepository.getByDevelopmentCycleId(id);
        let allRelatedIncidents: Awaited<ReturnType<typeof incidentRepository.list>> = [];

        if (monitoredApp) {
          // Primary: find incidents by monitoredAppId (most reliable)
          allRelatedIncidents = await incidentRepository.getByMonitoredAppId(monitoredApp.id);
        }

        // Secondary: also find by deployment name in title (catches incidents without monitoredAppId)
        if (deployment?.deploymentName && deployment?.namespace) {
          const recentIncidents = await incidentRepository.list(
            { namespace: deployment.namespace },
            500,
            0
          );
          const titleMatches = recentIncidents.filter(incident =>
            incident.title.includes(deployment.deploymentName!) ||
            incident.title.includes(`[${deployment.deploymentName!}]`)
          );
          // Merge without duplicates
          const existingIds = new Set(allRelatedIncidents.map(i => i.id));
          for (const incident of titleMatches) {
            if (!existingIds.has(incident.id)) {
              allRelatedIncidents.push(incident);
            }
          }
        }

        // Cascade delete each incident and all its children
        for (const incident of allRelatedIncidents) {
          try {
            // Stop heartbeat if any
            await incidentRepository.stopInvestigation(incident.id);
            // Delete children in FK-safe order (actions before hypotheses)
            await evidenceRepository.deleteByIncident(incident.id);
            await actionRepository.deleteByIncident(incident.id);
            await hypothesisRepository.deleteByIncident(incident.id);
            await thoughtStateRepository.deleteByIncident(incident.id);
            await timelineRepository.deleteByIncident(incident.id);
            await postmortemRepository.deleteByIncident(incident.id);
            await learnedPatternRepository.nullifyByIncidentId(incident.id);
            await reconstructedIncidentRepository.deleteByIncidentId(incident.id);
            await developmentCycleRepository.nullifyTriggeredByIncidentId(incident.id);
            await incidentRepository.delete(incident.id);
            logger.info({
              incidentId: incident.id,
              deploymentName: deployment?.deploymentName,
            }, 'Cascade deleted incident and all related data during app deletion');
          } catch (incErr) {
            logger.warn({
              incidentId: incident.id,
              error: incErr instanceof Error ? incErr.message : 'Unknown error',
            }, 'Failed to cascade delete individual incident during app deletion');
          }
        }

        cleanupResults.relatedIncidents = {
          success: true,
          count: allRelatedIncidents.length,
        };
      } catch (err) {
        cleanupResults.relatedIncidents = {
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
        logger.warn({ cycleId: id, error: err }, 'Failed to cleanup related incidents');
      }

      // 4. Delete K8s resources (if deployment exists)
      if (deployment?.namespace && app.services.k8sClient) {
        // Delete service first
        if (deployment.serviceName) {
          try {
            cleanupResults.k8sService = await app.services.k8sClient.deleteService(
              deployment.serviceName,
              deployment.namespace
            );
          } catch (err) {
            cleanupResults.k8sService = {
              success: false,
              error: err instanceof Error ? err.message : 'Unknown error',
            };
          }
        }

        // Delete deployment
        if (deployment.deploymentName) {
          try {
            cleanupResults.k8sDeployment = await app.services.k8sClient.deleteDeployment(
              deployment.deploymentName,
              deployment.namespace
            );
          } catch (err) {
            cleanupResults.k8sDeployment = {
              success: false,
              error: err instanceof Error ? err.message : 'Unknown error',
            };
          }
        }
      }

      // 5. Delete Docker image (if exists) - handles both local and registry cleanup
      if (deployment?.image) {
        try {
          // Parse image name to extract registry, name, and tag
          // Format: us-central1-docker.pkg.dev/project/repo/image-name:tag or image-name:tag
          // For Artifact Registry, the format has multiple path segments
          const artifactRegistryMatch = deployment.image.match(
            /^([\w-]+-docker\.pkg\.dev\/[^/]+\/[^/]+)\/([^:]+)(?::(.+))?$/
          );
          const simpleMatch = deployment.image.match(/^(?:([^/]+)\/)?([^:]+)(?::(.+))?$/);

          const imageMatch = artifactRegistryMatch || simpleMatch;

          if (imageMatch) {
            const registry = imageMatch[1] ?? undefined;
            const imageName = imageMatch[2] ?? deployment.image;
            const imageTag = imageMatch[3] ?? 'latest';

            // Create ImageBuilder with registry config and buildMode for proper cleanup
            const config = getConfig();
            const imageBuilder = new ImageBuilder({
              registry: registry,
              buildMode: config.docker.buildMode,
            });

            // Delete from both local Docker and registry
            const deleteResult = await imageBuilder.delete(imageName, imageTag);

            cleanupResults.dockerImage = {
              success: deleteResult.success,
              localDeleted: deleteResult.localDeleted,
              registryDeleted: deleteResult.registryDeleted,
              error: deleteResult.error,
            };

            logger.info({
              image: deployment.image,
              localDeleted: deleteResult.localDeleted,
              registryDeleted: deleteResult.registryDeleted,
            }, 'Docker image cleanup completed');
          } else {
            cleanupResults.dockerImage = {
              success: false,
              error: 'Could not parse image name',
            };
          }
        } catch (err) {
          cleanupResults.dockerImage = {
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
          };
        }
      }

      // 5.5. Delete temp directory (/tmp/chronosops-dev-{cycleId})
      try {
        const imageBuilder = new ImageBuilder({});
        const tempDeleteResult = await imageBuilder.deleteTempDirectory(id);
        cleanupResults.tempDirectory = {
          success: tempDeleteResult.success,
          error: tempDeleteResult.error,
        };
        if (tempDeleteResult.success) {
          logger.info({ cycleId: id }, 'Temp directory cleanup completed');
        }
      } catch (err) {
        cleanupResults.tempDirectory = {
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }

      // 6. Delete Git repository (local and remote)
      try {
        const gitRepo = await gitRepositoryRepository.findByCycleId(id);
        if (gitRepo) {
          const config = getConfig();
          const gitService = new GitService({ config: config.git });
          
          const deleteResult = await gitService.deleteRepository(gitRepo.localPath, {
            deleteRemote: !!gitRepo.remoteUrl,
          });
          
          cleanupResults.gitRepository = {
            success: deleteResult.success,
            localDeleted: deleteResult.localDeleted,
            remoteDeleted: deleteResult.remoteDeleted,
            error: deleteResult.error,
          };
          
          // Delete from database
          await gitRepositoryRepository.delete(gitRepo.id);
          
          logger.info({
            cycleId: id,
            localDeleted: deleteResult.localDeleted,
            remoteDeleted: deleteResult.remoteDeleted,
          }, 'Git repository cleanup completed');
        }
      } catch (err) {
        cleanupResults.gitRepository = {
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }

      // 7. Release any active edit locks
      try {
        const locks = await editLockRepository.findByCycleId(id);
        if (locks.length > 0) {
          for (const lock of locks) {
            await editLockRepository.delete(lock.id);
          }
          cleanupResults.editLocks = {
            success: true,
            count: locks.length,
          };
        }
      } catch (err) {
        cleanupResults.editLocks = {
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }

      // 8. Delete file versions
      try {
        const deletedVersions = await fileVersionRepository.deleteByCycleId(id);
        cleanupResults.fileVersions = {
          success: true,
          count: deletedVersions,
        };
      } catch (err) {
        cleanupResults.fileVersions = {
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }

      // 9. Delete code evolutions
      try {
        const deletedEvolutions = await codeEvolutionRepository.deleteByCycleId(id);
        cleanupResults.codeEvolutions = {
          success: true,
          count: deletedEvolutions,
        };
      } catch (err) {
        cleanupResults.codeEvolutions = {
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }

      // 10. Deregister from monitoring (Prometheus/Grafana cleanup)
      try {
        const { monitoringConfigService } = await import('@chronosops/core');
        await monitoringConfigService.deregisterFromMonitoring(id);
        logger.info({ cycleId: id }, 'App deregistered from monitoring');
      } catch (err) {
        logger.warn(
          { cycleId: id, error: err instanceof Error ? err.message : 'Unknown error' },
          'Failed to deregister app from monitoring'
        );
      }

      // 11. Delete database records (cascade - monitored apps, service registry, files, then cycle)
      await monitoredAppRepository.deleteByDevelopmentCycleId(id);
      await serviceRegistryRepository.deleteByDevelopmentCycleId(id);
      await generatedFileRepository.deleteByDevelopmentCycle(id);
      await developmentCycleRepository.delete(id);

      // 12. Broadcast deletion via WebSocket
      broadcastDevelopmentDeleted(id);

      logger.info(
        { cycleId: id, cleanup: cleanupResults },
        'Development cycle and resources deleted'
      );

      return {
        message: 'Development cycle deleted successfully',
        cleanup: cleanupResults,
      };
    }
  );
}

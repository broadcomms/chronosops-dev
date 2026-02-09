/**
 * Intelligence API Routes
 * Endpoints for incident reconstruction, pattern learning, and knowledge base
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  reconstructedIncidentRepository,
  learnedPatternRepository,
} from '@chronosops/database';
import type { PatternType } from '@chronosops/database';
import {
  IncidentReconstructor,
  PatternLearner,
  KnowledgeBase,
  type RawIncidentData,
  type PatternMatchInput,
} from '@chronosops/core';
import { createChildLogger } from '@chronosops/shared';

const logger = createChildLogger({ component: 'IntelligenceAPI' });

// Track active reconstructions
const activeReconstructions = new Map<string, { startedAt: Date; progress: number }>();

// Request schemas
const reconstructIncidentSchema = z.object({
  incidentId: z.string().optional(),
  timeRange: z.object({
    start: z.string().datetime(),
    end: z.string().datetime(),
  }),
  logs: z.array(z.object({
    timestamp: z.string(),
    level: z.enum(['debug', 'info', 'warn', 'error', 'fatal']),
    service: z.string(),
    message: z.string(),
    metadata: z.record(z.unknown()).optional(),
  })).optional(),
  metrics: z.array(z.object({
    timestamp: z.string(),
    metric: z.string(),
    value: z.number(),
    labels: z.record(z.string()).optional(),
  })).optional(),
  events: z.array(z.object({
    timestamp: z.string(),
    type: z.enum(['Normal', 'Warning']),
    reason: z.string(),
    object: z.string(),
    message: z.string(),
    namespace: z.string(),
  })).optional(),
  screenshots: z.array(z.object({
    timestamp: z.string(),
    description: z.string(),
    base64Data: z.string().optional(),
  })).optional(),
  additionalContext: z.string().optional(),
});

const learnPatternsSchema = z.object({
  incidentId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  rootCause: z.string().optional(),
  resolution: z.string().optional(),
  timeToResolution: z.number().optional(),
  actionsTaken: z.array(z.object({
    type: z.string(),
    target: z.string(),
    success: z.boolean(),
  })).optional(),
});

const findPatternsSchema = z.object({
  errorMessages: z.array(z.string()).optional(),
  logs: z.array(z.string()).optional(),
  events: z.array(z.object({
    type: z.string(),
    reason: z.string(),
    message: z.string(),
  })).optional(),
  metricAnomalies: z.array(z.object({
    metric: z.string(),
    deviation: z.string(),
  })).optional(),
  affectedService: z.string().optional(),
  symptoms: z.array(z.string()).optional(),
  minScore: z.number().min(0).max(1).optional(),
  maxResults: z.number().min(1).max(50).optional(),
  types: z.array(z.enum(['detection', 'diagnostic', 'resolution', 'prevention'])).optional(),
});

const listPatternsSchema = z.object({
  type: z.enum(['detection', 'diagnostic', 'resolution', 'prevention']).optional(),
  isActive: z.coerce.boolean().optional(),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

export async function intelligenceRoutes(app: FastifyInstance): Promise<void> {
  // Create shared instances
  const reconstructor = new IncidentReconstructor(app.services.geminiClient);
  const patternLearner = new PatternLearner(app.services.geminiClient);
  const knowledgeBase = new KnowledgeBase(app.services.geminiClient);

  // ============================================
  // Incident Reconstruction
  // ============================================

  // Reconstruct incident from raw data
  app.post('/reconstruct', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = reconstructIncidentSchema.parse(request.body);

    const reconstructionId = crypto.randomUUID();
    logger.info({ reconstructionId, incidentId: body.incidentId }, 'Starting incident reconstruction');

    // Track reconstruction
    activeReconstructions.set(reconstructionId, { startedAt: new Date(), progress: 0 });

    try {
      // Build raw data object
      const rawData: RawIncidentData = {
        timeRange: {
          start: new Date(body.timeRange.start),
          end: new Date(body.timeRange.end),
        },
        incidentId: body.incidentId,
        logs: body.logs,
        metrics: body.metrics,
        events: body.events,
        screenshots: body.screenshots?.map(s => ({
          timestamp: s.timestamp,
          description: s.description,
          base64: s.base64Data,
        })),
        additionalContext: body.additionalContext,
      };

      // Listen for progress updates
      reconstructor.on('reconstruction:progress', ({ progress }) => {
        const status = activeReconstructions.get(reconstructionId);
        if (status) {
          status.progress = progress;
        }
      });

      // Run reconstruction
      const result = await reconstructor.reconstruct(rawData);

      // Store in database and get the record with ID
      const storedRecord = await reconstructedIncidentRepository.create({
        incidentId: body.incidentId,
        timeRangeStart: rawData.timeRange.start,
        timeRangeEnd: rawData.timeRange.end,
        timeline: result.timeline,
        causalChain: result.causalChain,
        rootCause: result.rootCause,
        recommendations: result.recommendations,
        narrative: result.narrative,
        dataQuality: result.dataQuality,
        inputTokensUsed: result.tokenUsage.inputTokens,
      });

      activeReconstructions.delete(reconstructionId);

      logger.info(
        { reconstructionId, recordId: storedRecord.id, rootCause: result.rootCause, timelineEntries: result.timeline.length },
        'Incident reconstruction completed'
      );

      // Return the stored record which includes the database ID
      return { data: storedRecord };
    } catch (error) {
      activeReconstructions.delete(reconstructionId);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage, reconstructionId }, 'Reconstruction failed');
      return reply.status(500).send({ error: `Reconstruction failed: ${errorMessage}` });
    }
  });

  // Get reconstruction status
  app.get('/reconstruct/:id/status', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const status = activeReconstructions.get(id);
    if (!status) {
      return reply.status(404).send({ error: 'Reconstruction not found or already completed' });
    }

    return { data: status };
  });

  // List reconstructions
  app.get('/reconstructions', async (request: FastifyRequest, _reply: FastifyReply) => {
    const query = z.object({
      incidentId: z.string().optional(),
      limit: z.coerce.number().min(1).max(100).default(50),
      offset: z.coerce.number().min(0).default(0),
    }).parse(request.query);

    const reconstructions = await reconstructedIncidentRepository.list(
      { incidentId: query.incidentId },
      query.limit,
      query.offset
    );

    return { data: reconstructions };
  });

  // Get reconstruction by ID
  app.get('/reconstructions/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const reconstruction = await reconstructedIncidentRepository.getById(id);
    if (!reconstruction) {
      return reply.status(404).send({ error: 'Reconstruction not found' });
    }

    return { data: reconstruction };
  });

  // ============================================
  // Pattern Learning
  // ============================================

  // Learn patterns from a resolved incident
  app.post('/patterns/learn', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = learnPatternsSchema.parse(request.body);

    logger.info({ incidentId: body.incidentId }, 'Learning patterns from incident');

    try {
      const result = await patternLearner.extractPatterns({
        id: body.incidentId,
        title: body.title,
        description: body.description,
        severity: body.severity,
        rootCause: body.rootCause,
        resolution: body.resolution,
        timeToResolution: body.timeToResolution,
        actionsTaken: body.actionsTaken,
      });

      // Store patterns in knowledge base
      const storedPatterns = await knowledgeBase.storePatternsFromExtraction(result.patterns);

      logger.info(
        { incidentId: body.incidentId, patternsExtracted: result.patterns.length, patternsStored: storedPatterns.length },
        'Patterns learned and stored'
      );

      return {
        data: {
          patternsExtracted: result.patterns.length,
          patternsStored: storedPatterns.length,
          patterns: storedPatterns,
          metadata: result.metadata,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage, incidentId: body.incidentId }, 'Pattern learning failed');
      return reply.status(500).send({ error: `Pattern learning failed: ${errorMessage}` });
    }
  });

  // Find matching patterns
  app.post('/patterns/match', async (request: FastifyRequest, _reply: FastifyReply) => {
    const body = findPatternsSchema.parse(request.body);

    logger.info({ body }, 'Finding matching patterns');

    const input: PatternMatchInput = {
      errorMessages: body.errorMessages,
      logs: body.logs,
      events: body.events,
      metricAnomalies: body.metricAnomalies,
      affectedService: body.affectedService,
      symptoms: body.symptoms,
    };

    const result = await knowledgeBase.findMatchingPatterns(input, {
      minScore: body.minScore,
      maxResults: body.maxResults,
      types: body.types as PatternType[],
    });

    return { data: result };
  });

  // Get recommendations based on current state
  app.post('/patterns/recommendations', async (request: FastifyRequest, _reply: FastifyReply) => {
    const body = findPatternsSchema.parse(request.body);

    const input: PatternMatchInput = {
      errorMessages: body.errorMessages,
      logs: body.logs,
      events: body.events,
      metricAnomalies: body.metricAnomalies,
      affectedService: body.affectedService,
      symptoms: body.symptoms,
    };

    const result = await knowledgeBase.getRecommendations(input);

    return { data: result };
  });

  // ============================================
  // Pattern Management (Knowledge Base)
  // ============================================

  // List patterns
  app.get('/patterns', async (request: FastifyRequest, _reply: FastifyReply) => {
    const query = listPatternsSchema.parse(request.query);

    const patterns = await learnedPatternRepository.list(
      {
        type: query.type as PatternType | undefined,
        isActive: query.isActive,
        minConfidence: query.minConfidence,
      },
      query.limit,
      query.offset
    );

    return { data: patterns };
  });

  // Get pattern by ID
  app.get('/patterns/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const pattern = await knowledgeBase.getPattern(id);
    if (!pattern) {
      return reply.status(404).send({ error: 'Pattern not found' });
    }

    return { data: pattern };
  });

  // Update pattern
  app.patch('/patterns/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const body = z.object({
      name: z.string().optional(),
      description: z.string().optional(),
      triggerConditions: z.array(z.string()).optional(),
      recommendedActions: z.array(z.string()).optional(),
      confidence: z.number().min(0).max(1).optional(),
      applicability: z.string().optional(),
      exceptions: z.array(z.string()).optional(),
      isActive: z.boolean().optional(),
    }).parse(request.body);

    const updated = await knowledgeBase.updatePattern(id, body);
    if (!updated) {
      return reply.status(404).send({ error: 'Pattern not found' });
    }

    logger.info({ patternId: id }, 'Pattern updated');

    return { data: updated };
  });

  // Record pattern application
  app.post('/patterns/:id/applied', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const body = z.object({
      success: z.boolean(),
    }).parse(request.body);

    const pattern = await knowledgeBase.getPattern(id);
    if (!pattern) {
      return reply.status(404).send({ error: 'Pattern not found' });
    }

    await knowledgeBase.recordPatternApplication(id, body.success);

    logger.info({ patternId: id, success: body.success }, 'Pattern application recorded');

    return { message: 'Pattern application recorded' };
  });

  // Deactivate pattern
  app.post('/patterns/:id/deactivate', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const body = z.object({
      reason: z.string(),
    }).parse(request.body);

    const pattern = await knowledgeBase.getPattern(id);
    if (!pattern) {
      return reply.status(404).send({ error: 'Pattern not found' });
    }

    await knowledgeBase.deactivatePattern(id, body.reason);

    logger.info({ patternId: id, reason: body.reason }, 'Pattern deactivated');

    return { message: 'Pattern deactivated' };
  });

  // Delete pattern
  app.delete('/patterns/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const pattern = await knowledgeBase.getPattern(id);
    if (!pattern) {
      return reply.status(404).send({ error: 'Pattern not found' });
    }

    await knowledgeBase.deletePattern(id);

    logger.info({ patternId: id }, 'Pattern deleted');

    return { message: 'Pattern deleted' };
  });

  // Get knowledge base stats
  app.get('/stats', async (_request: FastifyRequest, _reply: FastifyReply) => {
    const stats = await knowledgeBase.getStats();
    return { data: stats };
  });

  // Search patterns by keywords
  app.get('/patterns/search', async (request: FastifyRequest, _reply: FastifyReply) => {
    const query = z.object({
      keywords: z.string().transform((s) => s.split(',')),
    }).parse(request.query);

    const patterns = await knowledgeBase.searchPatterns(query.keywords);

    return { data: patterns };
  });

  // Get high confidence patterns
  app.get('/patterns/high-confidence', async (_request: FastifyRequest, _reply: FastifyReply) => {
    const patterns = await knowledgeBase.getHighConfidencePatterns();
    return { data: patterns };
  });
}

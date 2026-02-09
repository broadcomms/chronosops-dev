/**
 * Incidents API Routes
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  incidentRepository,
  evidenceRepository,
  hypothesisRepository,
  actionRepository,
  thoughtStateRepository,
  timelineRepository,
  postmortemRepository,
  monitoredAppRepository,
  learnedPatternRepository,
  reconstructedIncidentRepository,
  developmentCycleRepository,
} from '@chronosops/database';
import { createChildLogger } from '@chronosops/shared';
import { PatternLearner, KnowledgeBase } from '@chronosops/core';
import {
  broadcastPhaseChange,
  broadcastIncidentUpdate,
  broadcastPatternLearned,
  broadcastIntelligenceStatsUpdate,
} from '../websocket/index.js';

const logger = createChildLogger({ component: 'IncidentsAPI' });

// Unique instance ID for this server process (H1 fix - scalability)
const INSTANCE_ID = `api-${randomUUID().slice(0, 8)}-${process.pid}`;

// Heartbeat interval for active investigations (30 seconds)
const HEARTBEAT_INTERVAL_MS = 30000;

// Stale threshold for orphaned investigation detection (60 seconds)
const STALE_THRESHOLD_MS = 60000;

// Track heartbeat intervals for cleanup
const heartbeatIntervals = new Map<string, NodeJS.Timeout>();

/**
 * Start heartbeat for an active investigation
 */
function startHeartbeat(incidentId: string): void {
  // Clear any existing heartbeat
  stopHeartbeat(incidentId);

  const interval = setInterval(async () => {
    try {
      await incidentRepository.updateInvestigationHeartbeat(incidentId);
    } catch (err) {
      logger.error({ incidentId, err }, 'Failed to update investigation heartbeat');
    }
  }, HEARTBEAT_INTERVAL_MS);

  heartbeatIntervals.set(incidentId, interval);
}

/**
 * Stop heartbeat for an investigation
 */
function stopHeartbeat(incidentId: string): void {
  const interval = heartbeatIntervals.get(incidentId);
  if (interval) {
    clearInterval(interval);
    heartbeatIntervals.delete(incidentId);
  }
}

/**
 * Recover orphaned investigations on startup
 */
export async function recoverOrphanedInvestigations(): Promise<void> {
  try {
    const recoveredCount = await incidentRepository.recoverOrphanedInvestigations(STALE_THRESHOLD_MS);
    if (recoveredCount > 0) {
      logger.warn({ recoveredCount, instanceId: INSTANCE_ID }, 'Recovered orphaned investigations on startup');
    } else {
      logger.info({ instanceId: INSTANCE_ID }, 'No orphaned investigations found on startup');
    }
  } catch (err) {
    logger.error({ err }, 'Failed to recover orphaned investigations');
  }
}

// Request schemas
const createIncidentSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  namespace: z.string().min(1),
  monitoredAppId: z.string().uuid().optional(), // Optional for backward compatibility
});

const listIncidentsSchema = z.object({
  status: z.enum(['active', 'investigating', 'mitigating', 'resolved', 'closed']).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  namespace: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

export async function incidentsRoutes(app: FastifyInstance): Promise<void> {
  // List incidents
  app.get('/', async (request: FastifyRequest, _reply: FastifyReply) => {
    const query = listIncidentsSchema.parse(request.query);

    const incidents = await incidentRepository.list(
      {
        status: query.status,
        severity: query.severity,
        namespace: query.namespace,
      },
      query.limit,
      query.offset
    );

    return { data: incidents };
  });

  // Get incident by ID
  app.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const incident = await incidentRepository.getById(id);

    if (!incident) {
      return reply.status(404).send({ error: 'Incident not found' });
    }

    // Get investigation info from database (active OR completed)
    const db = await import('@chronosops/database');
    const incidentRecord = await db.getDatabase()
      .select()
      .from(db.incidents)
      .where(db.eq(db.incidents.id, id))
      .limit(1);

    const record = incidentRecord[0];
    let investigationStatus = null;

    // Return investigation data if we have a startedAt timestamp (active or completed)
    if (record?.investigationStartedAt) {
      const isActive = await incidentRepository.isInvestigationActive(id, STALE_THRESHOLD_MS);
      investigationStatus = {
        startedAt: record.investigationStartedAt,
        completedAt: (incident.state === 'DONE' || incident.state === 'FAILED') ? record.resolvedAt : null,
        phase: incident.state,
        instanceId: record.investigationInstanceId,
        isActive,
      };
    }

    return {
      data: incident,
      investigation: investigationStatus,
    };
  });

  // Create incident
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createIncidentSchema.parse(request.body);

    // Validate monitoredAppId if provided
    if (body.monitoredAppId) {
      const monitoredApp = await monitoredAppRepository.getById(body.monitoredAppId);
      if (!monitoredApp) {
        return reply.status(400).send({
          error: 'Invalid monitoredAppId',
          message: 'The specified monitored application does not exist',
        });
      }
    }

    const incident = await incidentRepository.create(body);

    logger.info('Incident created', {
      incidentId: incident.id,
      monitoredAppId: body.monitoredAppId,
    });

    return reply.status(201).send({ data: incident });
  });

  // Start investigation
  app.post('/:id/investigate', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    // Check if investigation is already running (H1 fix - database-backed check)
    const isActive = await incidentRepository.isInvestigationActive(id, STALE_THRESHOLD_MS);
    if (isActive) {
      const incident = await incidentRepository.getById(id);
      return reply.status(409).send({
        error: 'Investigation already in progress',
        investigation: {
          startedAt: incident?.startedAt,
          phase: incident?.state,
        },
      });
    }

    const incident = await incidentRepository.getById(id);

    if (!incident) {
      return reply.status(404).send({ error: 'Incident not found' });
    }

    // Update status to investigating and start tracking (H1 fix - database-backed tracking)
    await incidentRepository.update(id, { status: 'investigating' });
    await incidentRepository.startInvestigation(id, INSTANCE_ID);

    // Start heartbeat to keep investigation alive
    startHeartbeat(id);

    // Create orchestrator with properly injected dependencies
    const orchestrator = app.services.createOrchestrator();

    // Listen for phase changes - persist to timeline
    orchestrator.on('phase:changed', async ({ phase, context }) => {
      // H1 fix: Phase is tracked in database via state field

      // Persist phase change to timeline
      try {
        await timelineRepository.create({
          incidentId: id,
          type: 'phase_change',
          title: `Entered ${phase} phase`,
          description: `Investigation transitioned to ${phase}`,
          phase: phase as 'OBSERVING' | 'ORIENTING' | 'DECIDING' | 'ACTING' | 'VERIFYING' | 'DONE' | 'FAILED',
          timestamp: new Date(),
        });

        // Update incident state in DB
        await incidentRepository.update(id, { state: phase });
      } catch (err) {
        logger.error({ err }, 'Failed to persist phase change');
      }

      // Broadcast phase change via WebSocket
      broadcastPhaseChange(id, phase, {
        phase,
        context,
        timestamp: new Date().toISOString(),
      });
    });

    // Listen for evidence collection - persist to database
    orchestrator.on('observation:collected', async ({ evidence }) => {
      try {
        // Ensure timestamp is a Date object
        const timestamp = evidence.timestamp
          ? (evidence.timestamp instanceof Date ? evidence.timestamp : new Date(evidence.timestamp))
          : new Date();

        // Persist evidence to database
        await evidenceRepository.create({
          incidentId: id,
          type: evidence.type || 'video_frame',
          source: evidence.source || 'gemini_vision',
          content: evidence.content || evidence,
          timestamp,
          confidence: evidence.confidence,
          metadata: evidence.metadata,
        });

        // Set incident thumbnail from first video_frame evidence with frameImage
        if (evidence.type === 'video_frame' && evidence.metadata?.frameImage) {
          const currentIncident = await incidentRepository.getById(id);
          if (currentIncident && !currentIncident.thumbnail) {
            await incidentRepository.update(id, {
              thumbnail: evidence.metadata.frameImage as string,
            });
            logger.info({ incidentId: id }, 'Set incident thumbnail from first frame');
          }
        }

        // Add to timeline
        await timelineRepository.create({
          incidentId: id,
          type: 'evidence',
          title: `Evidence collected: ${evidence.type || 'observation'}`,
          description: evidence.summary || evidence.description,
          phase: 'OBSERVING',
          timestamp: new Date(),
          metadata: { evidenceId: evidence.id },
        });
      } catch (err) {
        logger.error({ err }, 'Failed to persist evidence');
      }

      // Broadcast via WebSocket
      broadcastIncidentUpdate(id, {
        type: 'evidence_collected',
        evidence,
        timestamp: new Date().toISOString(),
      });
    });

    // Listen for hypothesis generation - persist to database
    orchestrator.on('hypothesis:generated', async ({ hypothesis }) => {
      try {
        // Persist hypothesis to database, preserving orchestrator's ID for FK consistency
        await hypothesisRepository.create({
          id: hypothesis.id,
          incidentId: id,
          rootCause: hypothesis.rootCause || hypothesis.description,
          confidence: hypothesis.confidence || 0.5,
          status: hypothesis.status || 'proposed',
          supportingEvidence: hypothesis.supportingEvidence || [],
          contradictingEvidence: hypothesis.contradictingEvidence || [],
          suggestedActions: hypothesis.suggestedActions || [],
        });

        // Add to timeline
        await timelineRepository.create({
          incidentId: id,
          type: 'hypothesis',
          title: `Hypothesis generated`,
          description: hypothesis.rootCause || hypothesis.description,
          phase: 'DECIDING',
          timestamp: new Date(),
          metadata: { confidence: hypothesis.confidence },
        });
      } catch (err) {
        logger.error({ err }, 'Failed to persist hypothesis');
      }

      // Broadcast via WebSocket
      broadcastIncidentUpdate(id, {
        type: 'hypothesis_generated',
        hypothesis,
        timestamp: new Date().toISOString(),
      });
    });

    // Listen for escalation step events - persist to timeline for real-time visibility
    orchestrator.on('escalation:step', async ({ title, description, phase, metadata }: {
      title: string; description: string; phase: string; metadata: Record<string, unknown>;
    }) => {
      try {
        await timelineRepository.create({
          incidentId: id,
          type: 'action',
          title,
          description,
          phase: phase as 'OBSERVING' | 'ORIENTING' | 'DECIDING' | 'ACTING' | 'VERIFYING',
          timestamp: new Date(),
          metadata,
        });
      } catch (err) {
        logger.warn({ err, title }, 'Failed to persist escalation step to timeline');
      }

      broadcastIncidentUpdate(id, {
        type: 'timeline_updated',
        title,
        description,
        phase,
        timestamp: new Date().toISOString(),
      });
    });

    // Listen for action execution - persist to database
    orchestrator.on('action:executed', async ({ action, result }) => {
      try {
        // Persist action to database with hypothesis ID (now preserved through FK chain)
        await actionRepository.create({
          incidentId: id,
          hypothesisId: action.hypothesisId,
          type: action.actionType || 'manual',
          target: typeof action.target === 'string' ? action.target : JSON.stringify(action.target || 'unknown'),
          parameters: action.parameters,
          status: result.success ? 'completed' : 'failed',
          dryRun: action.dryRun ?? false,
        });

        // Add to timeline
        await timelineRepository.create({
          incidentId: id,
          type: 'action',
          title: `Action executed: ${action.actionType}`,
          description: result.message || `${action.actionType} on ${action.target}`,
          phase: 'ACTING',
          timestamp: new Date(),
          metadata: { success: result.success, target: action.target },
        });
      } catch (err) {
        logger.error({ err }, 'Failed to persist action');
      }

      // Broadcast via WebSocket
      broadcastIncidentUpdate(id, {
        type: 'action_executed',
        action,
        result,
        timestamp: new Date().toISOString(),
      });
    });

    // Listen for verification completion - persist to timeline
    orchestrator.on('verification:completed', async ({ success, details }) => {
      try {
        await timelineRepository.create({
          incidentId: id,
          type: 'verification',
          title: success ? 'Verification successful' : 'Verification failed',
          description: details,
          phase: 'VERIFYING',
          timestamp: new Date(),
          metadata: { success },
        });
      } catch (err) {
        logger.error({ err }, 'Failed to persist verification');
      }

      // Broadcast via WebSocket
      broadcastIncidentUpdate(id, {
        type: 'verification_completed',
        success,
        details,
        timestamp: new Date().toISOString(),
      });
    });

    // Listen for completion - update both status AND state
    orchestrator.on('investigation:completed', async ({ incident: resolvedIncident, duration, result }) => {
      // H1 fix: Stop heartbeat and clear database tracking
      stopHeartbeat(resolvedIncident.id);
      await incidentRepository.stopInvestigation(resolvedIncident.id);
      logger.info({ incidentId: resolvedIncident.id, durationMs: duration }, 'Investigation completed');

      try {
        // Add completion to timeline
        await timelineRepository.create({
          incidentId: resolvedIncident.id,
          type: 'phase_change',
          title: 'Investigation completed',
          description: `Investigation completed successfully in ${(duration / 1000).toFixed(1)} seconds`,
          phase: 'DONE',
          timestamp: new Date(),
          metadata: { duration, result },
        });

        // Update incident status AND state
        await incidentRepository.update(resolvedIncident.id, {
          status: 'resolved',
          state: 'DONE',
        });

        // Generate postmortem automatically
        logger.info({ incidentId: resolvedIncident.id }, 'Generating postmortem');

        // Fetch investigation data for postmortem
        const [evidence, hypotheses, actions] = await Promise.all([
          evidenceRepository.getByIncident(resolvedIncident.id),
          hypothesisRepository.getByIncident(resolvedIncident.id),
          actionRepository.getByIncident(resolvedIncident.id),
        ]);

        // Generate postmortem using Gemini
        const postmortemResponse = await app.services.geminiClient.generatePostmortem({
          incidentId: resolvedIncident.id,
          title: resolvedIncident.title,
          evidence: evidence.map(e => ({
            id: e.id,
            type: e.type,
            source: e.source,
            content: typeof e.content === 'string' ? e.content : JSON.stringify(e.content),
            timestamp: e.timestamp,
            confidence: e.confidence ?? undefined,
          })),
          hypotheses: hypotheses.map(h => ({
            id: h.id,
            description: h.rootCause,
            confidence: h.confidence,
            status: h.status,
            supportingEvidence: h.supportingEvidence || [],
            contradictingEvidence: h.contradictingEvidence || [],
          })),
          actions: actions.map(a => ({
            id: a.id,
            type: a.type,
            target: a.target,
            status: a.status,
            result: a.result ? JSON.stringify(a.result) : undefined,
          })),
          duration,
        });

        if (postmortemResponse.success && postmortemResponse.data) {
          // Save postmortem to database
          await postmortemRepository.create({
            incidentId: resolvedIncident.id,
            summary: postmortemResponse.data.summary,
            timeline: postmortemResponse.data.timeline.map(t => `${t.phase}: ${t.event}`),
            rootCauseAnalysis: postmortemResponse.data.rootCauseAnalysis,
            impactAnalysis: postmortemResponse.data.impactAnalysis,
            actionsTaken: postmortemResponse.data.actionsTaken.map(a => `${a.action}: ${a.result}`),
            lessonsLearned: postmortemResponse.data.lessonsLearned,
            preventionRecommendations: postmortemResponse.data.preventionRecommendations,
            markdown: postmortemResponse.data.markdown,
          });

          logger.info({ incidentId: resolvedIncident.id }, 'Postmortem generated and saved');

          // Broadcast postmortem generation via WebSocket
          broadcastIncidentUpdate(resolvedIncident.id, {
            type: 'postmortem_generated',
            timestamp: new Date().toISOString(),
          });

          // ===============================================
          // Automatic Pattern Learning (Intelligence Platform Integration)
          // ===============================================
          try {
            logger.info({ incidentId: resolvedIncident.id }, 'Starting automatic pattern learning');

            // Create PatternLearner and KnowledgeBase instances
            const patternLearner = new PatternLearner(app.services.geminiClient);
            const knowledgeBase = new KnowledgeBase(app.services.geminiClient);

            // Prepare incident data for learning
            const incidentForLearning = {
              id: resolvedIncident.id,
              title: resolvedIncident.title,
              description: resolvedIncident.description,
              severity: resolvedIncident.severity as 'low' | 'medium' | 'high' | 'critical',
              rootCause: postmortemResponse.data.rootCauseAnalysis,
              resolution: postmortemResponse.data.summary,
              timeToResolution: Math.round(duration / 60000), // Convert ms to minutes
              actionsTaken: actions.map(a => ({
                type: a.type,
                target: a.target,
                success: a.status === 'completed',
              })),
            };

            // Extract patterns from the incident
            const extractionResult = await patternLearner.extractPatterns(incidentForLearning);

            if (extractionResult.patterns.length > 0) {
              // Store patterns in knowledge base (with deduplication)
              const storedPatterns = await knowledgeBase.storePatternsFromExtraction(extractionResult.patterns);

              logger.info({
                incidentId: resolvedIncident.id,
                patternsExtracted: extractionResult.patterns.length,
                patternsStored: storedPatterns.length,
              }, 'Patterns learned and stored in knowledge base');

              // Broadcast pattern learned events
              for (const pattern of storedPatterns) {
                broadcastPatternLearned(
                  pattern.id,
                  pattern.name,
                  resolvedIncident.id,
                  storedPatterns.length
                );
              }

              // Get updated stats and broadcast
              const stats = await knowledgeBase.getStats();
              broadcastIntelligenceStatsUpdate({
                totalPatterns: stats.totalPatterns,
                highConfidenceCount: stats.highConfidenceCount,
              });
            } else {
              logger.info({ incidentId: resolvedIncident.id }, 'No patterns extracted from incident');
            }
          } catch (patternError) {
            // Non-fatal: log error but don't fail the investigation completion
            logger.warn({ err: patternError, incidentId: resolvedIncident.id }, 'Automatic pattern learning failed');
          }
        } else {
          logger.error({ incidentId: resolvedIncident.id, error: postmortemResponse.error }, 'Failed to generate postmortem');
        }
      } catch (err) {
        logger.error({ err }, 'Failed to persist completion or generate postmortem');
      }

      // Broadcast completion via WebSocket
      broadcastIncidentUpdate(resolvedIncident.id, {
        type: 'completed',
        status: 'resolved',
        duration,
        result,
        timestamp: new Date().toISOString(),
      });
    });

    // Listen for failures - update both status AND state
    orchestrator.on('investigation:failed', async ({ incident: failedIncident, reason, failureDetails }) => {
      // H1 fix: Stop heartbeat and clear database tracking
      stopHeartbeat(failedIncident.id);
      await incidentRepository.stopInvestigation(failedIncident.id);
      logger.error({ incidentId: failedIncident.id, reason, failureDetails }, 'Investigation failed');

      try {
        // Add failure to timeline
        await timelineRepository.create({
          incidentId: failedIncident.id,
          type: 'error',
          title: 'Investigation failed',
          description: reason,
          phase: 'FAILED',
          timestamp: new Date(),
          metadata: { reason, failureDetails },
        });

        // Update incident status AND state
        await incidentRepository.update(failedIncident.id, {
          status: 'active',
          state: 'FAILED',
        });
      } catch (err) {
        logger.error({ err }, 'Failed to persist failure');
      }

      // Broadcast failure via WebSocket with detailed failure info
      broadcastIncidentUpdate(failedIncident.id, {
        type: 'failed',
        status: 'active',
        reason,
        failureDetails: failureDetails ? {
          phase: failureDetails.phase,
          retryAttempts: failureDetails.retryAttempts,
          lastAction: failureDetails.lastAction,
          lastVerificationResult: failureDetails.lastVerificationResult,
          timestamp: failureDetails.timestamp?.toISOString() ?? new Date().toISOString(),
        } : undefined,
        timestamp: new Date().toISOString(),
      });
    });

    // Get the target deployment from monitored apps
    const monitoredApps = await monitoredAppRepository.getActive();
    const targetApp = monitoredApps.find((app: { namespace: string; deployment: string }) => app.namespace === incident.namespace);
    if (targetApp) {
      orchestrator.setTargetDeployment(targetApp.deployment);
      logger.info({
        namespace: incident.namespace,
        deployment: targetApp.deployment
      }, 'Set target deployment for investigation');
    }

    // Start investigation in background (don't await)
    orchestrator.investigate(incident).catch(async (err) => {
      // H1 fix: Stop heartbeat and clear database tracking on error
      stopHeartbeat(id);
      await incidentRepository.stopInvestigation(id);
      logger.error({ incidentId: id, err }, 'Investigation threw error');
    });

    logger.info({ incidentId: id, instanceId: INSTANCE_ID }, 'Investigation started');

    return {
      message: 'Investigation started',
      incidentId: id,
      investigation: {
        startedAt: new Date(),
        phase: 'OBSERVING',
        instanceId: INSTANCE_ID,
      },
    };
  });

  // Get investigation status (H1 fix - database-backed)
  app.get('/:id/investigation', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const incident = await incidentRepository.getById(id);

    if (!incident) {
      return reply.status(404).send({ error: 'Incident not found' });
    }

    // Check if investigation is active using database
    const isActive = await incidentRepository.isInvestigationActive(id, STALE_THRESHOLD_MS);

    if (!isActive) {
      return reply.status(404).send({ error: 'No active investigation for this incident' });
    }

    // Get investigation info from incident record
    const db = await import('@chronosops/database');
    const incidentRecord = await db.getDatabase()
      .select()
      .from(db.incidents)
      .where(db.eq(db.incidents.id, id))
      .limit(1);

    const record = incidentRecord[0];
    const startedAt = record?.investigationStartedAt ?? incident.startedAt;

    return {
      incidentId: id,
      startedAt,
      phase: incident.state,
      instanceId: record?.investigationInstanceId,
      durationMs: startedAt ? Date.now() - new Date(startedAt).getTime() : 0,
    };
  });

  // Get incident evidence
  app.get('/:id/evidence', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const incident = await incidentRepository.getById(id);

    if (!incident) {
      return reply.status(404).send({ error: 'Incident not found' });
    }

    const evidence = await evidenceRepository.getByIncident(id);

    return { data: evidence };
  });

  // Get incident hypotheses
  app.get('/:id/hypotheses', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const incident = await incidentRepository.getById(id);

    if (!incident) {
      return reply.status(404).send({ error: 'Incident not found' });
    }

    const hypotheses = await hypothesisRepository.getByIncident(id);

    return { data: hypotheses };
  });

  // Get incident actions
  app.get('/:id/actions', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const incident = await incidentRepository.getById(id);

    if (!incident) {
      return reply.status(404).send({ error: 'Incident not found' });
    }

    const actions = await actionRepository.getByIncident(id);

    return { data: actions };
  });

  // Get incident timeline
  app.get('/:id/timeline', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const incident = await incidentRepository.getById(id);

    if (!incident) {
      return reply.status(404).send({ error: 'Incident not found' });
    }

    const timeline = await timelineRepository.getByIncident(id);

    return { data: timeline };
  });

  // Get incident thinking/AI reasoning states
  app.get('/:id/thinking', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const incident = await incidentRepository.getById(id);

    if (!incident) {
      return reply.status(404).send({ error: 'Incident not found' });
    }

    const thoughts = await thoughtStateRepository.getByIncident(id);

    return { data: thoughts };
  });

  // Get incident postmortem
  app.get('/:id/postmortem', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const incident = await incidentRepository.getById(id);

    if (!incident) {
      return reply.status(404).send({ error: 'Incident not found' });
    }

    const postmortem = await postmortemRepository.getByIncident(id);

    if (!postmortem) {
      return reply.status(404).send({ error: 'Postmortem not found for this incident' });
    }

    return { data: postmortem };
  });

  // Resolve incident
  app.post('/:id/resolve', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    // H1 fix: Stop heartbeat and clear database tracking if active
    stopHeartbeat(id);
    await incidentRepository.stopInvestigation(id);

    const incident = await incidentRepository.resolve(id);

    if (!incident) {
      return reply.status(404).send({ error: 'Incident not found' });
    }

    logger.info('Incident resolved', { incidentId: id });

    return { data: incident };
  });

  // Delete incident and all related data
  app.delete('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    // H1 fix: Check if investigation is running using database
    const isActive = await incidentRepository.isInvestigationActive(id, STALE_THRESHOLD_MS);
    if (isActive) {
      return reply.status(409).send({
        error: 'Cannot delete incident with active investigation',
      });
    }

    // Check incident exists
    const incident = await incidentRepository.getById(id);
    if (!incident) {
      return reply.status(404).send({ error: 'Incident not found' });
    }

    try {
      // Cascade delete all related data
      // Order matters for FK safety: delete children before parents
      // actions references hypotheses.id, so delete actions FIRST
      await evidenceRepository.deleteByIncident(id);
      await actionRepository.deleteByIncident(id);
      await hypothesisRepository.deleteByIncident(id);
      await thoughtStateRepository.deleteByIncident(id);
      await timelineRepository.deleteByIncident(id);
      await postmortemRepository.deleteByIncident(id);
      // Nullify FK references in tables that should survive incident deletion
      await learnedPatternRepository.nullifyByIncidentId(id);
      await reconstructedIncidentRepository.deleteByIncidentId(id);
      await developmentCycleRepository.nullifyTriggeredByIncidentId(id);
      // Finally delete the incident itself
      await incidentRepository.delete(id);

      // Stop heartbeat if any
      stopHeartbeat(id);

      logger.info({ incidentId: id }, 'Incident and related data deleted');

      return reply.status(200).send({ message: 'Incident deleted successfully' });
    } catch (err) {
      logger.error({ incidentId: id, error: err instanceof Error ? err.message : 'Unknown error' }, 'Failed to delete incident');
      return reply.status(500).send({
        error: 'Failed to delete incident',
        details: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });
}

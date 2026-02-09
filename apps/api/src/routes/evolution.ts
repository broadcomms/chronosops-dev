/**
 * Code Evolution API Routes
 * Endpoints for AI-powered code evolution
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createChildLogger } from '@chronosops/shared';
import { getCodeEvolutionEngine, getEditLockManager } from '@chronosops/core';
import { codeEvolutionRepository } from '@chronosops/database';

const logger = createChildLogger({ component: 'EvolutionAPI' });

// Request schemas
const requestEvolutionSchema = z.object({
  prompt: z.string().min(1, 'Evolution prompt is required'),
  scope: z.array(z.string()).optional(),
  requestedBy: z.string().optional(),
});

const reviewEvolutionSchema = z.object({
  reviewedBy: z.string().min(1, 'Reviewer ID is required'),
  notes: z.string().optional(),
});

const applyEvolutionSchema = z.object({
  approvedBy: z.string().min(1, 'Approver ID is required'),
});

const confirmLimitSchema = z.object({
  confirm: z.boolean(),
  userId: z.string().min(1, 'User ID is required'),
});

export async function evolutionRoutes(fastify: FastifyInstance): Promise<void> {
  const evolutionEngine = getCodeEvolutionEngine();
  const lockManager = getEditLockManager();

  /**
   * GET /development/:cycleId/evolutions
   * List all evolutions for a development cycle
   */
  fastify.get<{
    Params: { cycleId: string };
  }>(
    '/development/:cycleId/evolutions',
    async (request, reply) => {
      const { cycleId } = request.params;

      try {
        const evolutions = await evolutionEngine.getEvolutionsForCycle(cycleId);

        return reply.send({
          success: true,
          data: evolutions,
        });
      } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : 'Unknown', cycleId }, 'Failed to fetch evolutions');
        return reply.status(500).send({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fetch evolutions',
          data: [],
        });
      }
    }
  );

  /**
   * POST /development/:cycleId/evolutions
   * Request a new code evolution
   */
  fastify.post<{
    Params: { cycleId: string };
    Body: z.infer<typeof requestEvolutionSchema>;
  }>(
    '/development/:cycleId/evolutions',
    async (request, reply) => {
      const { cycleId } = request.params;
      const body = requestEvolutionSchema.parse(request.body);

      logger.info({ cycleId, prompt: body.prompt.substring(0, 100) }, 'Evolution requested');

      // Check if user has lock (evolution requires edit lock)
      if (body.requestedBy) {
        const lockInfo = await lockManager.getLockInfo(cycleId, body.requestedBy);
        if (!lockInfo.isLocked || !lockInfo.isOwnLock) {
          // Acquire lock for evolution
          const lockResult = await lockManager.acquireLock({
            developmentCycleId: cycleId,
            userId: body.requestedBy,
            lockType: 'evolution',
          });
          if (!lockResult.success) {
            return reply.status(409).send({
              success: false,
              error: lockResult.error ?? 'Failed to acquire lock for evolution',
              existingLock: lockResult.existingLock,
            });
          }
        }
      }

      const result = await evolutionEngine.requestEvolution({
        developmentCycleId: cycleId,
        prompt: body.prompt,
        scope: body.scope,
        requestedBy: body.requestedBy,
      });

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: result.error,
        });
      }

      return reply.status(201).send({
        success: true,
        data: result.evolution,
      });
    }
  );

  /**
   * GET /development/:cycleId/evolutions/:evolutionId
   * Get a specific evolution
   */
  fastify.get<{
    Params: { cycleId: string; evolutionId: string };
  }>(
    '/development/:cycleId/evolutions/:evolutionId',
    async (request, reply) => {
      const { evolutionId } = request.params;

      const evolution = await evolutionEngine.getEvolution(evolutionId);

      if (!evolution) {
        return reply.status(404).send({
          success: false,
          error: 'Evolution not found',
        });
      }

      return reply.send({
        success: true,
        data: evolution,
      });
    }
  );

  /**
   * POST /development/:cycleId/evolutions/:evolutionId/analyze
   * Analyze an evolution to determine impact
   */
  fastify.post<{
    Params: { cycleId: string; evolutionId: string };
  }>(
    '/development/:cycleId/evolutions/:evolutionId/analyze',
    async (request, reply) => {
      const { evolutionId } = request.params;

      logger.info({ evolutionId }, 'Analyzing evolution');

      const result = await evolutionEngine.analyzeEvolution(evolutionId);

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: result.error,
        });
      }

      return reply.send({
        success: true,
        data: {
          evolution: result.evolution,
          analysis: result.analysis,
          exceedsLimit: result.exceedsLimit,
        },
      });
    }
  );

  /**
   * POST /development/:cycleId/evolutions/:evolutionId/confirm-limit
   * Confirm proceeding when file limit is exceeded
   */
  fastify.post<{
    Params: { cycleId: string; evolutionId: string };
    Body: z.infer<typeof confirmLimitSchema>;
  }>(
    '/development/:cycleId/evolutions/:evolutionId/confirm-limit',
    async (request, reply) => {
      const { evolutionId } = request.params;
      const body = confirmLimitSchema.parse(request.body);

      if (!body.confirm) {
        // User rejected, cancel the evolution
        await codeEvolutionRepository.reject(evolutionId, body.userId, 'File limit exceeded, user declined');
        return reply.send({
          success: true,
          message: 'Evolution cancelled',
        });
      }

      // User confirmed, proceed to generation
      const result = await evolutionEngine.generateChanges(evolutionId);

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: result.error,
        });
      }

      return reply.send({
        success: true,
        data: {
          evolution: result.evolution,
          changes: result.changes,
        },
      });
    }
  );

  /**
   * POST /development/:cycleId/evolutions/:evolutionId/generate
   * Generate proposed changes for an evolution
   */
  fastify.post<{
    Params: { cycleId: string; evolutionId: string };
  }>(
    '/development/:cycleId/evolutions/:evolutionId/generate',
    async (request, reply) => {
      const { evolutionId } = request.params;

      logger.info({ evolutionId }, 'Generating evolution changes');

      const result = await evolutionEngine.generateChanges(evolutionId);

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: result.error,
        });
      }

      return reply.send({
        success: true,
        data: {
          evolution: result.evolution,
          changes: result.changes,
        },
      });
    }
  );

  /**
   * POST /development/:cycleId/evolutions/:evolutionId/approve
   * Approve an evolution for application
   */
  fastify.post<{
    Params: { cycleId: string; evolutionId: string };
    Body: z.infer<typeof reviewEvolutionSchema>;
  }>(
    '/development/:cycleId/evolutions/:evolutionId/approve',
    async (request, reply) => {
      const { evolutionId } = request.params;
      const body = reviewEvolutionSchema.parse(request.body);

      logger.info({ evolutionId, reviewedBy: body.reviewedBy }, 'Approving evolution');

      const evolution = await evolutionEngine.approveEvolution(
        evolutionId,
        body.reviewedBy,
        body.notes
      );

      if (!evolution) {
        return reply.status(404).send({
          success: false,
          error: 'Evolution not found',
        });
      }

      return reply.send({
        success: true,
        data: evolution,
      });
    }
  );

  /**
   * POST /development/:cycleId/evolutions/:evolutionId/reject
   * Reject an evolution
   */
  fastify.post<{
    Params: { cycleId: string; evolutionId: string };
    Body: z.infer<typeof reviewEvolutionSchema>;
  }>(
    '/development/:cycleId/evolutions/:evolutionId/reject',
    async (request, reply) => {
      const { evolutionId } = request.params;
      const body = reviewEvolutionSchema.parse(request.body);

      logger.info({ evolutionId, reviewedBy: body.reviewedBy }, 'Rejecting evolution');

      const evolution = await evolutionEngine.rejectEvolution(
        evolutionId,
        body.reviewedBy,
        body.notes
      );

      if (!evolution) {
        return reply.status(404).send({
          success: false,
          error: 'Evolution not found',
        });
      }

      return reply.send({
        success: true,
        data: evolution,
      });
    }
  );

  /**
   * POST /development/:cycleId/evolutions/:evolutionId/apply
   * Apply an approved evolution
   */
  fastify.post<{
    Params: { cycleId: string; evolutionId: string };
    Body: z.infer<typeof applyEvolutionSchema>;
  }>(
    '/development/:cycleId/evolutions/:evolutionId/apply',
    async (request, reply) => {
      const { evolutionId } = request.params;
      const body = applyEvolutionSchema.parse(request.body);

      logger.info({ evolutionId, approvedBy: body.approvedBy }, 'Applying evolution');

      const result = await evolutionEngine.applyEvolution(evolutionId, body.approvedBy);

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: result.error,
        });
      }

      return reply.send({
        success: true,
        data: {
          evolution: result.evolution,
          filesUpdated: result.filesUpdated,
        },
      });
    }
  );

  /**
   * POST /development/:cycleId/evolutions/:evolutionId/revert
   * Revert an applied evolution
   */
  fastify.post<{
    Params: { cycleId: string; evolutionId: string };
    Body: { reason: string };
  }>(
    '/development/:cycleId/evolutions/:evolutionId/revert',
    async (request, reply) => {
      const { evolutionId } = request.params;
      const { reason } = request.body;

      logger.info({ evolutionId, reason }, 'Reverting evolution');

      const result = await evolutionEngine.revertEvolution(evolutionId, reason);

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: result.error,
        });
      }

      return reply.send({
        success: true,
        data: {
          evolution: result.evolution,
          filesReverted: result.filesReverted,
        },
      });
    }
  );

  /**
   * DELETE /development/:cycleId/evolutions/:evolutionId
   * Delete an evolution (only if not applied)
   */
  fastify.delete<{
    Params: { cycleId: string; evolutionId: string };
  }>(
    '/development/:cycleId/evolutions/:evolutionId',
    async (request, reply) => {
      const { evolutionId } = request.params;

      const evolution = await evolutionEngine.getEvolution(evolutionId);

      if (!evolution) {
        return reply.status(404).send({
          success: false,
          error: 'Evolution not found',
        });
      }

      if (evolution.status === 'applied') {
        return reply.status(400).send({
          success: false,
          error: 'Cannot delete applied evolution. Use revert instead.',
        });
      }

      await codeEvolutionRepository.delete(evolutionId);

      logger.info({ evolutionId }, 'Evolution deleted');

      return reply.send({
        success: true,
        message: 'Evolution deleted',
      });
    }
  );
}

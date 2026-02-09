/**
 * Edit Lock API Routes
 * Endpoints for managing pessimistic locks on development cycles
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createChildLogger } from '@chronosops/shared';
import { getEditLockManager } from '@chronosops/core';
import {
  fileVersionRepository,
  generatedFileRepository,
} from '@chronosops/database';

const logger = createChildLogger({ component: 'EditLockAPI' });

// Request schemas
const acquireLockSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  userName: z.string().optional(),
  lockType: z.enum(['edit', 'evolution']).default('edit'),
  scope: z.enum(['file', 'project']).default('project'),
  files: z.array(z.string()).optional(),
});

const heartbeatSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
});

const releaseLockSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
});

const saveBackupSchema = z.object({
  changes: z.record(z.string(), z.string()),
});

const updateFileSchema = z.object({
  content: z.string(),
  userId: z.string().min(1, 'User ID is required'),
});

export async function editLockRoutes(fastify: FastifyInstance): Promise<void> {
  const lockManager = getEditLockManager();

  /**
   * GET /development/:cycleId/lock
   * Get lock status for a development cycle
   */
  fastify.get<{
    Params: { cycleId: string };
    Querystring: { userId?: string };
  }>(
    '/development/:cycleId/lock',
    async (request, reply) => {
      const { cycleId } = request.params;
      const { userId } = request.query;

      const lockInfo = await lockManager.getLockInfo(cycleId, userId ?? '');

      return reply.send({
        success: true,
        data: lockInfo,
      });
    }
  );

  /**
   * POST /development/:cycleId/lock
   * Acquire a lock on a development cycle
   */
  fastify.post<{
    Params: { cycleId: string };
    Body: z.infer<typeof acquireLockSchema>;
  }>(
    '/development/:cycleId/lock',
    async (request, reply) => {
      const { cycleId } = request.params;
      const body = acquireLockSchema.parse(request.body);

      logger.info({ cycleId, userId: body.userId }, 'Lock acquisition requested');

      const result = await lockManager.acquireLock({
        developmentCycleId: cycleId,
        userId: body.userId,
        userName: body.userName,
        lockType: body.lockType,
        scope: body.scope,
        files: body.files,
      });

      if (!result.success) {
        return reply.status(409).send({
          success: false,
          error: result.error,
          existingLock: result.existingLock,
        });
      }

      // Start heartbeat for this lock
      if (result.lock) {
        lockManager.startHeartbeat(result.lock.id, body.userId);
      }

      return reply.send({
        success: true,
        data: result.lock,
      });
    }
  );

  /**
   * POST /development/:cycleId/lock/:lockId/heartbeat
   * Send heartbeat to keep lock alive
   */
  fastify.post<{
    Params: { cycleId: string; lockId: string };
    Body: z.infer<typeof heartbeatSchema>;
  }>(
    '/development/:cycleId/lock/:lockId/heartbeat',
    async (request, reply) => {
      const { lockId } = request.params;
      const body = heartbeatSchema.parse(request.body);

      const result = await lockManager.heartbeat(lockId, body.userId);

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: result.error,
        });
      }

      return reply.send({
        success: true,
        data: {
          lock: result.lock,
          extended: result.extended,
        },
      });
    }
  );

  /**
   * DELETE /development/:cycleId/lock/:lockId
   * Release a lock
   */
  fastify.delete<{
    Params: { cycleId: string; lockId: string };
    Body: z.infer<typeof releaseLockSchema>;
  }>(
    '/development/:cycleId/lock/:lockId',
    async (request, reply) => {
      const { lockId } = request.params;
      const body = releaseLockSchema.parse(request.body);

      logger.info({ lockId, userId: body.userId }, 'Lock release requested');

      const result = await lockManager.releaseLock(lockId, body.userId);

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: result.error,
        });
      }

      return reply.send({
        success: true,
        message: 'Lock released',
      });
    }
  );

  /**
   * DELETE /development/:cycleId/lock/:lockId/force
   * Force release a lock (admin action - bypasses user check)
   */
  fastify.delete<{
    Params: { cycleId: string; lockId: string };
  }>(
    '/development/:cycleId/lock/:lockId/force',
    async (request, reply) => {
      const { lockId } = request.params;

      logger.info({ lockId }, 'Force lock release requested');

      const result = await lockManager.forceRelease(lockId);

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: result.error,
        });
      }

      return reply.send({
        success: true,
        message: 'Lock force released',
      });
    }
  );

  /**
   * POST /development/:cycleId/lock/:lockId/backup
   * Save local backup for a lock (before expiry)
   */
  fastify.post<{
    Params: { cycleId: string; lockId: string };
    Body: z.infer<typeof saveBackupSchema>;
  }>(
    '/development/:cycleId/lock/:lockId/backup',
    async (request, reply) => {
      const { lockId } = request.params;
      const body = saveBackupSchema.parse(request.body);

      const saved = await lockManager.saveLocalBackup(lockId, body.changes);

      if (!saved) {
        return reply.status(500).send({
          success: false,
          error: 'Failed to save backup',
        });
      }

      return reply.send({
        success: true,
        message: 'Backup saved',
      });
    }
  );

  /**
   * GET /development/:cycleId/lock/:lockId/backup
   * Get local backup for a lock
   */
  fastify.get<{
    Params: { cycleId: string; lockId: string };
  }>(
    '/development/:cycleId/lock/:lockId/backup',
    async (request, reply) => {
      const { lockId } = request.params;

      const backup = await lockManager.getLocalBackup(lockId);

      return reply.send({
        success: true,
        data: backup,
      });
    }
  );

  /**
   * PUT /development/:cycleId/files/:fileId
   * Update a file's content (requires lock)
   */
  fastify.put<{
    Params: { cycleId: string; fileId: string };
    Body: z.infer<typeof updateFileSchema>;
  }>(
    '/development/:cycleId/files/:fileId',
    async (request, reply) => {
      const { cycleId, fileId } = request.params;
      const body = updateFileSchema.parse(request.body);

      // Check lock
      const lockInfo = await lockManager.getLockInfo(cycleId, body.userId);
      if (!lockInfo.isLocked || !lockInfo.isOwnLock) {
        return reply.status(403).send({
          success: false,
          error: lockInfo.isLocked
            ? 'Project is locked by another user'
            : 'You must acquire a lock before editing',
        });
      }

      // Get existing file
      const file = await generatedFileRepository.getById(fileId);
      if (!file || file.developmentCycleId !== cycleId) {
        return reply.status(404).send({
          success: false,
          error: 'File not found',
        });
      }

      // Create version record
      const nextVersion = await fileVersionRepository.getNextVersionNumber(fileId);
      await fileVersionRepository.create({
        generatedFileId: fileId,
        developmentCycleId: cycleId,
        version: nextVersion,
        content: body.content,
        changeType: 'edit',
        changeDescription: `Manual edit by ${body.userId}`,
        changedBy: 'user',
      });

      // Update file
      const updatedFile = await generatedFileRepository.update(fileId, {
        content: body.content,
        validationStatus: 'pending',
      });

      logger.info({ fileId, version: nextVersion }, 'File updated');

      return reply.send({
        success: true,
        data: {
          file: updatedFile,
          version: nextVersion,
        },
      });
    }
  );

  /**
   * GET /development/:cycleId/versions
   * Get all versions for a development cycle
   */
  fastify.get<{
    Params: { cycleId: string };
  }>(
    '/development/:cycleId/versions',
    async (request, reply) => {
      const { cycleId } = request.params;

      const versions = await fileVersionRepository.findByCycleId(cycleId);

      return reply.send({
        success: true,
        data: versions,
      });
    }
  );

  /**
   * GET /development/:cycleId/files/:fileId/versions
   * Get version history for a file
   */
  fastify.get<{
    Params: { cycleId: string; fileId: string };
  }>(
    '/development/:cycleId/files/:fileId/versions',
    async (request, reply) => {
      const { fileId } = request.params;

      const versions = await fileVersionRepository.findByFileId(fileId);

      return reply.send({
        success: true,
        data: versions,
      });
    }
  );

  /**
   * GET /development/:cycleId/files/:fileId/versions/:version
   * Get a specific version of a file
   */
  fastify.get<{
    Params: { cycleId: string; fileId: string; version: string };
  }>(
    '/development/:cycleId/files/:fileId/versions/:version',
    async (request, reply) => {
      const { fileId, version } = request.params;

      const fileVersion = await fileVersionRepository.findByFileIdAndVersion(
        fileId,
        parseInt(version, 10)
      );

      if (!fileVersion) {
        return reply.status(404).send({
          success: false,
          error: 'Version not found',
        });
      }

      return reply.send({
        success: true,
        data: fileVersion,
      });
    }
  );

  /**
   * POST /development/:cycleId/files/:fileId/revert/:version
   * Revert a file to a specific version
   */
  fastify.post<{
    Params: { cycleId: string; fileId: string; version: string };
    Body: z.infer<typeof updateFileSchema>;
  }>(
    '/development/:cycleId/files/:fileId/revert/:version',
    async (request, reply) => {
      const { cycleId, fileId, version } = request.params;
      const body = updateFileSchema.parse(request.body);

      // Check lock
      const lockInfo = await lockManager.getLockInfo(cycleId, body.userId);
      if (!lockInfo.isLocked || !lockInfo.isOwnLock) {
        return reply.status(403).send({
          success: false,
          error: 'You must acquire a lock before reverting',
        });
      }

      // Get the version to revert to
      const targetVersion = await fileVersionRepository.findByFileIdAndVersion(
        fileId,
        parseInt(version, 10)
      );

      if (!targetVersion) {
        return reply.status(404).send({
          success: false,
          error: 'Version not found',
        });
      }

      // Create revert version record
      const nextVersion = await fileVersionRepository.getNextVersionNumber(fileId);
      await fileVersionRepository.create({
        generatedFileId: fileId,
        developmentCycleId: cycleId,
        version: nextVersion,
        content: targetVersion.content,
        changeType: 'revert',
        changeDescription: `Reverted to version ${version}`,
        changedBy: 'user',
      });

      // Update file
      const updatedFile = await generatedFileRepository.update(fileId, {
        content: targetVersion.content,
        validationStatus: 'pending',
      });

      logger.info({ fileId, revertedToVersion: version, newVersion: nextVersion }, 'File reverted');

      return reply.send({
        success: true,
        data: {
          file: updatedFile,
          version: nextVersion,
          revertedFrom: parseInt(version, 10),
        },
      });
    }
  );
}

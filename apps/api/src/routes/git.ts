/**
 * Git API Routes
 * Endpoints for Git repository operations
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createChildLogger, getConfig } from '@chronosops/shared';
import { gitRepositoryRepository } from '@chronosops/database';
import { GitService } from '@chronosops/git';

const logger = createChildLogger({ component: 'GitAPI' });

// Request schemas
const commitSchema = z.object({
  message: z.string().min(1, 'Commit message is required'),
  files: z.array(z.string()).optional(),
});

const pushSchema = z.object({
  force: z.boolean().optional(),
});

// Create git service instance
let gitService: GitService | null = null;

function getGitService(): GitService {
  if (!gitService) {
    const config = getConfig();
    gitService = new GitService({
      config: config.git,
    });
  }
  return gitService;
}

export async function gitRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /development/:cycleId/git
   * Get git repository info for a development cycle
   */
  fastify.get<{
    Params: { cycleId: string };
  }>(
    '/development/:cycleId/git',
    async (request, reply) => {
      const { cycleId } = request.params;

      const gitRepo = await gitRepositoryRepository.findByCycleId(cycleId);

      if (!gitRepo) {
        return reply.status(404).send({
          success: false,
          error: 'Git repository not found for this cycle',
        });
      }

      return reply.send({
        success: true,
        data: gitRepo,
      });
    }
  );

  /**
   * POST /development/:cycleId/git/init
   * Initialize git repository for a development cycle
   */
  fastify.post<{
    Params: { cycleId: string };
    Body: { serviceName: string; description?: string };
  }>(
    '/development/:cycleId/git/init',
    async (request, reply) => {
      const { cycleId } = request.params;
      const { serviceName, description } = request.body;

      const service = getGitService();

      if (!service.isEnabled()) {
        return reply.status(400).send({
          success: false,
          error: 'Git integration is not enabled',
        });
      }

      logger.info({ cycleId, serviceName }, 'Initializing git repository');

      const result = await service.initializeRepository({
        developmentCycleId: cycleId,
        serviceName,
        description,
      });

      if (!result.success) {
        return reply.status(500).send({
          success: false,
          error: result.error,
        });
      }

      // Save repository info to database
      const gitRepo = await gitRepositoryRepository.create({
        developmentCycleId: cycleId,
        localPath: result.localPath,
        remoteUrl: result.remoteUrl,
      });

      return reply.status(201).send({
        success: true,
        data: gitRepo,
      });
    }
  );

  /**
   * GET /development/:cycleId/git/status
   * Get git repository status
   */
  fastify.get<{
    Params: { cycleId: string };
  }>(
    '/development/:cycleId/git/status',
    async (request, reply) => {
      const { cycleId } = request.params;

      const gitRepo = await gitRepositoryRepository.findByCycleId(cycleId);

      if (!gitRepo) {
        return reply.status(404).send({
          success: false,
          error: 'Git repository not found',
        });
      }

      const service = getGitService();
      const status = await service.getStatus(gitRepo.localPath);

      return reply.send({
        success: true,
        data: status,
      });
    }
  );

  /**
   * POST /development/:cycleId/git/commit
   * Commit changes
   */
  fastify.post<{
    Params: { cycleId: string };
    Body: z.infer<typeof commitSchema>;
  }>(
    '/development/:cycleId/git/commit',
    async (request, reply) => {
      const { cycleId } = request.params;
      const body = commitSchema.parse(request.body);

      const gitRepo = await gitRepositoryRepository.findByCycleId(cycleId);

      if (!gitRepo) {
        return reply.status(404).send({
          success: false,
          error: 'Git repository not found',
        });
      }

      logger.info({ cycleId, message: body.message }, 'Committing changes');

      const service = getGitService();
      const result = await service.commitChanges(gitRepo.localPath, {
        message: body.message,
        files: body.files,
      });

      if (!result.success) {
        return reply.status(500).send({
          success: false,
          error: result.error,
        });
      }

      // Update repository record
      if (result.commit) {
        await gitRepositoryRepository.recordCommit(
          gitRepo.id,
          result.commit.hash,
          result.commit.message,
          result.commit.date
        );
      }

      return reply.send({
        success: true,
        data: {
          commit: result.commit,
          pushed: result.pushed,
        },
      });
    }
  );

  /**
   * POST /development/:cycleId/git/push
   * Push to remote
   */
  fastify.post<{
    Params: { cycleId: string };
    Body: z.infer<typeof pushSchema>;
  }>(
    '/development/:cycleId/git/push',
    async (request, reply) => {
      const { cycleId } = request.params;
      const body = pushSchema.parse(request.body ?? {});

      const gitRepo = await gitRepositoryRepository.findByCycleId(cycleId);

      if (!gitRepo) {
        return reply.status(404).send({
          success: false,
          error: 'Git repository not found',
        });
      }

      if (!gitRepo.remoteUrl) {
        return reply.status(400).send({
          success: false,
          error: 'No remote configured for this repository',
        });
      }

      logger.info({ cycleId }, 'Pushing to remote');

      const service = getGitService();
      const result = await service.push(gitRepo.localPath, {
        force: body.force,
        setUpstream: true,
      });

      if (!result.success) {
        return reply.status(500).send({
          success: false,
          error: result.error,
        });
      }

      // Update repository record
      await gitRepositoryRepository.recordPush(gitRepo.id);

      return reply.send({
        success: true,
        message: 'Pushed to remote',
      });
    }
  );

  /**
   * GET /development/:cycleId/git/history
   * Get commit history
   */
  fastify.get<{
    Params: { cycleId: string };
    Querystring: { maxCount?: string; file?: string };
  }>(
    '/development/:cycleId/git/history',
    async (request, reply) => {
      const { cycleId } = request.params;
      const { maxCount, file } = request.query;

      const gitRepo = await gitRepositoryRepository.findByCycleId(cycleId);

      if (!gitRepo) {
        return reply.status(404).send({
          success: false,
          error: 'Git repository not found',
        });
      }

      const service = getGitService();
      const history = await service.getHistory(gitRepo.localPath, {
        maxCount: maxCount ? parseInt(maxCount, 10) : undefined,
        file,
      });

      return reply.send({
        success: true,
        data: history,
      });
    }
  );

  /**
   * GET /development/:cycleId/git/diff
   * Get diff for a commit or between commits
   */
  fastify.get<{
    Params: { cycleId: string };
    Querystring: { commit?: string; from?: string; to?: string; file?: string };
  }>(
    '/development/:cycleId/git/diff',
    async (request, reply) => {
      const { cycleId } = request.params;
      const { commit, from, to, file } = request.query;

      const gitRepo = await gitRepositoryRepository.findByCycleId(cycleId);

      if (!gitRepo) {
        return reply.status(404).send({
          success: false,
          error: 'Git repository not found',
        });
      }

      const service = getGitService();
      const diff = await service.getDiff(gitRepo.localPath, {
        commit,
        fromCommit: from,
        toCommit: to,
        file,
      });

      return reply.send({
        success: true,
        data: diff,
      });
    }
  );

  /**
   * GET /development/:cycleId/git/diff-patch
   * Get diff patch content for a file
   */
  fastify.get<{
    Params: { cycleId: string };
    Querystring: { file: string; commit?: string };
  }>(
    '/development/:cycleId/git/diff-patch',
    async (request, reply) => {
      const { cycleId } = request.params;
      const { file, commit } = request.query;

      if (!file) {
        return reply.status(400).send({
          success: false,
          error: 'File parameter is required',
        });
      }

      const gitRepo = await gitRepositoryRepository.findByCycleId(cycleId);

      if (!gitRepo) {
        return reply.status(404).send({
          success: false,
          error: 'Git repository not found',
        });
      }

      const service = getGitService();
      const patch = await service.getDiffPatch(gitRepo.localPath, {
        file,
        commit,
      });

      return reply.send({
        success: true,
        data: patch,
      });
    }
  );

  /**
   * POST /development/:cycleId/git/revert/:commitHash
   * Revert a specific commit
   */
  fastify.post<{
    Params: { cycleId: string; commitHash: string };
  }>(
    '/development/:cycleId/git/revert/:commitHash',
    async (request, reply) => {
      const { cycleId, commitHash } = request.params;

      const gitRepo = await gitRepositoryRepository.findByCycleId(cycleId);

      if (!gitRepo) {
        return reply.status(404).send({
          success: false,
          error: 'Git repository not found',
        });
      }

      logger.info({ cycleId, commitHash }, 'Reverting commit');

      const service = getGitService();
      const revertCommit = await service.revertCommit(gitRepo.localPath, commitHash);

      // Update repository record
      await gitRepositoryRepository.recordCommit(
        gitRepo.id,
        revertCommit.hash,
        revertCommit.message,
        revertCommit.date
      );

      return reply.send({
        success: true,
        data: revertCommit,
      });
    }
  );

  /**
   * GET /git/status
   * Get global git configuration status
   */
  fastify.get(
    '/git/status',
    async (_request, reply) => {
      const service = getGitService();
      const config = getConfig().git;

      const status: {
        enabled: boolean;
        provider: string;
        githubConfigured: boolean;
        githubUser?: string;
        error?: string;
      } = {
        enabled: config.enabled,
        provider: config.provider,
        githubConfigured: service.isGitHubConfigured(),
      };

      if (service.isGitHubConfigured()) {
        const verification = await service.verifyGitHubCredentials();
        if (verification.valid) {
          status.githubUser = verification.user;
        } else {
          status.error = verification.error;
        }
      }

      return reply.send({
        success: true,
        data: status,
      });
    }
  );
}

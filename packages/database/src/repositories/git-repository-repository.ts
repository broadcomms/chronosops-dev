/**
 * Git Repository Repository
 * Tracks Git repository info for development cycles
 */

import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getDatabase } from '../connection.js';
import { gitRepositories } from '../schema.js';

export type GitRepoStatus = 'initialized' | 'active' | 'synced' | 'error';

export interface CreateGitRepoInput {
  developmentCycleId: string;
  localPath: string;
  currentBranch?: string;
  remoteUrl?: string;
  remoteName?: string;
  githubRepoId?: number;
  githubRepoFullName?: string;
}

export interface UpdateGitRepoInput {
  currentBranch?: string;
  remoteUrl?: string;
  remoteName?: string;
  githubRepoId?: number;
  githubRepoFullName?: string;
  lastCommitHash?: string;
  lastCommitMessage?: string;
  lastCommitDate?: Date;
  lastPushDate?: Date;
  status?: GitRepoStatus;
  errorMessage?: string;
}

export interface GitRepositoryRecord {
  id: string;
  developmentCycleId: string;
  localPath: string;
  currentBranch: string;
  remoteUrl: string | null;
  remoteName: string | null;
  githubRepoId: number | null;
  githubRepoFullName: string | null;
  lastCommitHash: string | null;
  lastCommitMessage: string | null;
  lastCommitDate: Date | null;
  lastPushDate: Date | null;
  status: GitRepoStatus;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class GitRepositoryRepository {
  /**
   * Create a new git repository record
   */
  async create(input: CreateGitRepoInput): Promise<GitRepositoryRecord> {
    const db = getDatabase();
    const now = new Date();

    const repo: typeof gitRepositories.$inferInsert = {
      id: randomUUID(),
      developmentCycleId: input.developmentCycleId,
      localPath: input.localPath,
      currentBranch: input.currentBranch ?? 'main',
      remoteUrl: input.remoteUrl,
      remoteName: input.remoteName ?? 'origin',
      githubRepoId: input.githubRepoId,
      githubRepoFullName: input.githubRepoFullName,
      status: 'initialized',
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(gitRepositories).values(repo);

    return this.mapToRecord(repo as typeof gitRepositories.$inferSelect);
  }

  /**
   * Get git repository by ID
   */
  async findById(id: string): Promise<GitRepositoryRecord | null> {
    const db = getDatabase();
    const result = await db.select().from(gitRepositories).where(eq(gitRepositories.id, id)).limit(1);
    const row = result[0];
    return row ? this.mapToRecord(row) : null;
  }

  /**
   * Get git repository by development cycle ID
   */
  async findByCycleId(developmentCycleId: string): Promise<GitRepositoryRecord | null> {
    const db = getDatabase();
    const result = await db
      .select()
      .from(gitRepositories)
      .where(eq(gitRepositories.developmentCycleId, developmentCycleId))
      .limit(1);

    const row = result[0];
    return row ? this.mapToRecord(row) : null;
  }

  /**
   * Update a git repository record
   */
  async update(id: string, input: UpdateGitRepoInput): Promise<GitRepositoryRecord | null> {
    const db = getDatabase();
    const now = new Date();

    const updateData: Partial<typeof gitRepositories.$inferInsert> = {
      updatedAt: now,
    };

    if (input.currentBranch !== undefined) updateData.currentBranch = input.currentBranch;
    if (input.remoteUrl !== undefined) updateData.remoteUrl = input.remoteUrl;
    if (input.remoteName !== undefined) updateData.remoteName = input.remoteName;
    if (input.githubRepoId !== undefined) updateData.githubRepoId = input.githubRepoId;
    if (input.githubRepoFullName !== undefined) updateData.githubRepoFullName = input.githubRepoFullName;
    if (input.lastCommitHash !== undefined) updateData.lastCommitHash = input.lastCommitHash;
    if (input.lastCommitMessage !== undefined) updateData.lastCommitMessage = input.lastCommitMessage;
    if (input.lastCommitDate !== undefined) updateData.lastCommitDate = input.lastCommitDate;
    if (input.lastPushDate !== undefined) updateData.lastPushDate = input.lastPushDate;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.errorMessage !== undefined) updateData.errorMessage = input.errorMessage;

    await db.update(gitRepositories).set(updateData).where(eq(gitRepositories.id, id));

    return this.findById(id);
  }

  /**
   * Update by cycle ID
   */
  async updateByCycleId(developmentCycleId: string, input: UpdateGitRepoInput): Promise<GitRepositoryRecord | null> {
    const repo = await this.findByCycleId(developmentCycleId);
    if (!repo) return null;
    return this.update(repo.id, input);
  }

  /**
   * Record a commit
   */
  async recordCommit(
    id: string,
    commitHash: string,
    commitMessage: string,
    commitDate: Date
  ): Promise<GitRepositoryRecord | null> {
    return this.update(id, {
      lastCommitHash: commitHash,
      lastCommitMessage: commitMessage,
      lastCommitDate: commitDate,
      status: 'active',
    });
  }

  /**
   * Record a push
   */
  async recordPush(id: string): Promise<GitRepositoryRecord | null> {
    return this.update(id, {
      lastPushDate: new Date(),
      status: 'synced',
    });
  }

  /**
   * Set error status
   */
  async setError(id: string, errorMessage: string): Promise<GitRepositoryRecord | null> {
    return this.update(id, {
      status: 'error',
      errorMessage,
    });
  }

  /**
   * Clear error status
   */
  async clearError(id: string): Promise<GitRepositoryRecord | null> {
    return this.update(id, {
      status: 'active',
      errorMessage: undefined,
    });
  }

  /**
   * Delete a git repository record
   */
  async delete(id: string): Promise<boolean> {
    const db = getDatabase();
    const result = await db.delete(gitRepositories).where(eq(gitRepositories.id, id));
    return result.changes > 0;
  }

  /**
   * Delete by cycle ID
   */
  async deleteByCycleId(developmentCycleId: string): Promise<boolean> {
    const db = getDatabase();
    const result = await db.delete(gitRepositories).where(eq(gitRepositories.developmentCycleId, developmentCycleId));
    return result.changes > 0;
  }

  /**
   * Check if a cycle has a git repository
   */
  async existsForCycle(developmentCycleId: string): Promise<boolean> {
    const repo = await this.findByCycleId(developmentCycleId);
    return repo !== null;
  }

  /**
   * Map database result to record type
   */
  private mapToRecord(row: typeof gitRepositories.$inferSelect): GitRepositoryRecord {
    return {
      id: row.id,
      developmentCycleId: row.developmentCycleId,
      localPath: row.localPath,
      currentBranch: row.currentBranch,
      remoteUrl: row.remoteUrl,
      remoteName: row.remoteName,
      githubRepoId: row.githubRepoId,
      githubRepoFullName: row.githubRepoFullName,
      lastCommitHash: row.lastCommitHash,
      lastCommitMessage: row.lastCommitMessage,
      lastCommitDate: row.lastCommitDate,
      lastPushDate: row.lastPushDate,
      status: row.status as GitRepoStatus,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

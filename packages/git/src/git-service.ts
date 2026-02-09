/**
 * Git Service
 * High-level service coordinating local git and GitHub operations
 */

import { createLogger, Logger } from '@chronosops/shared';
import { LocalGitClient } from './client/local-git-client.js';
import { GitHubClient } from './client/github-client.js';
import {
  GitConfig,
  GitCommitInfo,
  GitDiffInfo,
  GitStatusInfo,
  CreateRepoOptions,
  CommitOptions,
  PushOptions,
  DEFAULT_GIT_CONFIG,
} from './types.js';

export interface GitServiceOptions {
  config?: Partial<GitConfig>;
  logger?: Logger;
}

export interface InitRepoResult {
  success: boolean;
  localPath: string;
  remoteUrl?: string;
  error?: string;
}

export interface CommitAndPushResult {
  success: boolean;
  commit?: GitCommitInfo;
  pushed?: boolean;
  error?: string;
}

export class GitService {
  private readonly config: GitConfig;
  private readonly logger: Logger;
  private readonly localGit: LocalGitClient;
  private readonly github: GitHubClient;

  constructor(options: GitServiceOptions = {}) {
    this.config = { ...DEFAULT_GIT_CONFIG, ...options.config };
    this.logger = options.logger ?? createLogger('GitService');
    
    this.localGit = new LocalGitClient({
      config: this.config,
      logger: this.logger,
    });
    
    this.github = new GitHubClient({
      config: this.config,
      logger: this.logger,
    });
  }

  /**
   * Check if Git is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Check if GitHub is configured
   */
  isGitHubConfigured(): boolean {
    return this.github.isConfigured();
  }

  /**
   * Initialize a repository for a development cycle
   * Creates local repo and optionally GitHub remote
   */
  async initializeRepository(options: CreateRepoOptions): Promise<InitRepoResult> {
    const localPath = this.localGit.buildRepoPath(options.serviceName);
    
    this.logger.info(
      { serviceName: options.serviceName, localPath, provider: this.config.provider },
      'Initializing repository'
    );

    try {
      // Check if already initialized
      const isRepo = await this.localGit.isGitRepo(localPath);
      if (isRepo) {
        this.logger.info({ localPath }, 'Repository already initialized');
        return { success: true, localPath };
      }

      // Initialize local repository
      await this.localGit.init(localPath);

      // If GitHub is configured, create remote repo and link
      if (this.config.provider === 'github' && this.github.isConfigured()) {
        const repoResult = await this.github.createRepo(options);
        
        if (repoResult.success && repoResult.repo) {
          // Add remote to local repo
          const remoteUrl = this.github.getAuthenticatedCloneUrl(repoResult.repo.name);
          await this.localGit.addRemote(localPath, 'origin', remoteUrl);
          
          this.logger.info({ localPath, remoteUrl: repoResult.repo.htmlUrl }, 'GitHub remote linked');
          
          return {
            success: true,
            localPath,
            remoteUrl: repoResult.repo.htmlUrl,
          };
        } else {
          // GitHub creation failed, but local repo is ok
          this.logger.warn(
            { error: repoResult.error },
            'GitHub repo creation failed, continuing with local only'
          );
        }
      }

      return { success: true, localPath };
    } catch (error: unknown) {
      const err = error as { message?: string };
      const errorMessage = err.message ?? 'Unknown error initializing repository';
      this.logger.error({ error: errorMessage, localPath }, 'Failed to initialize repository');
      return { success: false, localPath, error: errorMessage };
    }
  }

  /**
   * Commit all changes in a repository
   */
  async commitChanges(
    localPath: string,
    options: CommitOptions
  ): Promise<CommitAndPushResult> {
    try {
      // Stage all changes
      await this.localGit.add(localPath, '.');
      
      // Check if there are changes to commit
      const status = await this.localGit.status(localPath);
      if (status.staged.length === 0 && status.modified.length === 0 && status.untracked.length === 0) {
        this.logger.info({ localPath }, 'No changes to commit');
        return { success: true, pushed: false };
      }

      // Commit changes
      const commit = await this.localGit.commit(localPath, options);
      
      // Push if configured and GitHub is available
      let pushed = false;
      if (this.config.autoPush && this.config.provider === 'github') {
        try {
          await this.localGit.push(localPath, { setUpstream: true });
          pushed = true;
          this.logger.info({ localPath, commitHash: commit.shortHash }, 'Changes pushed to remote');
        } catch (pushError: unknown) {
          const err = pushError as { message?: string };
          this.logger.warn(
            { error: err.message, localPath },
            'Failed to push, commit saved locally'
          );
        }
      }

      return { success: true, commit, pushed };
    } catch (error: unknown) {
      const err = error as { message?: string };
      const errorMessage = err.message ?? 'Unknown error committing changes';
      this.logger.error({ error: errorMessage, localPath }, 'Failed to commit changes');
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Push changes to remote
   */
  async push(localPath: string, options?: PushOptions): Promise<{ success: boolean; error?: string }> {
    try {
      await this.localGit.push(localPath, options);
      return { success: true };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return { success: false, error: err.message ?? 'Push failed' };
    }
  }

  /**
   * Get repository status
   */
  async getStatus(localPath: string): Promise<GitStatusInfo> {
    return this.localGit.status(localPath);
  }

  /**
   * Get commit history
   */
  async getHistory(
    localPath: string,
    options?: { maxCount?: number; file?: string }
  ): Promise<GitCommitInfo[]> {
    return this.localGit.log(localPath, options);
  }

  /**
   * Get diff for commits
   */
  async getDiff(
    localPath: string,
    options?: { commit?: string; fromCommit?: string; toCommit?: string; file?: string }
  ): Promise<GitDiffInfo[]> {
    return this.localGit.diff(localPath, options);
  }

  /**
   * Get diff patch content
   */
  async getDiffPatch(localPath: string, options: { commit?: string; file: string }): Promise<string> {
    return this.localGit.diffPatch(localPath, options);
  }

  /**
   * Revert a specific commit
   */
  async revertCommit(localPath: string, commitHash: string): Promise<GitCommitInfo> {
    return this.localGit.revert(localPath, commitHash);
  }

  /**
   * Reset to a specific commit
   */
  async resetToCommit(
    localPath: string,
    commitHash: string,
    mode: 'soft' | 'mixed' | 'hard' = 'hard'
  ): Promise<void> {
    return this.localGit.reset(localPath, commitHash, mode);
  }

  /**
   * Delete a repository (local and optionally remote)
   * @param localPath - Direct path to the local repository
   * @param options - Deletion options
   */
  async deleteRepository(
    localPath: string,
    options?: { deleteRemote?: boolean; keepLocalFiles?: boolean }
  ): Promise<{ success: boolean; localDeleted?: boolean; remoteDeleted?: boolean; error?: string }> {
    let localDeleted = false;
    let remoteDeleted = false;
    const errors: string[] = [];

    // Delete local repository
    try {
      await this.localGit.deleteRepo(localPath, { keepFiles: options?.keepLocalFiles });
      localDeleted = true;
    } catch (error: unknown) {
      const err = error as { message?: string };
      errors.push(`Local deletion failed: ${err.message}`);
    }

    // Delete GitHub repository if requested and configured
    if (options?.deleteRemote && this.github.isConfigured()) {
      // Extract repo name from path
      const pathParts = localPath.split('/');
      const repoName = pathParts[pathParts.length - 1];
      
      if (repoName) {
        const result = await this.github.deleteRepo(repoName);
        if (result.success) {
          remoteDeleted = true;
        } else {
          errors.push(`GitHub deletion failed: ${result.error}`);
        }
      }
    }

    return {
      success: errors.length === 0,
      localDeleted,
      remoteDeleted,
      error: errors.length > 0 ? errors.join('; ') : undefined,
    };
  }

  /**
   * Get the local repository path for a service
   */
  getLocalPath(serviceName: string): string {
    return this.localGit.buildRepoPath(serviceName);
  }

  /**
   * Get GitHub clone URL for a service
   */
  getGitHubUrl(serviceName: string): string | null {
    if (!this.github.isConfigured()) return null;
    return this.github.getCloneUrl(this.github.buildRepoName(serviceName));
  }

  /**
   * Verify GitHub credentials
   */
  async verifyGitHubCredentials(): Promise<{ valid: boolean; user?: string; error?: string }> {
    return this.github.verifyCredentials();
  }

  /**
   * Check if a local path is a git repository
   */
  async isGitRepo(localPath: string): Promise<boolean> {
    return this.localGit.isGitRepo(localPath);
  }
}

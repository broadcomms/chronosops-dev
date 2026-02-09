/**
 * Local Git Client
 * Handles local git operations using simple-git
 */

import simpleGit, { SimpleGit, SimpleGitOptions } from 'simple-git';
import { mkdir, rm } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { createLogger, Logger } from '@chronosops/shared';
import {
  GitConfig,
  GitCommitInfo,
  GitDiffInfo,
  GitStatusInfo,
  CommitOptions,
  DEFAULT_GIT_CONFIG,
} from '../types.js';

export interface LocalGitClientOptions {
  config?: Partial<GitConfig>;
  logger?: Logger;
}

export class LocalGitClient {
  private readonly config: GitConfig;
  private readonly logger: Logger;

  constructor(options: LocalGitClientOptions = {}) {
    this.config = { ...DEFAULT_GIT_CONFIG, ...options.config };
    this.logger = options.logger ?? createLogger('LocalGitClient');
  }

  /**
   * Get a simple-git instance for a repository path
   */
  private getGit(repoPath: string): SimpleGit {
    const options: Partial<SimpleGitOptions> = {
      baseDir: repoPath,
      binary: 'git',
      maxConcurrentProcesses: 1,
      trimmed: true,
    };
    return simpleGit(options);
  }

  /**
   * Check if a directory is a git repository
   */
  async isGitRepo(path: string): Promise<boolean> {
    try {
      const git = this.getGit(path);
      await git.status();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Initialize a new git repository
   */
  async init(repoPath: string, options?: { defaultBranch?: string }): Promise<void> {
    const defaultBranch = options?.defaultBranch ?? this.config.defaultBranch;
    
    this.logger.info({ repoPath, defaultBranch }, 'Initializing git repository');

    // Ensure directory exists
    await mkdir(repoPath, { recursive: true });

    const git = this.getGit(repoPath);
    
    // Initialize with specific branch name
    await git.init(['--initial-branch', defaultBranch]);
    
    // Configure git user for this repo (required for commits)
    await git.addConfig('user.email', 'chronosops@localhost', false);
    await git.addConfig('user.name', 'ChronosOps', false);

    this.logger.info({ repoPath }, 'Git repository initialized');
  }

  /**
   * Clone a remote repository
   */
  async clone(remoteUrl: string, localPath: string): Promise<void> {
    this.logger.info({ remoteUrl, localPath }, 'Cloning repository');

    // Ensure parent directory exists
    await mkdir(dirname(localPath), { recursive: true });

    const git = simpleGit();
    await git.clone(remoteUrl, localPath);

    // Configure git user for cloned repo
    const repoGit = this.getGit(localPath);
    await repoGit.addConfig('user.email', 'chronosops@localhost', false);
    await repoGit.addConfig('user.name', 'ChronosOps', false);

    this.logger.info({ localPath }, 'Repository cloned');
  }

  /**
   * Get repository status
   */
  async status(repoPath: string): Promise<GitStatusInfo> {
    const git = this.getGit(repoPath);
    const status = await git.status();

    return {
      isClean: status.isClean(),
      current: status.current ?? this.config.defaultBranch,
      tracking: status.tracking ?? undefined,
      ahead: status.ahead,
      behind: status.behind,
      modified: status.modified,
      staged: status.staged,
      untracked: status.not_added,
      deleted: status.deleted,
    };
  }

  /**
   * Stage files for commit
   */
  async add(repoPath: string, files: string[] | '.'): Promise<void> {
    const git = this.getGit(repoPath);
    
    if (files === '.') {
      await git.add('.');
    } else {
      await git.add(files);
    }

    this.logger.debug({ repoPath, files }, 'Files staged');
  }

  /**
   * Commit staged changes
   */
  async commit(repoPath: string, options: CommitOptions): Promise<GitCommitInfo> {
    const git = this.getGit(repoPath);

    // Configure author if provided
    if (options.author) {
      await git.addConfig('user.email', options.author.email, false);
      await git.addConfig('user.name', options.author.name, false);
    }

    // Stage specific files if provided
    if (options.files && options.files.length > 0) {
      await git.add(options.files);
    }

    // Create commit
    const result = await git.commit(options.message);

    this.logger.info(
      { repoPath, commit: result.commit, message: options.message },
      'Changes committed'
    );

    // Get commit details
    const log = await git.log({ maxCount: 1 });
    const latest = log.latest!;

    return {
      hash: latest.hash,
      shortHash: latest.hash.substring(0, 7),
      message: latest.message,
      author: latest.author_name,
      authorEmail: latest.author_email,
      date: new Date(latest.date),
      filesChanged: result.summary.changes,
      insertions: result.summary.insertions,
      deletions: result.summary.deletions,
    };
  }

  /**
   * Get commit history
   */
  async log(repoPath: string, options?: { maxCount?: number; file?: string }): Promise<GitCommitInfo[]> {
    const git = this.getGit(repoPath);
    
    const logOptions: { maxCount?: number; file?: string } = {};
    if (options?.maxCount) logOptions.maxCount = options.maxCount;
    if (options?.file) logOptions.file = options.file;

    const log = await git.log(logOptions);

    return log.all.map((entry: { hash: string; message: string; author_name: string; author_email: string; date: string }) => ({
      hash: entry.hash,
      shortHash: entry.hash.substring(0, 7),
      message: entry.message,
      author: entry.author_name,
      authorEmail: entry.author_email,
      date: new Date(entry.date),
      // simple-git log doesn't include file change stats by default
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
    }));
  }

  /**
   * Get diff for a specific commit or between commits
   */
  async diff(
    repoPath: string,
    options?: { commit?: string; fromCommit?: string; toCommit?: string; file?: string }
  ): Promise<GitDiffInfo[]> {
    const git = this.getGit(repoPath);
    
    let diffArgs: string[] = ['--numstat', '--name-status'];
    
    if (options?.fromCommit && options?.toCommit) {
      diffArgs.push(`${options.fromCommit}..${options.toCommit}`);
    } else if (options?.commit) {
      diffArgs.push(`${options.commit}^`, options.commit);
    }
    
    if (options?.file) {
      diffArgs.push('--', options.file);
    }

    const result = await git.diff(diffArgs);
    
    // Parse the diff output
    return this.parseDiffOutput(result);
  }

  /**
   * Get diff patch content for a file
   */
  async diffPatch(
    repoPath: string,
    options: { commit?: string; file: string }
  ): Promise<string> {
    const git = this.getGit(repoPath);
    
    const diffArgs: string[] = [];
    if (options.commit) {
      diffArgs.push(`${options.commit}^`, options.commit);
    }
    diffArgs.push('--', options.file);

    return git.diff(diffArgs);
  }

  /**
   * Checkout a branch or commit
   */
  async checkout(repoPath: string, target: string, options?: { create?: boolean }): Promise<void> {
    const git = this.getGit(repoPath);
    
    if (options?.create) {
      await git.checkoutBranch(target, 'HEAD');
    } else {
      await git.checkout(target);
    }

    this.logger.info({ repoPath, target }, 'Checked out');
  }

  /**
   * Revert to a specific commit
   */
  async revert(repoPath: string, commitHash: string): Promise<GitCommitInfo> {
    const git = this.getGit(repoPath);
    
    this.logger.info({ repoPath, commitHash }, 'Reverting commit');
    
    await git.revert(commitHash, { '--no-edit': null });
    
    // Get the revert commit details
    const log = await git.log({ maxCount: 1 });
    const latest = log.latest!;

    return {
      hash: latest.hash,
      shortHash: latest.hash.substring(0, 7),
      message: latest.message,
      author: latest.author_name,
      authorEmail: latest.author_email,
      date: new Date(latest.date),
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
    };
  }

  /**
   * Hard reset to a specific commit
   */
  async reset(repoPath: string, commitHash: string, mode: 'soft' | 'mixed' | 'hard' = 'hard'): Promise<void> {
    const git = this.getGit(repoPath);
    
    this.logger.info({ repoPath, commitHash, mode }, 'Resetting to commit');
    
    await git.reset([`--${mode}`, commitHash]);
  }

  /**
   * Add a remote
   */
  async addRemote(repoPath: string, name: string, url: string): Promise<void> {
    const git = this.getGit(repoPath);
    await git.addRemote(name, url);
    this.logger.info({ repoPath, name, url }, 'Remote added');
  }

  /**
   * Set remote URL
   */
  async setRemoteUrl(repoPath: string, name: string, url: string): Promise<void> {
    const git = this.getGit(repoPath);
    await git.remote(['set-url', name, url]);
  }

  /**
   * Push to remote
   */
  async push(
    repoPath: string,
    options?: { remote?: string; branch?: string; force?: boolean; setUpstream?: boolean }
  ): Promise<void> {
    const git = this.getGit(repoPath);
    
    const pushArgs: string[] = [];
    
    if (options?.force) pushArgs.push('--force');
    if (options?.setUpstream) pushArgs.push('-u');
    
    const remote = options?.remote ?? 'origin';
    const branch = options?.branch ?? this.config.defaultBranch;
    
    pushArgs.push(remote, branch);
    
    this.logger.info({ repoPath, remote, branch }, 'Pushing to remote');
    
    await git.push(pushArgs);
    
    this.logger.info({ repoPath, remote, branch }, 'Push completed');
  }

  /**
   * Pull from remote
   */
  async pull(repoPath: string, options?: { remote?: string; branch?: string }): Promise<void> {
    const git = this.getGit(repoPath);
    
    const remote = options?.remote ?? 'origin';
    const branch = options?.branch ?? this.config.defaultBranch;
    
    this.logger.info({ repoPath, remote, branch }, 'Pulling from remote');
    
    await git.pull(remote, branch);
  }

  /**
   * Fetch from remote
   */
  async fetch(repoPath: string, options?: { remote?: string; prune?: boolean }): Promise<void> {
    const git = this.getGit(repoPath);
    
    const fetchArgs: string[] = [];
    if (options?.prune) fetchArgs.push('--prune');
    if (options?.remote) fetchArgs.push(options.remote);
    
    await git.fetch(fetchArgs);
  }

  /**
   * Delete a repository (removes .git and optionally all files)
   */
  async deleteRepo(repoPath: string, options?: { keepFiles?: boolean }): Promise<void> {
    this.logger.info({ repoPath, keepFiles: options?.keepFiles }, 'Deleting repository');

    if (options?.keepFiles) {
      // Only remove .git directory
      const gitDir = join(repoPath, '.git');
      await rm(gitDir, { recursive: true, force: true });
    } else {
      // Remove entire directory
      await rm(repoPath, { recursive: true, force: true });
    }

    this.logger.info({ repoPath }, 'Repository deleted');
  }

  /**
   * Get the repository name from path
   */
  getRepoName(repoPath: string): string {
    return basename(repoPath);
  }

  /**
   * Build repository path from service name
   */
  buildRepoPath(serviceName: string): string {
    let repoName: string;
    
    if (this.config.repoNamingPattern === 'chronosops-{serviceName}') {
      repoName = `chronosops-${serviceName}`;
    } else if (this.config.customRepoPrefix) {
      repoName = `${this.config.customRepoPrefix}${serviceName}`;
    } else {
      repoName = serviceName;
    }
    
    return join(this.config.localBasePath, repoName);
  }

  /**
   * Parse git diff output into structured format
   */
  private parseDiffOutput(output: string): GitDiffInfo[] {
    const lines = output.trim().split('\n').filter(Boolean);
    const results: GitDiffInfo[] = [];
    
    // Parse --numstat output (additions, deletions, filename)
    // followed by --name-status output (status, filename)
    const numstatRegex = /^(\d+|-)\t(\d+|-)\t(.+)$/;
    const nameStatusRegex = /^([AMDRT])\t(.+?)(?:\t(.+))?$/;
    
    for (const line of lines) {
      const numstatMatch = line.match(numstatRegex);
      if (numstatMatch) {
        const add = numstatMatch[1] ?? '0';
        const del = numstatMatch[2] ?? '0';
        const file = numstatMatch[3] ?? '';
        // Check if we already have this file from name-status
        const existing = results.find((r) => r.file === file);
        if (existing) {
          existing.additions = add === '-' ? 0 : parseInt(add, 10);
          existing.deletions = del === '-' ? 0 : parseInt(del, 10);
        } else {
          results.push({
            file,
            status: 'modified',
            additions: add === '-' ? 0 : parseInt(add, 10),
            deletions: del === '-' ? 0 : parseInt(del, 10),
          });
        }
        continue;
      }
      
      const nameStatusMatch = line.match(nameStatusRegex);
      if (nameStatusMatch) {
        const status = nameStatusMatch[1] ?? 'M';
        const file = nameStatusMatch[2] ?? '';
        const oldFile = nameStatusMatch[3];
        const statusMap: Record<string, GitDiffInfo['status']> = {
          A: 'added',
          M: 'modified',
          D: 'deleted',
          R: 'renamed',
          T: 'modified', // Type change
        };
        
        const existing = results.find((r) => r.file === file);
        if (existing) {
          existing.status = statusMap[status] ?? 'modified';
          if (oldFile) existing.oldPath = oldFile;
        } else {
          results.push({
            file,
            status: statusMap[status] ?? 'modified',
            oldPath: oldFile,
            additions: 0,
            deletions: 0,
          });
        }
      }
    }
    
    return results;
  }
}

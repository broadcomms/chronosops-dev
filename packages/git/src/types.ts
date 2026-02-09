/**
 * Git Configuration Types
 */

export interface GitConfig {
  /** Enable Git integration */
  enabled: boolean;
  /** Git provider: github or local-only */
  provider: 'github' | 'local';
  /** GitHub personal access token (required for github provider) */
  githubToken?: string;
  /** GitHub organization/user for repo creation */
  githubOrg?: string;
  /** Base path for local git repositories */
  localBasePath: string;
  /** Repository naming pattern */
  repoNamingPattern: 'chronosops-{serviceName}' | 'custom';
  /** Custom repo prefix if pattern is custom */
  customRepoPrefix?: string;
  /** Auto-commit on successful deployment */
  autoCommitOnDeploy: boolean;
  /** Auto-push to remote after commit */
  autoPush: boolean;
  /** Default branch name */
  defaultBranch: string;
}

export interface GitRepositoryInfo {
  id: string;
  developmentCycleId: string;
  localPath: string;
  remoteUrl?: string;
  remoteName?: string;
  currentBranch: string;
  lastCommitHash?: string;
  lastCommitMessage?: string;
  lastCommitDate?: Date;
  lastPushDate?: Date;
  status: 'initialized' | 'active' | 'synced' | 'error';
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GitCommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  authorEmail: string;
  date: Date;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface GitDiffInfo {
  file: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  oldPath?: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface GitStatusInfo {
  isClean: boolean;
  current: string;
  tracking?: string;
  ahead: number;
  behind: number;
  modified: string[];
  staged: string[];
  untracked: string[];
  deleted: string[];
}

export interface CreateRepoOptions {
  developmentCycleId: string;
  serviceName: string;
  description?: string;
  isPrivate?: boolean;
  initializeWithReadme?: boolean;
}

export interface CommitOptions {
  message: string;
  files?: string[];
  author?: {
    name: string;
    email: string;
  };
}

export interface PushOptions {
  force?: boolean;
  setUpstream?: boolean;
  remoteName?: string;
  branch?: string;
}

export const DEFAULT_GIT_CONFIG: GitConfig = {
  enabled: false,
  provider: 'local',
  localBasePath: './generated',
  repoNamingPattern: 'chronosops-{serviceName}',
  autoCommitOnDeploy: true,
  autoPush: false,
  defaultBranch: 'main',
};

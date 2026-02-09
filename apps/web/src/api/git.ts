/**
 * Git API endpoints
 */
import { apiClient } from './client';
import type { ApiResponse } from '../types';

// Git types
export type GitRepoStatus = 'initialized' | 'active' | 'synced' | 'error';

export interface GitRepository {
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
  lastCommitDate: string | null;
  lastPushDate: string | null;
  status: GitRepoStatus;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface GitFileStatus {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked';
}

export interface GitStatusResult {
  hasChanges: boolean;
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  untracked: string[];
  currentBranch: string;
  ahead: number;
  behind: number;
}

export interface GitGlobalStatus {
  enabled: boolean;
  provider: 'local' | 'github';
  githubConfigured: boolean;
  githubUser?: string;
  error?: string;
}

/**
 * Git API
 */
export const gitApi = {
  /**
   * Get global git configuration status
   */
  getGlobalStatus: () => apiClient<ApiResponse<GitGlobalStatus>>('/api/v1/git/status'),

  /**
   * Initialize git repository for a development cycle
   */
  initRepo: (cycleId: string, options?: { createGitHub?: boolean; repoName?: string }) =>
    apiClient<ApiResponse<GitRepository>>(`/api/v1/development/${cycleId}/git/init`, {
      method: 'POST',
      body: JSON.stringify(options ?? {}),
    }),

  /**
   * Get git status for a development cycle
   */
  getStatus: (cycleId: string) =>
    apiClient<ApiResponse<{ repository: GitRepository; status: GitStatusResult }>>(
      `/api/v1/development/${cycleId}/git/status`
    ),

  /**
   * Commit current changes
   */
  commit: (cycleId: string, message: string) =>
    apiClient<ApiResponse<GitCommit>>(`/api/v1/development/${cycleId}/git/commit`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  /**
   * Push to remote
   */
  push: (cycleId: string) =>
    apiClient<ApiResponse<{ pushed: boolean; remote: string }>>(`/api/v1/development/${cycleId}/git/push`, {
      method: 'POST',
    }),

  /**
   * Get commit history
   */
  getHistory: (cycleId: string, limit?: number) =>
    apiClient<ApiResponse<GitCommit[]>>(
      `/api/v1/development/${cycleId}/git/history${limit ? `?limit=${limit}` : ''}`
    ),

  /**
   * Get diff for unstaged changes
   */
  getDiff: (cycleId: string, filePath?: string) =>
    apiClient<ApiResponse<string>>(
      `/api/v1/development/${cycleId}/git/diff${filePath ? `?file=${encodeURIComponent(filePath)}` : ''}`
    ),

  /**
   * Get diff as patch format
   */
  getDiffPatch: (cycleId: string, filePath?: string) =>
    apiClient<ApiResponse<{ patch: string; files: string[] }>>(
      `/api/v1/development/${cycleId}/git/diff-patch${filePath ? `?file=${encodeURIComponent(filePath)}` : ''}`
    ),

  /**
   * Revert to a specific commit
   */
  revert: (cycleId: string, commitHash: string) =>
    apiClient<ApiResponse<GitCommit>>(`/api/v1/development/${cycleId}/git/revert/${commitHash}`, {
      method: 'POST',
    }),
};

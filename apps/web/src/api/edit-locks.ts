/**
 * Edit Locks API endpoints
 */
import { apiClient } from './client';
import type { ApiResponse } from '../types';

// Lock types
export interface EditLock {
  id: string;
  developmentCycleId: string;
  lockedBy: string;
  lockedByName: string | null;
  lockType: 'edit' | 'evolution';
  scope: 'file' | 'project';
  lockedFiles: string[] | null;
  acquiredAt: string;
  expiresAt: string;
  lastHeartbeat: string;
  extensionCount: number;
  status: 'active' | 'expired' | 'released';
  localBackup: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LockInfo {
  isLocked: boolean;
  lock?: EditLock;
  isOwnLock: boolean;
  remainingMs: number;
  canExtend: boolean;
}

export interface AcquireLockRequest {
  userId: string;
  userName?: string;
  lockType?: 'edit' | 'evolution';
  scope?: 'file' | 'project';
  files?: string[];
}

export interface HeartbeatRequest {
  userId: string;
}

export interface ReleaseLockRequest {
  userId: string;
}

export interface SaveBackupRequest {
  changes: Record<string, string>;
}

export interface UpdateFileRequest {
  content: string;
  userId: string;
}

/**
 * Edit Locks API
 */
export const editLocksApi = {
  /**
   * Get lock status for a development cycle
   */
  getLockInfo: (cycleId: string, userId: string) =>
    apiClient<ApiResponse<LockInfo>>(
      `/api/v1/development/${cycleId}/lock?userId=${encodeURIComponent(userId)}`
    ),

  /**
   * Acquire a lock on a development cycle
   */
  acquireLock: (cycleId: string, data: AcquireLockRequest) =>
    apiClient<ApiResponse<EditLock>>(`/api/v1/development/${cycleId}/lock`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /**
   * Send heartbeat to keep lock alive
   */
  heartbeat: (cycleId: string, lockId: string, data: HeartbeatRequest) =>
    apiClient<ApiResponse<{ lock: EditLock; extended: boolean }>>(
      `/api/v1/development/${cycleId}/lock/${lockId}/heartbeat`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    ),

  /**
   * Release a lock
   */
  releaseLock: (cycleId: string, lockId: string, data: ReleaseLockRequest) =>
    apiClient<{ success: boolean; message: string }>(
      `/api/v1/development/${cycleId}/lock/${lockId}`,
      {
        method: 'DELETE',
        body: JSON.stringify(data),
      }
    ),

  /**
   * Force release any lock (admin action)
   */
  forceReleaseLock: (cycleId: string, lockId: string) =>
    apiClient<{ success: boolean; message: string }>(
      `/api/v1/development/${cycleId}/lock/${lockId}/force`,
      {
        method: 'DELETE',
      }
    ),

  /**
   * Save local backup before lock expires
   */
  saveBackup: (cycleId: string, lockId: string, data: SaveBackupRequest) =>
    apiClient<{ success: boolean }>(`/api/v1/development/${cycleId}/lock/${lockId}/backup`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /**
   * Update a file (with lock validation)
   */
  updateFile: (cycleId: string, fileId: string, data: UpdateFileRequest) =>
    apiClient<ApiResponse<{ fileId: string; versionId: string; version: number }>>(
      `/api/v1/development/${cycleId}/files/${fileId}`,
      {
        method: 'PUT',
        body: JSON.stringify(data),
      }
    ),
};

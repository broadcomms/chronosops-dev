/**
 * File Versions API endpoints
 */
import { apiClient } from './client';
import type { ApiResponse } from '../types';

// Version types
export type ChangeType = 'create' | 'edit' | 'evolution' | 'revert';
export type ChangedBy = 'user' | 'ai' | 'system';

export interface FileVersion {
  id: string;
  generatedFileId: string;
  developmentCycleId: string;
  version: number;
  content: string;
  contentHash: string;
  changeType: ChangeType;
  changeDescription: string | null;
  changedBy: ChangedBy;
  evolutionId: string | null;
  commitHash: string | null;
  createdAt: string;
}

/**
 * File Versions API
 */
export const fileVersionsApi = {
  /**
   * Get version history for a file
   */
  getFileVersions: (cycleId: string, fileId: string) =>
    apiClient<ApiResponse<FileVersion[]>>(
      `/api/v1/development/${cycleId}/files/${fileId}/versions`
    ),

  /**
   * Get all versions for a development cycle
   */
  getCycleVersions: (cycleId: string) =>
    apiClient<ApiResponse<FileVersion[]>>(`/api/v1/development/${cycleId}/versions`),

  /**
   * Get a specific version
   */
  getVersion: (cycleId: string, fileId: string, versionId: string) =>
    apiClient<ApiResponse<FileVersion>>(
      `/api/v1/development/${cycleId}/files/${fileId}/versions/${versionId}`
    ),

  /**
   * Restore a file to a specific version
   */
  restoreVersion: (cycleId: string, fileId: string, versionId: string, userId: string) =>
    apiClient<ApiResponse<{ fileId: string; newVersionId: string; restoredFromVersion: number }>>(
      `/api/v1/development/${cycleId}/files/${fileId}/versions/${versionId}/restore`,
      {
        method: 'POST',
        body: JSON.stringify({ userId }),
      }
    ),

  /**
   * Compare two versions
   */
  compareVersions: (
    cycleId: string,
    fileId: string,
    fromVersionId: string,
    toVersionId: string
  ) =>
    apiClient<ApiResponse<{ from: FileVersion; to: FileVersion; diff: string }>>(
      `/api/v1/development/${cycleId}/files/${fileId}/versions/compare?from=${fromVersionId}&to=${toVersionId}`
    ),
};

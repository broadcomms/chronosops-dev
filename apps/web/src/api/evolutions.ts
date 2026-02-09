/**
 * Code Evolutions API endpoints
 */
import { apiClient } from './client';
import type { ApiResponse } from '../types';

// Evolution types
export type EvolutionStatus =
  | 'pending'
  | 'analyzing'
  | 'generating'
  | 'review'
  | 'approved'
  | 'rejected'
  | 'applied'
  | 'reverted'
  | 'failed';

export interface FileChange {
  path: string;
  changeType: 'create' | 'modify' | 'delete';
  oldContent?: string;
  newContent?: string;
  diff?: string;
}

export interface EvolutionAnalysis {
  impactLevel: 'low' | 'medium' | 'high';
  affectedFiles: string[];
  risks: string[];
  recommendations: string[];
}

export interface CodeEvolution {
  id: string;
  developmentCycleId: string;
  prompt: string;
  scope: string[] | null;
  status: EvolutionStatus;
  analysisResult: EvolutionAnalysis | null;
  proposedChanges: FileChange[] | null;
  filesAffected: number | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  appliedAt: string | null;
  appliedCommitHash: string | null;
  revertedAt: string | null;
  revertReason: string | null;
  revertCommitHash: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEvolutionRequest {
  prompt: string;
  scope?: string[];
  userId: string;
}

export interface ReviewEvolutionRequest {
  approved: boolean;
  notes?: string;
  userId: string;
}

/**
 * Code Evolutions API
 */
export const evolutionsApi = {
  /**
   * List evolutions for a development cycle
   */
  list: (cycleId: string) =>
    apiClient<ApiResponse<CodeEvolution[]>>(`/api/v1/development/${cycleId}/evolutions`),

  /**
   * Get a specific evolution
   */
  get: (cycleId: string, evolutionId: string) =>
    apiClient<ApiResponse<CodeEvolution>>(
      `/api/v1/development/${cycleId}/evolutions/${evolutionId}`
    ),

  /**
   * Create a new evolution request
   */
  create: (cycleId: string, data: CreateEvolutionRequest) =>
    apiClient<ApiResponse<CodeEvolution>>(`/api/v1/development/${cycleId}/evolutions`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /**
   * Start analyzing an evolution
   */
  analyze: (cycleId: string, evolutionId: string) =>
    apiClient<ApiResponse<CodeEvolution>>(
      `/api/v1/development/${cycleId}/evolutions/${evolutionId}/analyze`,
      { method: 'POST' }
    ),

  /**
   * Generate code changes for an evolution
   */
  generate: (cycleId: string, evolutionId: string) =>
    apiClient<ApiResponse<CodeEvolution>>(
      `/api/v1/development/${cycleId}/evolutions/${evolutionId}/generate`,
      { method: 'POST' }
    ),

  /**
   * Approve an evolution
   */
  approve: (cycleId: string, evolutionId: string, data: { reviewedBy: string; notes?: string }) =>
    apiClient<ApiResponse<CodeEvolution>>(
      `/api/v1/development/${cycleId}/evolutions/${evolutionId}/approve`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    ),

  /**
   * Reject an evolution
   */
  reject: (cycleId: string, evolutionId: string, data: { reviewedBy: string; notes?: string }) =>
    apiClient<ApiResponse<CodeEvolution>>(
      `/api/v1/development/${cycleId}/evolutions/${evolutionId}/reject`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    ),

  /**
   * Apply approved evolution changes
   */
  apply: (cycleId: string, evolutionId: string, approvedBy: string) =>
    apiClient<ApiResponse<CodeEvolution>>(
      `/api/v1/development/${cycleId}/evolutions/${evolutionId}/apply`,
      { 
        method: 'POST',
        body: JSON.stringify({ approvedBy }),
      }
    ),

  /**
   * Revert applied evolution changes
   */
  revert: (cycleId: string, evolutionId: string, reason: string) =>
    apiClient<ApiResponse<CodeEvolution>>(
      `/api/v1/development/${cycleId}/evolutions/${evolutionId}/revert`,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }
    ),

  /**
   * Cancel a pending/in-progress evolution
   */
  cancel: (cycleId: string, evolutionId: string) =>
    apiClient<{ success: boolean }>(`/api/v1/development/${cycleId}/evolutions/${evolutionId}`, {
      method: 'DELETE',
    }),
};

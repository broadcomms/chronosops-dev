/**
 * Intelligence API endpoints
 */
import { apiClient, buildQueryString } from './client';
import type {
  LearnedPattern,
  PatternType,
  ReconstructedIncident,
  PatternMatch,
  KnowledgeBaseStats,
  ApiResponse,
} from '../types';

// Query parameters for listing patterns
export interface PatternListParams {
  type?: PatternType;
  isActive?: boolean;
  minConfidence?: number;
  limit?: number;
  offset?: number;
}

// Request types
export interface ReconstructIncidentRequest {
  incidentId?: string;
  timeRange: {
    start: string;
    end: string;
  };
  logs?: Array<{
    timestamp: string;
    level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
    service: string;
    message: string;
    metadata?: Record<string, unknown>;
  }>;
  metrics?: Array<{
    timestamp: string;
    metric: string;
    value: number;
    labels?: Record<string, string>;
  }>;
  events?: Array<{
    timestamp: string;
    type: 'Normal' | 'Warning';
    reason: string;
    object: string;
    message: string;
    namespace: string;
  }>;
  screenshots?: Array<{
    timestamp: string;
    description: string;
    base64Data?: string;
  }>;
  additionalContext?: string;
}

export interface LearnPatternsRequest {
  incidentId: string;
  title: string;
  description?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  rootCause?: string;
  resolution?: string;
  timeToResolution?: number;
  actionsTaken?: Array<{
    type: string;
    target: string;
    success: boolean;
  }>;
}

export interface FindPatternsRequest {
  errorMessages?: string[];
  logs?: string[];
  events?: Array<{
    type: string;
    reason: string;
    message: string;
  }>;
  metricAnomalies?: Array<{
    metric: string;
    deviation: string;
  }>;
  affectedService?: string;
  symptoms?: string[];
  minScore?: number;
  maxResults?: number;
  types?: PatternType[];
}

/**
 * Intelligence API
 */
export const intelligenceApi = {
  // ==========================================
  // Incident Reconstruction
  // ==========================================

  /**
   * Reconstruct an incident from raw data
   */
  reconstruct: (data: ReconstructIncidentRequest) =>
    apiClient<ApiResponse<ReconstructedIncident>>('/api/v1/intelligence/reconstruct', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /**
   * Get reconstruction status
   */
  getReconstructionStatus: (id: string) =>
    apiClient<ApiResponse<{ startedAt: string; progress: number }>>(`/api/v1/intelligence/reconstruct/${id}/status`),

  /**
   * List reconstructions
   */
  listReconstructions: (params?: { incidentId?: string; limit?: number; offset?: number }) =>
    apiClient<ApiResponse<ReconstructedIncident[]>>(
      `/api/v1/intelligence/reconstructions${buildQueryString(params as Record<string, string | number | boolean | undefined>)}`
    ),

  /**
   * Get reconstruction by ID
   */
  getReconstruction: (id: string) =>
    apiClient<ApiResponse<ReconstructedIncident>>(`/api/v1/intelligence/reconstructions/${id}`),

  // ==========================================
  // Pattern Learning
  // ==========================================

  /**
   * Learn patterns from a resolved incident
   */
  learnPatterns: (data: LearnPatternsRequest) =>
    apiClient<ApiResponse<{
      patternsExtracted: number;
      patternsStored: number;
      patterns: LearnedPattern[];
      metadata: { incidentId: string; patternsFound: number; processingTimeMs: number };
    }>>('/api/v1/intelligence/patterns/learn', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /**
   * Find matching patterns
   */
  findPatterns: (data: FindPatternsRequest) =>
    apiClient<ApiResponse<{
      matches: PatternMatch[];
      metadata: { totalPatternsSearched: number; matchesFound: number; processingTimeMs: number };
    }>>('/api/v1/intelligence/patterns/match', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /**
   * Get recommendations based on current state
   */
  getRecommendations: (data: FindPatternsRequest) =>
    apiClient<ApiResponse<{
      recommendations: string[];
      sourcePatterns: Array<{ id: string; name: string; confidence: number }>;
    }>>('/api/v1/intelligence/patterns/recommendations', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // ==========================================
  // Pattern Management
  // ==========================================

  /**
   * List patterns
   */
  listPatterns: (params?: PatternListParams) =>
    apiClient<ApiResponse<LearnedPattern[]>>(
      `/api/v1/intelligence/patterns${buildQueryString(params as Record<string, string | number | boolean | undefined>)}`
    ),

  /**
   * Get pattern by ID
   */
  getPattern: (id: string) =>
    apiClient<ApiResponse<LearnedPattern>>(`/api/v1/intelligence/patterns/${id}`),

  /**
   * Update pattern
   */
  updatePattern: (id: string, data: Partial<Pick<LearnedPattern, 'name' | 'description' | 'triggerConditions' | 'recommendedActions' | 'confidence' | 'applicability' | 'exceptions' | 'isActive'>>) =>
    apiClient<ApiResponse<LearnedPattern>>(`/api/v1/intelligence/patterns/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  /**
   * Record pattern application
   */
  recordPatternApplied: (id: string, success: boolean) =>
    apiClient<{ message: string }>(`/api/v1/intelligence/patterns/${id}/applied`, {
      method: 'POST',
      body: JSON.stringify({ success }),
    }),

  /**
   * Deactivate pattern
   */
  deactivatePattern: (id: string, reason: string) =>
    apiClient<{ message: string }>(`/api/v1/intelligence/patterns/${id}/deactivate`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  /**
   * Delete pattern
   */
  deletePattern: (id: string) =>
    apiClient<{ message: string }>(`/api/v1/intelligence/patterns/${id}`, {
      method: 'DELETE',
    }),

  /**
   * Get knowledge base stats
   */
  getStats: () =>
    apiClient<ApiResponse<KnowledgeBaseStats>>('/api/v1/intelligence/stats'),

  /**
   * Search patterns by keywords
   */
  searchPatterns: (keywords: string[]) =>
    apiClient<ApiResponse<LearnedPattern[]>>(
      `/api/v1/intelligence/patterns/search?keywords=${keywords.join(',')}`
    ),

  /**
   * Get high confidence patterns
   */
  getHighConfidencePatterns: () =>
    apiClient<ApiResponse<LearnedPattern[]>>('/api/v1/intelligence/patterns/high-confidence'),
};

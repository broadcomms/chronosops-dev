/**
 * Incident API endpoints
 */
import { apiClient, buildQueryString } from './client';
import type {
  Incident,
  CreateIncidentRequest,
  Investigation,
  Evidence,
  Hypothesis,
  Action,
  TimelineEvent,
  ThoughtState,
  Postmortem,
  ApiResponse,
  IncidentSeverity,
  IncidentStatus,
} from '../types';

// Query parameters for listing incidents
export interface IncidentListParams {
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  namespace?: string;
  limit?: number;
  offset?: number;
}

/**
 * Incidents API
 */
export const incidentsApi = {
  /**
   * List incidents with optional filtering
   */
  list: (params?: IncidentListParams) =>
    apiClient<ApiResponse<Incident[]>>(
      `/api/v1/incidents${buildQueryString(params as Record<string, string | number | boolean | undefined>)}`
    ),

  /**
   * Get a single incident by ID
   */
  get: (id: string) =>
    apiClient<{ data: Incident; investigation: Investigation | null }>(`/api/v1/incidents/${id}`),

  /**
   * Create a new incident
   */
  create: (data: CreateIncidentRequest) =>
    apiClient<ApiResponse<Incident>>('/api/v1/incidents', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /**
   * Start an investigation for an incident
   */
  investigate: (id: string) =>
    apiClient<{ message: string; incidentId: string; investigation: Investigation }>(
      `/api/v1/incidents/${id}/investigate`,
      { method: 'POST' }
    ),

  /**
   * Get the current investigation status
   */
  getInvestigation: (id: string) =>
    apiClient<Investigation>(`/api/v1/incidents/${id}/investigation`),

  /**
   * Get evidence for an incident
   */
  getEvidence: (id: string) =>
    apiClient<ApiResponse<Evidence[]>>(`/api/v1/incidents/${id}/evidence`),

  /**
   * Get hypotheses for an incident
   */
  getHypotheses: (id: string) =>
    apiClient<ApiResponse<Hypothesis[]>>(`/api/v1/incidents/${id}/hypotheses`),

  /**
   * Get actions for an incident
   */
  getActions: (id: string) =>
    apiClient<ApiResponse<Action[]>>(`/api/v1/incidents/${id}/actions`),

  /**
   * Get timeline for an incident
   */
  getTimeline: (id: string) =>
    apiClient<ApiResponse<TimelineEvent[]>>(`/api/v1/incidents/${id}/timeline`),

  /**
   * Get thought states (AI reasoning) for an incident
   */
  getThinking: (id: string) =>
    apiClient<ApiResponse<ThoughtState[]>>(`/api/v1/incidents/${id}/thinking`),

  /**
   * Get postmortem for an incident
   */
  getPostmortem: (id: string) =>
    apiClient<ApiResponse<Postmortem>>(`/api/v1/incidents/${id}/postmortem`),

  /**
   * Resolve an incident
   */
  resolve: (id: string) =>
    apiClient<ApiResponse<Incident>>(`/api/v1/incidents/${id}/resolve`, {
      method: 'POST',
    }),

  /**
   * Delete an incident and all related data
   */
  delete: (id: string) =>
    apiClient<{ message: string }>(`/api/v1/incidents/${id}`, {
      method: 'DELETE',
    }),
};

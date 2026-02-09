/**
 * Incident Repository
 */

import { eq, desc, and, gte, lte, lt, not } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Incident, OODAState, OODAPhaseRetryState } from '@chronosops/shared';
import { getDatabase } from '../connection.js';
import { incidents } from '../schema.js';

/**
 * Safely parse JSON string, returning undefined on failure
 */
function safeJsonParse<T>(value: string | null | undefined): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

export interface CreateIncidentInput {
  title: string;
  description?: string;
  severity: Incident['severity'];
  namespace: string;
  monitoredAppId?: string;
}

export interface UpdateIncidentInput {
  title?: string;
  description?: string;
  severity?: Incident['severity'];
  status?: Incident['status'];
  state?: OODAState;
  resolvedAt?: Date;
  thumbnail?: string;
  // Investigation tracking fields (H1 fix)
  isInvestigating?: boolean;
  investigationInstanceId?: string | null;
  investigationHeartbeat?: Date | null;
  investigationStartedAt?: Date | null;
  // Self-healing integration
  linkedDevelopmentCycleId?: string | null;
  linkedEvolutionId?: string | null;
  // Per-phase retry tracking for resilient self-healing
  phaseRetries?: OODAPhaseRetryState | null;
}

export interface IncidentFilters {
  status?: Incident['status'];
  severity?: Incident['severity'];
  state?: OODAState;
  namespace?: string;
  startedAfter?: Date;
  startedBefore?: Date;
}

export class IncidentRepository {
  /**
   * Create a new incident
   */
  async create(input: CreateIncidentInput): Promise<Incident> {
    const db = getDatabase();
    const now = new Date();

    const incident: typeof incidents.$inferInsert = {
      id: randomUUID(),
      title: input.title,
      description: input.description ?? null,
      severity: input.severity,
      status: 'active',
      state: 'IDLE',
      namespace: input.namespace,
      monitoredAppId: input.monitoredAppId ?? null,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(incidents).values(incident);

    return this.mapToIncident(incident as typeof incidents.$inferSelect);
  }

  /**
   * Get incident by ID
   */
  async getById(id: string): Promise<Incident | null> {
    const db = getDatabase();
    const result = await db.select().from(incidents).where(eq(incidents.id, id)).limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapToIncident(result[0]!);
  }

  /**
   * Update incident
   */
  async update(id: string, input: UpdateIncidentInput): Promise<Incident | null> {
    const db = getDatabase();
    const now = new Date();

    // Separate phaseRetries since it needs JSON serialization
    const { phaseRetries, ...restInput } = input;

    await db
      .update(incidents)
      .set({
        ...restInput,
        // Serialize phaseRetries to JSON string if provided
        ...(phaseRetries !== undefined && {
          phaseRetries: phaseRetries ? JSON.stringify(phaseRetries) : null,
        }),
        updatedAt: now,
      })
      .where(eq(incidents.id, id));

    return this.getById(id);
  }

  /**
   * Update incident state
   */
  async updateState(id: string, state: OODAState): Promise<Incident | null> {
    return this.update(id, { state });
  }

  /**
   * Mark incident as resolved
   */
  async resolve(id: string): Promise<Incident | null> {
    return this.update(id, {
      status: 'resolved',
      state: 'DONE',
      resolvedAt: new Date(),
    });
  }

  /**
   * Mark incident as failed
   */
  async fail(id: string): Promise<Incident | null> {
    return this.update(id, {
      status: 'closed',
      state: 'FAILED',
    });
  }

  /**
   * List incidents with filters
   */
  async list(filters: IncidentFilters = {}, limit = 50, offset = 0): Promise<Incident[]> {
    const db = getDatabase();

    const conditions = [];

    if (filters.status) {
      conditions.push(eq(incidents.status, filters.status));
    }
    if (filters.severity) {
      conditions.push(eq(incidents.severity, filters.severity));
    }
    if (filters.state) {
      conditions.push(eq(incidents.state, filters.state));
    }
    if (filters.namespace) {
      conditions.push(eq(incidents.namespace, filters.namespace));
    }
    if (filters.startedAfter) {
      conditions.push(gte(incidents.startedAt, filters.startedAfter));
    }
    if (filters.startedBefore) {
      conditions.push(lte(incidents.startedAt, filters.startedBefore));
    }

    const query = db
      .select()
      .from(incidents)
      .orderBy(desc(incidents.createdAt))
      .limit(limit)
      .offset(offset);

    if (conditions.length > 0) {
      query.where(and(...conditions));
    }

    const results = await query;

    return results.map((r) => this.mapToIncident(r));
  }

  /**
   * Get active incidents
   */
  async getActive(): Promise<Incident[]> {
    return this.list({ status: 'active' });
  }

  /**
   * Get investigating incidents
   */
  async getInvestigating(): Promise<Incident[]> {
    return this.list({ status: 'investigating' });
  }

  /**
   * Delete incident
   */
  async delete(id: string): Promise<void> {
    const db = getDatabase();
    await db.delete(incidents).where(eq(incidents.id, id));
  }

  /**
   * Get all incidents linked to a specific monitored app
   */
  async getByMonitoredAppId(monitoredAppId: string): Promise<Incident[]> {
    const db = getDatabase();
    const results = await db
      .select()
      .from(incidents)
      .where(eq(incidents.monitoredAppId, monitoredAppId))
      .orderBy(desc(incidents.createdAt));

    return results.map((r) => this.mapToIncident(r));
  }

  // ===========================================
  // Investigation Tracking Methods (H1 fix)
  // ===========================================

  /**
   * Start investigation for an incident
   * @param id Incident ID
   * @param instanceId Server/process instance identifier
   */
  async startInvestigation(id: string, instanceId: string): Promise<Incident | null> {
    const now = new Date();
    return this.update(id, {
      isInvestigating: true,
      investigationInstanceId: instanceId,
      investigationHeartbeat: now,
      investigationStartedAt: now,
    });
  }

  /**
   * Update investigation heartbeat
   * @param id Incident ID
   */
  async updateInvestigationHeartbeat(id: string): Promise<Incident | null> {
    return this.update(id, {
      investigationHeartbeat: new Date(),
    });
  }

  /**
   * Stop investigation for an incident
   * @param id Incident ID
   */
  async stopInvestigation(id: string): Promise<Incident | null> {
    return this.update(id, {
      isInvestigating: false,
      investigationInstanceId: null,
      investigationHeartbeat: null,
    });
  }

  /**
   * Check if an investigation is currently active for an incident
   * @param id Incident ID
   * @param staleThresholdMs Consider investigation stale after this many ms without heartbeat (default: 60000)
   */
  async isInvestigationActive(id: string, staleThresholdMs = 60000): Promise<boolean> {
    const db = getDatabase();
    const result = await db.select().from(incidents).where(eq(incidents.id, id)).limit(1);

    if (result.length === 0) {
      return false;
    }

    const incident = result[0]!;
    if (!incident.isInvestigating) {
      return false;
    }

    // Check if heartbeat is stale
    if (incident.investigationHeartbeat) {
      const heartbeatAge = Date.now() - incident.investigationHeartbeat.getTime();
      if (heartbeatAge > staleThresholdMs) {
        return false; // Investigation is stale
      }
    }

    return true;
  }

  /**
   * Get orphaned investigations (active but with stale heartbeat)
   * @param staleThresholdMs Consider investigation stale after this many ms without heartbeat (default: 60000)
   */
  async getOrphanedInvestigations(staleThresholdMs = 60000): Promise<Incident[]> {
    const db = getDatabase();
    const staleThreshold = new Date(Date.now() - staleThresholdMs);

    const results = await db
      .select()
      .from(incidents)
      .where(
        and(
          eq(incidents.isInvestigating, true),
          lt(incidents.investigationHeartbeat, staleThreshold)
        )
      );

    return results.map((r) => this.mapToIncident(r));
  }

  /**
   * Recover orphaned investigations by marking them as failed
   * @param staleThresholdMs Consider investigation stale after this many ms without heartbeat (default: 60000)
   * @returns Number of recovered incidents
   */
  async recoverOrphanedInvestigations(staleThresholdMs = 60000): Promise<number> {
    const orphaned = await this.getOrphanedInvestigations(staleThresholdMs);

    for (const incident of orphaned) {
      await this.update(incident.id, {
        isInvestigating: false,
        investigationInstanceId: null,
        investigationHeartbeat: null,
        state: 'FAILED',
        status: 'active',
      });
    }

    return orphaned.length;
  }

  /**
   * Get interrupted investigations that can be resumed
   * (active but with stale heartbeat, NOT in terminal state)
   * @param staleThresholdMs Consider investigation stale after this many ms without heartbeat (default: 60000)
   */
  async getInterruptedInvestigations(staleThresholdMs = 60000): Promise<Incident[]> {
    const db = getDatabase();
    const staleThreshold = new Date(Date.now() - staleThresholdMs);

    const results = await db
      .select()
      .from(incidents)
      .where(
        and(
          eq(incidents.isInvestigating, true),
          lt(incidents.investigationHeartbeat, staleThreshold),
          // Not in terminal state
          not(eq(incidents.state, 'DONE')),
          not(eq(incidents.state, 'FAILED')),
          not(eq(incidents.state, 'IDLE'))
        )
      );

    return results.map((r) => this.mapToIncident(r));
  }

  /**
   * Update phase retries for an investigation
   */
  async updatePhaseRetries(id: string, phaseRetries: OODAPhaseRetryState): Promise<Incident | null> {
    const db = getDatabase();
    const now = new Date();

    await db
      .update(incidents)
      .set({
        phaseRetries: JSON.stringify(phaseRetries),
        updatedAt: now,
      })
      .where(eq(incidents.id, id));

    return this.getById(id);
  }

  /**
   * Map database row to Incident type
   */
  private mapToIncident(row: typeof incidents.$inferSelect): Incident {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      severity: row.severity,
      status: row.status,
      state: row.state,
      namespace: row.namespace,
      monitoredAppId: row.monitoredAppId ?? null,
      startedAt: row.startedAt,
      resolvedAt: row.resolvedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      thumbnail: row.thumbnail ?? null,
      phaseRetries: row.phaseRetries ? safeJsonParse<OODAPhaseRetryState>(row.phaseRetries) : undefined,
    };
  }
}

// Singleton instance
export const incidentRepository = new IncidentRepository();

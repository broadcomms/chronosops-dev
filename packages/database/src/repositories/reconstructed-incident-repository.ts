/**
 * Reconstructed Incident Repository
 * For storing 1M context incident reconstructions
 */

import { eq, desc, and, gte, lte } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getDatabase } from '../connection.js';
import { reconstructedIncidents } from '../schema.js';

export interface CreateReconstructedIncidentInput {
  incidentId?: string;
  timeRangeStart: Date;
  timeRangeEnd: Date;
  timeline: unknown[]; // Will be JSON stringified
  causalChain: unknown[]; // Will be JSON stringified
  rootCause: string;
  recommendations: string[]; // Will be JSON stringified
  narrative: string;
  dataQuality: {
    logsAvailable: boolean;
    metricsAvailable: boolean;
    eventsAvailable: boolean;
    confidenceScore: number;
    gaps: string[];
  };
  inputTokensUsed?: number;
}

export interface ReconstructedIncidentFilters {
  incidentId?: string;
  timeRangeStart?: Date;
  timeRangeEnd?: Date;
}

export interface ReconstructedIncidentRecord {
  id: string;
  incidentId: string | null;
  timeRangeStart: Date;
  timeRangeEnd: Date;
  timeline: unknown[];
  causalChain: unknown[];
  rootCause: string;
  recommendations: string[];
  narrative: string;
  dataQuality: {
    logsAvailable: boolean;
    metricsAvailable: boolean;
    eventsAvailable: boolean;
    confidenceScore: number;
    gaps: string[];
  };
  inputTokensUsed: number | null;
  createdAt: Date;
}

export class ReconstructedIncidentRepository {
  /**
   * Create a new reconstructed incident record
   */
  async create(input: CreateReconstructedIncidentInput): Promise<ReconstructedIncidentRecord> {
    const db = getDatabase();
    const now = new Date();

    const record: typeof reconstructedIncidents.$inferInsert = {
      id: randomUUID(),
      incidentId: input.incidentId ?? null,
      timeRangeStart: input.timeRangeStart,
      timeRangeEnd: input.timeRangeEnd,
      timeline: JSON.stringify(input.timeline),
      causalChain: JSON.stringify(input.causalChain),
      rootCause: input.rootCause,
      recommendations: JSON.stringify(input.recommendations),
      narrative: input.narrative,
      dataQuality: JSON.stringify(input.dataQuality),
      inputTokensUsed: input.inputTokensUsed ?? null,
      createdAt: now,
    };

    await db.insert(reconstructedIncidents).values(record);

    return this.mapToRecord(record as typeof reconstructedIncidents.$inferSelect);
  }

  /**
   * Get reconstructed incident by ID
   */
  async getById(id: string): Promise<ReconstructedIncidentRecord | null> {
    const db = getDatabase();
    const result = await db
      .select()
      .from(reconstructedIncidents)
      .where(eq(reconstructedIncidents.id, id))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapToRecord(result[0]!);
  }

  /**
   * Get reconstruction for a specific incident
   */
  async getByIncident(incidentId: string): Promise<ReconstructedIncidentRecord | null> {
    const db = getDatabase();
    const result = await db
      .select()
      .from(reconstructedIncidents)
      .where(eq(reconstructedIncidents.incidentId, incidentId))
      .orderBy(desc(reconstructedIncidents.createdAt))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapToRecord(result[0]!);
  }

  /**
   * List reconstructed incidents with filters
   */
  async list(
    filters: ReconstructedIncidentFilters = {},
    limit = 50,
    offset = 0
  ): Promise<ReconstructedIncidentRecord[]> {
    const db = getDatabase();

    const conditions = [];

    if (filters.incidentId) {
      conditions.push(eq(reconstructedIncidents.incidentId, filters.incidentId));
    }
    if (filters.timeRangeStart) {
      conditions.push(gte(reconstructedIncidents.timeRangeStart, filters.timeRangeStart));
    }
    if (filters.timeRangeEnd) {
      conditions.push(lte(reconstructedIncidents.timeRangeEnd, filters.timeRangeEnd));
    }

    const query = db
      .select()
      .from(reconstructedIncidents)
      .orderBy(desc(reconstructedIncidents.createdAt))
      .limit(limit)
      .offset(offset);

    if (conditions.length > 0) {
      query.where(and(...conditions));
    }

    const results = await query;
    return results.map((r) => this.mapToRecord(r));
  }

  /**
   * Get reconstructions within a time range
   */
  async getByTimeRange(start: Date, end: Date): Promise<ReconstructedIncidentRecord[]> {
    return this.list({ timeRangeStart: start, timeRangeEnd: end });
  }

  /**
   * Get recent reconstructions
   */
  async getRecent(limit = 10): Promise<ReconstructedIncidentRecord[]> {
    return this.list({}, limit);
  }

  /**
   * Delete reconstructed incident
   */
  async delete(id: string): Promise<void> {
    const db = getDatabase();
    await db.delete(reconstructedIncidents).where(eq(reconstructedIncidents.id, id));
  }

  /**
   * Delete all reconstructed incidents linked to an incident
   */
  async deleteByIncidentId(incidentId: string): Promise<void> {
    const db = getDatabase();
    await db.delete(reconstructedIncidents).where(eq(reconstructedIncidents.incidentId, incidentId));
  }

  /**
   * Map database row to record type
   */
  private mapToRecord(
    row: typeof reconstructedIncidents.$inferSelect
  ): ReconstructedIncidentRecord {
    return {
      id: row.id,
      incidentId: row.incidentId,
      timeRangeStart: row.timeRangeStart,
      timeRangeEnd: row.timeRangeEnd,
      timeline: JSON.parse(row.timeline) as unknown[],
      causalChain: JSON.parse(row.causalChain) as unknown[],
      rootCause: row.rootCause,
      recommendations: JSON.parse(row.recommendations) as string[],
      narrative: row.narrative,
      dataQuality: JSON.parse(row.dataQuality) as {
        logsAvailable: boolean;
        metricsAvailable: boolean;
        eventsAvailable: boolean;
        confidenceScore: number;
        gaps: string[];
      },
      inputTokensUsed: row.inputTokensUsed,
      createdAt: row.createdAt,
    };
  }
}

// Singleton instance
export const reconstructedIncidentRepository = new ReconstructedIncidentRepository();

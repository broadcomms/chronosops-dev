/**
 * Timeline Event Repository
 * Stores investigation timeline events for display and audit
 */

import { eq, desc, asc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getDatabase } from '../connection.js';
import { timelineEvents } from '../schema.js';

export type TimelineEventType = 'phase_change' | 'evidence' | 'hypothesis' | 'action' | 'verification' | 'error';
export type TimelinePhase = 'OBSERVING' | 'ORIENTING' | 'DECIDING' | 'ACTING' | 'VERIFYING' | 'DONE' | 'FAILED';

export interface CreateTimelineEventInput {
  incidentId: string;
  type: TimelineEventType;
  title: string;
  description?: string;
  phase?: TimelinePhase;
  timestamp?: Date;
  metadata?: Record<string, unknown>;
}

export interface TimelineEventRecord {
  id: string;
  incidentId: string;
  type: TimelineEventType;
  title: string;
  description: string | null;
  phase: TimelinePhase | null;
  timestamp: Date;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export class TimelineRepository {
  /**
   * Create a new timeline event
   */
  async create(input: CreateTimelineEventInput): Promise<TimelineEventRecord> {
    const db = getDatabase();
    const now = new Date();

    const record: typeof timelineEvents.$inferInsert = {
      id: randomUUID(),
      incidentId: input.incidentId,
      type: input.type,
      title: input.title,
      description: input.description ?? null,
      phase: input.phase ?? null,
      timestamp: input.timestamp ?? now,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt: now,
    };

    await db.insert(timelineEvents).values(record);

    return this.mapToTimelineEvent(record as typeof timelineEvents.$inferSelect);
  }

  /**
   * Create multiple timeline events
   */
  async createMany(inputs: CreateTimelineEventInput[]): Promise<TimelineEventRecord[]> {
    const db = getDatabase();
    const now = new Date();

    const records = inputs.map((input) => ({
      id: randomUUID(),
      incidentId: input.incidentId,
      type: input.type,
      title: input.title,
      description: input.description ?? null,
      phase: input.phase ?? null,
      timestamp: input.timestamp ?? now,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt: now,
    }));

    await db.insert(timelineEvents).values(records);

    return records.map((r) => this.mapToTimelineEvent(r as typeof timelineEvents.$inferSelect));
  }

  /**
   * Get timeline event by ID
   */
  async getById(id: string): Promise<TimelineEventRecord | null> {
    const db = getDatabase();
    const result = await db
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.id, id))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapToTimelineEvent(result[0]!);
  }

  /**
   * Get all timeline events for an incident (chronological order)
   */
  async getByIncident(incidentId: string): Promise<TimelineEventRecord[]> {
    const db = getDatabase();
    const results = await db
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.incidentId, incidentId))
      .orderBy(asc(timelineEvents.timestamp));

    return results.map((r) => this.mapToTimelineEvent(r));
  }

  /**
   * Get latest timeline events for an incident
   */
  async getLatest(incidentId: string, limit = 10): Promise<TimelineEventRecord[]> {
    const db = getDatabase();
    const results = await db
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.incidentId, incidentId))
      .orderBy(desc(timelineEvents.timestamp))
      .limit(limit);

    // Reverse to get chronological order
    return results.reverse().map((r) => this.mapToTimelineEvent(r));
  }

  /**
   * Delete timeline events for an incident
   */
  async deleteByIncident(incidentId: string): Promise<void> {
    const db = getDatabase();
    await db.delete(timelineEvents).where(eq(timelineEvents.incidentId, incidentId));
  }

  /**
   * Map database row to TimelineEventRecord type
   */
  private mapToTimelineEvent(row: typeof timelineEvents.$inferSelect): TimelineEventRecord {
    return {
      id: row.id,
      incidentId: row.incidentId,
      type: row.type,
      title: row.title,
      description: row.description,
      phase: row.phase,
      timestamp: row.timestamp,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      createdAt: row.createdAt,
    };
  }
}

// Singleton instance
export const timelineRepository = new TimelineRepository();

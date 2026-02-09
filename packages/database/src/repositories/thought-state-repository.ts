/**
 * Thought State Repository
 * Stores AI reasoning/thinking states for auditability
 */

import { eq, desc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getDatabase } from '../connection.js';
import { thoughtStates } from '../schema.js';

export type ThinkingPhase = 'OBSERVING' | 'ORIENTING' | 'DECIDING' | 'ACTING' | 'VERIFYING';

export interface CreateThoughtStateInput {
  incidentId: string;
  phase: ThinkingPhase;
  signature?: string;
  signatureHash?: string;
  thinkingBudget: number;
  tokensUsed?: number;
  summary?: string;
  insights?: string[];
}

export interface ThoughtStateRecord {
  id: string;
  incidentId: string;
  phase: ThinkingPhase;
  signature: string | null;
  signatureHash: string | null;
  thinkingBudget: number;
  tokensUsed: number | null;
  summary: string | null;
  insights: string[];
  createdAt: Date;
}

export class ThoughtStateRepository {
  /**
   * Create a new thought state
   */
  async create(input: CreateThoughtStateInput): Promise<ThoughtStateRecord> {
    const db = getDatabase();
    const now = new Date();

    const record: typeof thoughtStates.$inferInsert = {
      id: randomUUID(),
      incidentId: input.incidentId,
      phase: input.phase,
      signature: input.signature ?? null,
      signatureHash: input.signatureHash ?? null,
      thinkingBudget: input.thinkingBudget,
      tokensUsed: input.tokensUsed ?? null,
      summary: input.summary ?? null,
      insights: input.insights ? JSON.stringify(input.insights) : null,
      createdAt: now,
    };

    await db.insert(thoughtStates).values(record);

    return this.mapToThoughtState(record as typeof thoughtStates.$inferSelect);
  }

  /**
   * Get thought state by ID
   */
  async getById(id: string): Promise<ThoughtStateRecord | null> {
    const db = getDatabase();
    const result = await db
      .select()
      .from(thoughtStates)
      .where(eq(thoughtStates.id, id))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapToThoughtState(result[0]!);
  }

  /**
   * Get all thought states for an incident
   */
  async getByIncident(incidentId: string): Promise<ThoughtStateRecord[]> {
    const db = getDatabase();
    const results = await db
      .select()
      .from(thoughtStates)
      .where(eq(thoughtStates.incidentId, incidentId))
      .orderBy(desc(thoughtStates.createdAt));

    return results.map((r) => this.mapToThoughtState(r));
  }

  /**
   * Get latest thought state for an incident
   */
  async getLatest(incidentId: string): Promise<ThoughtStateRecord | null> {
    const db = getDatabase();
    const result = await db
      .select()
      .from(thoughtStates)
      .where(eq(thoughtStates.incidentId, incidentId))
      .orderBy(desc(thoughtStates.createdAt))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapToThoughtState(result[0]!);
  }

  /**
   * Delete thought states for an incident
   */
  async deleteByIncident(incidentId: string): Promise<void> {
    const db = getDatabase();
    await db.delete(thoughtStates).where(eq(thoughtStates.incidentId, incidentId));
  }

  /**
   * Map database row to ThoughtStateRecord type
   */
  private mapToThoughtState(row: typeof thoughtStates.$inferSelect): ThoughtStateRecord {
    return {
      id: row.id,
      incidentId: row.incidentId,
      phase: row.phase,
      signature: row.signature,
      signatureHash: row.signatureHash,
      thinkingBudget: row.thinkingBudget,
      tokensUsed: row.tokensUsed,
      summary: row.summary,
      insights: row.insights ? JSON.parse(row.insights) : [],
      createdAt: row.createdAt,
    };
  }
}

// Singleton instance
export const thoughtStateRepository = new ThoughtStateRepository();

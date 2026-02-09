/**
 * Hypothesis Repository
 */

import { eq, desc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getDatabase } from '../connection.js';
import { hypotheses } from '../schema.js';

export interface CreateHypothesisInput {
  id?: string;
  incidentId: string;
  rootCause: string;
  confidence: number;
  status?: 'proposed' | 'testing' | 'confirmed' | 'rejected';
  supportingEvidence: string[];
  contradictingEvidence?: string[];
  suggestedActions?: string[];
  testingSteps?: string[];
}

export interface UpdateHypothesisInput {
  confidence?: number;
  status?: 'proposed' | 'testing' | 'confirmed' | 'rejected';
  supportingEvidence?: string[];
  contradictingEvidence?: string[];
}

export interface HypothesisRecord {
  id: string;
  incidentId: string;
  rootCause: string;
  confidence: number;
  status: 'proposed' | 'testing' | 'confirmed' | 'rejected';
  supportingEvidence: string[];
  contradictingEvidence: string[];
  suggestedActions: string[];
  testingSteps: string[];
  createdAt: Date;
  updatedAt: Date;
}

export class HypothesisRepository {
  /**
   * Create a new hypothesis
   */
  async create(input: CreateHypothesisInput): Promise<HypothesisRecord> {
    const db = getDatabase();
    const now = new Date();

    const record: typeof hypotheses.$inferInsert = {
      id: input.id || randomUUID(),
      incidentId: input.incidentId,
      rootCause: input.rootCause,
      confidence: input.confidence,
      status: input.status ?? 'proposed',
      supportingEvidence: JSON.stringify(input.supportingEvidence),
      contradictingEvidence: input.contradictingEvidence
        ? JSON.stringify(input.contradictingEvidence)
        : null,
      suggestedActions: input.suggestedActions
        ? JSON.stringify(input.suggestedActions)
        : null,
      testingSteps: input.testingSteps
        ? JSON.stringify(input.testingSteps)
        : null,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(hypotheses).values(record);

    return this.mapToHypothesis(record as typeof hypotheses.$inferSelect);
  }

  /**
   * Get hypothesis by ID
   */
  async getById(id: string): Promise<HypothesisRecord | null> {
    const db = getDatabase();
    const result = await db
      .select()
      .from(hypotheses)
      .where(eq(hypotheses.id, id))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapToHypothesis(result[0]!);
  }

  /**
   * Get all hypotheses for an incident
   */
  async getByIncident(incidentId: string): Promise<HypothesisRecord[]> {
    const db = getDatabase();
    const results = await db
      .select()
      .from(hypotheses)
      .where(eq(hypotheses.incidentId, incidentId))
      .orderBy(desc(hypotheses.confidence));

    return results.map((r) => this.mapToHypothesis(r));
  }

  /**
   * Update hypothesis
   */
  async update(id: string, input: UpdateHypothesisInput): Promise<HypothesisRecord | null> {
    const db = getDatabase();
    const now = new Date();

    const updateData: Partial<typeof hypotheses.$inferInsert> = {
      updatedAt: now,
    };

    if (input.confidence !== undefined) {
      updateData.confidence = input.confidence;
    }
    if (input.status !== undefined) {
      updateData.status = input.status;
    }
    if (input.supportingEvidence !== undefined) {
      updateData.supportingEvidence = JSON.stringify(input.supportingEvidence);
    }
    if (input.contradictingEvidence !== undefined) {
      updateData.contradictingEvidence = JSON.stringify(input.contradictingEvidence);
    }

    await db.update(hypotheses).set(updateData).where(eq(hypotheses.id, id));

    return this.getById(id);
  }

  /**
   * Delete hypotheses for an incident
   */
  async deleteByIncident(incidentId: string): Promise<void> {
    const db = getDatabase();
    await db.delete(hypotheses).where(eq(hypotheses.incidentId, incidentId));
  }

  /**
   * Map database row to HypothesisRecord type
   */
  private mapToHypothesis(row: typeof hypotheses.$inferSelect): HypothesisRecord {
    return {
      id: row.id,
      incidentId: row.incidentId,
      rootCause: row.rootCause,
      confidence: row.confidence,
      status: row.status,
      supportingEvidence: JSON.parse(row.supportingEvidence),
      contradictingEvidence: row.contradictingEvidence
        ? JSON.parse(row.contradictingEvidence)
        : [],
      suggestedActions: row.suggestedActions
        ? JSON.parse(row.suggestedActions)
        : [],
      testingSteps: row.testingSteps
        ? JSON.parse(row.testingSteps)
        : [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

// Singleton instance
export const hypothesisRepository = new HypothesisRepository();

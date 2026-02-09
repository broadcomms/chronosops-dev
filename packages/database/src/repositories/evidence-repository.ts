/**
 * Evidence Repository
 */

import { eq, desc, and, gte, lte } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Evidence, EvidenceType } from '@chronosops/shared';
import { getDatabase } from '../connection.js';
import { evidence } from '../schema.js';

export interface CreateEvidenceInput {
  incidentId: string;
  type: EvidenceType;
  source: string;
  content: Record<string, unknown>;
  timestamp: Date;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface EvidenceFilters {
  incidentId?: string;
  type?: EvidenceType;
  source?: string;
  timestampAfter?: Date;
  timestampBefore?: Date;
  minConfidence?: number;
}

export class EvidenceRepository {
  /**
   * Create new evidence
   */
  async create(input: CreateEvidenceInput): Promise<Evidence> {
    const db = getDatabase();
    const now = new Date();

    const evidenceRecord: typeof evidence.$inferInsert = {
      id: randomUUID(),
      incidentId: input.incidentId,
      type: input.type,
      source: input.source,
      content: JSON.stringify(input.content),
      timestamp: input.timestamp,
      confidence: input.confidence ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt: now,
    };

    await db.insert(evidence).values(evidenceRecord);

    return this.mapToEvidence(evidenceRecord as typeof evidence.$inferSelect);
  }

  /**
   * Create multiple evidence records
   */
  async createMany(inputs: CreateEvidenceInput[]): Promise<Evidence[]> {
    const db = getDatabase();
    const now = new Date();

    const records = inputs.map((input) => ({
      id: randomUUID(),
      incidentId: input.incidentId,
      type: input.type,
      source: input.source,
      content: JSON.stringify(input.content),
      timestamp: input.timestamp,
      confidence: input.confidence ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt: now,
    }));

    await db.insert(evidence).values(records);

    return records.map((r) => this.mapToEvidence(r as typeof evidence.$inferSelect));
  }

  /**
   * Get evidence by ID
   */
  async getById(id: string): Promise<Evidence | null> {
    const db = getDatabase();
    const result = await db.select().from(evidence).where(eq(evidence.id, id)).limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapToEvidence(result[0]!);
  }

  /**
   * Get all evidence for an incident
   */
  async getByIncident(incidentId: string): Promise<Evidence[]> {
    const db = getDatabase();
    const results = await db
      .select()
      .from(evidence)
      .where(eq(evidence.incidentId, incidentId))
      .orderBy(desc(evidence.timestamp));

    return results.map((r) => this.mapToEvidence(r));
  }

  /**
   * List evidence with filters
   */
  async list(filters: EvidenceFilters = {}, limit = 100, offset = 0): Promise<Evidence[]> {
    const db = getDatabase();

    const conditions = [];

    if (filters.incidentId) {
      conditions.push(eq(evidence.incidentId, filters.incidentId));
    }
    if (filters.type) {
      conditions.push(eq(evidence.type, filters.type));
    }
    if (filters.source) {
      conditions.push(eq(evidence.source, filters.source));
    }
    if (filters.timestampAfter) {
      conditions.push(gte(evidence.timestamp, filters.timestampAfter));
    }
    if (filters.timestampBefore) {
      conditions.push(lte(evidence.timestamp, filters.timestampBefore));
    }
    if (filters.minConfidence !== undefined) {
      conditions.push(gte(evidence.confidence, filters.minConfidence));
    }

    const query = db
      .select()
      .from(evidence)
      .orderBy(desc(evidence.timestamp))
      .limit(limit)
      .offset(offset);

    if (conditions.length > 0) {
      query.where(and(...conditions));
    }

    const results = await query;

    return results.map((r) => this.mapToEvidence(r));
  }

  /**
   * Delete evidence for an incident
   */
  async deleteByIncident(incidentId: string): Promise<void> {
    const db = getDatabase();
    await db.delete(evidence).where(eq(evidence.incidentId, incidentId));
  }

  /**
   * Map database row to Evidence type
   */
  private mapToEvidence(row: typeof evidence.$inferSelect): Evidence {
    return {
      id: row.id,
      incidentId: row.incidentId,
      type: row.type,
      source: row.source,
      content: JSON.parse(row.content),
      timestamp: row.timestamp,
      confidence: row.confidence,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      createdAt: row.createdAt,
    };
  }
}

// Singleton instance
export const evidenceRepository = new EvidenceRepository();

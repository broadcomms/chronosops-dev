/**
 * Learned Pattern Repository
 */

import { eq, desc, and, gte } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getDatabase } from '../connection.js';
import { learnedPatterns } from '../schema.js';

export type PatternType = 'detection' | 'diagnostic' | 'resolution' | 'prevention';

export interface CreateLearnedPatternInput {
  type: PatternType;
  name: string;
  description: string;
  triggerConditions: string[]; // Will be JSON stringified
  recommendedActions: string[]; // Will be JSON stringified
  confidence: number;
  applicability: string;
  exceptions: string[]; // Will be JSON stringified
  sourceIncidentId?: string;
}

export interface UpdateLearnedPatternInput {
  name?: string;
  description?: string;
  triggerConditions?: string[];
  recommendedActions?: string[];
  confidence?: number;
  applicability?: string;
  exceptions?: string[];
  timesMatched?: number;
  timesApplied?: number;
  successRate?: number;
  isActive?: boolean;
}

export interface LearnedPatternFilters {
  type?: PatternType;
  sourceIncidentId?: string;
  isActive?: boolean;
  minConfidence?: number;
}

export interface LearnedPatternRecord {
  id: string;
  type: PatternType;
  name: string;
  description: string;
  triggerConditions: string[];
  recommendedActions: string[];
  confidence: number;
  applicability: string;
  exceptions: string[];
  timesMatched: number;
  timesApplied: number;
  successRate: number | null;
  sourceIncidentId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class LearnedPatternRepository {
  /**
   * Create a new learned pattern
   */
  async create(input: CreateLearnedPatternInput): Promise<LearnedPatternRecord> {
    const db = getDatabase();
    const now = new Date();

    const pattern: typeof learnedPatterns.$inferInsert = {
      id: randomUUID(),
      type: input.type,
      name: input.name,
      description: input.description,
      triggerConditions: JSON.stringify(input.triggerConditions),
      recommendedActions: JSON.stringify(input.recommendedActions),
      confidence: input.confidence,
      applicability: input.applicability,
      exceptions: JSON.stringify(input.exceptions),
      sourceIncidentId: input.sourceIncidentId ?? null,
      timesMatched: 0,
      timesApplied: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(learnedPatterns).values(pattern);

    return this.mapToRecord(pattern as typeof learnedPatterns.$inferSelect);
  }

  /**
   * Get learned pattern by ID
   */
  async getById(id: string): Promise<LearnedPatternRecord | null> {
    const db = getDatabase();
    const result = await db
      .select()
      .from(learnedPatterns)
      .where(eq(learnedPatterns.id, id))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapToRecord(result[0]!);
  }

  /**
   * Update learned pattern
   */
  async update(id: string, input: UpdateLearnedPatternInput): Promise<LearnedPatternRecord | null> {
    const db = getDatabase();
    const now = new Date();

    const updateData: Record<string, unknown> = { updatedAt: now };

    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.triggerConditions !== undefined)
      updateData.triggerConditions = JSON.stringify(input.triggerConditions);
    if (input.recommendedActions !== undefined)
      updateData.recommendedActions = JSON.stringify(input.recommendedActions);
    if (input.confidence !== undefined) updateData.confidence = input.confidence;
    if (input.applicability !== undefined) updateData.applicability = input.applicability;
    if (input.exceptions !== undefined) updateData.exceptions = JSON.stringify(input.exceptions);
    if (input.timesMatched !== undefined) updateData.timesMatched = input.timesMatched;
    if (input.timesApplied !== undefined) updateData.timesApplied = input.timesApplied;
    if (input.successRate !== undefined) updateData.successRate = input.successRate;
    if (input.isActive !== undefined) updateData.isActive = input.isActive;

    await db.update(learnedPatterns).set(updateData).where(eq(learnedPatterns.id, id));

    return this.getById(id);
  }

  /**
   * Record that a pattern was matched
   */
  async recordMatch(id: string): Promise<LearnedPatternRecord | null> {
    const pattern = await this.getById(id);
    if (!pattern) return null;
    return this.update(id, { timesMatched: pattern.timesMatched + 1 });
  }

  /**
   * Record that a pattern was applied (and whether it succeeded)
   */
  async recordApplication(id: string, success: boolean): Promise<LearnedPatternRecord | null> {
    const pattern = await this.getById(id);
    if (!pattern) return null;

    const newTimesApplied = pattern.timesApplied + 1;
    const currentSuccesses = pattern.successRate
      ? Math.round(pattern.successRate * pattern.timesApplied)
      : 0;
    const newSuccesses = success ? currentSuccesses + 1 : currentSuccesses;
    const newSuccessRate = newSuccesses / newTimesApplied;

    return this.update(id, {
      timesApplied: newTimesApplied,
      successRate: newSuccessRate,
    });
  }

  /**
   * Deactivate a pattern
   */
  async deactivate(id: string): Promise<LearnedPatternRecord | null> {
    return this.update(id, { isActive: false });
  }

  /**
   * Activate a pattern
   */
  async activate(id: string): Promise<LearnedPatternRecord | null> {
    return this.update(id, { isActive: true });
  }

  /**
   * List learned patterns with filters
   */
  async list(
    filters: LearnedPatternFilters = {},
    limit = 50,
    offset = 0
  ): Promise<LearnedPatternRecord[]> {
    const db = getDatabase();

    const conditions = [];

    if (filters.type) {
      conditions.push(eq(learnedPatterns.type, filters.type));
    }
    if (filters.sourceIncidentId) {
      conditions.push(eq(learnedPatterns.sourceIncidentId, filters.sourceIncidentId));
    }
    if (filters.isActive !== undefined) {
      conditions.push(eq(learnedPatterns.isActive, filters.isActive));
    }
    if (filters.minConfidence !== undefined) {
      conditions.push(gte(learnedPatterns.confidence, filters.minConfidence));
    }

    const query = db
      .select()
      .from(learnedPatterns)
      .orderBy(desc(learnedPatterns.confidence))
      .limit(limit)
      .offset(offset);

    if (conditions.length > 0) {
      query.where(and(...conditions));
    }

    const results = await query;
    return results.map((r) => this.mapToRecord(r));
  }

  /**
   * Get active patterns by type
   */
  async getActiveByType(type: PatternType): Promise<LearnedPatternRecord[]> {
    return this.list({ type, isActive: true });
  }

  /**
   * Get high-confidence patterns (>= 0.8)
   */
  async getHighConfidence(): Promise<LearnedPatternRecord[]> {
    return this.list({ isActive: true, minConfidence: 0.8 });
  }

  /**
   * Find patterns that match given conditions
   * Searches for patterns whose trigger conditions partially match the provided keywords
   */
  async findMatching(keywords: string[]): Promise<LearnedPatternRecord[]> {
    const activePatterns = await this.list({ isActive: true });

    return activePatterns.filter((pattern) => {
      const conditions = pattern.triggerConditions.map((c) => c.toLowerCase());
      const lowerKeywords = keywords.map((k) => k.toLowerCase());

      // Check if any keyword matches any trigger condition
      return lowerKeywords.some((keyword) =>
        conditions.some(
          (condition) => condition.includes(keyword) || keyword.includes(condition)
        )
      );
    });
  }

  /**
   * Get patterns from a specific incident
   */
  async getByIncident(incidentId: string): Promise<LearnedPatternRecord[]> {
    return this.list({ sourceIncidentId: incidentId });
  }

  /**
   * Delete learned pattern
   */
  async delete(id: string): Promise<void> {
    const db = getDatabase();
    await db.delete(learnedPatterns).where(eq(learnedPatterns.id, id));
  }

  /**
   * Nullify source incident reference for all patterns linked to an incident
   * (Uses nullify instead of delete to preserve learned patterns)
   */
  async nullifyByIncidentId(incidentId: string): Promise<void> {
    const db = getDatabase();
    await db
      .update(learnedPatterns)
      .set({ sourceIncidentId: null })
      .where(eq(learnedPatterns.sourceIncidentId, incidentId));
  }

  /**
   * Map database row to record type
   */
  private mapToRecord(row: typeof learnedPatterns.$inferSelect): LearnedPatternRecord {
    return {
      id: row.id,
      type: row.type as PatternType,
      name: row.name,
      description: row.description,
      triggerConditions: JSON.parse(row.triggerConditions) as string[],
      recommendedActions: JSON.parse(row.recommendedActions) as string[],
      confidence: row.confidence,
      applicability: row.applicability,
      exceptions: JSON.parse(row.exceptions) as string[],
      timesMatched: row.timesMatched,
      timesApplied: row.timesApplied,
      successRate: row.successRate,
      sourceIncidentId: row.sourceIncidentId,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

// Singleton instance
export const learnedPatternRepository = new LearnedPatternRepository();

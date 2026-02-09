/**
 * Postmortem Repository
 * Stores investigation postmortems
 */

import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getDatabase } from '../connection.js';
import { postmortems } from '../schema.js';

export interface CreatePostmortemInput {
  incidentId: string;
  summary: string;
  timeline: string[];
  rootCauseAnalysis: string;
  impactAnalysis: string;
  actionsTaken: string[];
  lessonsLearned: string[];
  preventionRecommendations: string[];
  markdown: string;
}

export interface PostmortemRecord {
  id: string;
  incidentId: string;
  summary: string;
  timeline: string[];
  rootCauseAnalysis: string;
  impactAnalysis: string;
  actionsTaken: string[];
  lessonsLearned: string[];
  preventionRecommendations: string[];
  markdown: string;
  createdAt: Date;
}

export class PostmortemRepository {
  /**
   * Create a new postmortem
   */
  async create(input: CreatePostmortemInput): Promise<PostmortemRecord> {
    const db = getDatabase();
    const now = new Date();

    const record: typeof postmortems.$inferInsert = {
      id: randomUUID(),
      incidentId: input.incidentId,
      summary: input.summary,
      timeline: JSON.stringify(input.timeline),
      rootCauseAnalysis: input.rootCauseAnalysis,
      impactAnalysis: input.impactAnalysis,
      actionsTaken: JSON.stringify(input.actionsTaken),
      lessonsLearned: JSON.stringify(input.lessonsLearned),
      preventionRecommendations: JSON.stringify(input.preventionRecommendations),
      markdown: input.markdown,
      createdAt: now,
    };

    await db.insert(postmortems).values(record);

    return this.mapToPostmortem(record as typeof postmortems.$inferSelect);
  }

  /**
   * Get postmortem by ID
   */
  async getById(id: string): Promise<PostmortemRecord | null> {
    const db = getDatabase();
    const result = await db
      .select()
      .from(postmortems)
      .where(eq(postmortems.id, id))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapToPostmortem(result[0]!);
  }

  /**
   * Get postmortem by incident ID
   */
  async getByIncident(incidentId: string): Promise<PostmortemRecord | null> {
    const db = getDatabase();
    const result = await db
      .select()
      .from(postmortems)
      .where(eq(postmortems.incidentId, incidentId))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapToPostmortem(result[0]!);
  }

  /**
   * Delete postmortem by incident ID
   */
  async deleteByIncident(incidentId: string): Promise<void> {
    const db = getDatabase();
    await db.delete(postmortems).where(eq(postmortems.incidentId, incidentId));
  }

  /**
   * Map database row to PostmortemRecord type
   */
  private mapToPostmortem(row: typeof postmortems.$inferSelect): PostmortemRecord {
    return {
      id: row.id,
      incidentId: row.incidentId,
      summary: row.summary,
      timeline: JSON.parse(row.timeline),
      rootCauseAnalysis: row.rootCauseAnalysis,
      impactAnalysis: row.impactAnalysis,
      actionsTaken: JSON.parse(row.actionsTaken),
      lessonsLearned: JSON.parse(row.lessonsLearned),
      preventionRecommendations: JSON.parse(row.preventionRecommendations),
      markdown: row.markdown,
      createdAt: row.createdAt,
    };
  }
}

// Singleton instance
export const postmortemRepository = new PostmortemRepository();

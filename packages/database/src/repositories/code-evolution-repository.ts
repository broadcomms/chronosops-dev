/**
 * Code Evolution Repository
 * Tracks AI-powered code evolution requests
 */

import { eq, desc, and, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getDatabase } from '../connection.js';
import { codeEvolutions } from '../schema.js';

export type EvolutionStatus =
  | 'pending'
  | 'analyzing'
  | 'generating'
  | 'review'
  | 'approved'
  | 'rejected'
  | 'applied'
  | 'reverted'
  | 'failed';

export interface CreateEvolutionInput {
  developmentCycleId: string;
  prompt: string;
  scope?: string[];
}

export interface EvolutionAnalysisResult {
  summary: string;
  affectedFiles: string[];
  impactLevel: 'low' | 'medium' | 'high';
  risks: string[];
  recommendations: string[];
}

export interface ProposedChange {
  filePath: string;
  changeType: 'create' | 'modify' | 'delete';
  oldContent?: string;
  newContent?: string;
  diff?: string;
  description: string;
}

export interface UpdateEvolutionInput {
  status?: EvolutionStatus;
  analysisResult?: EvolutionAnalysisResult;
  proposedChanges?: ProposedChange[];
  filesAffected?: number;
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewNotes?: string;
  appliedAt?: Date;
  appliedCommitHash?: string;
  revertedAt?: Date;
  revertReason?: string;
  revertCommitHash?: string;
  error?: string;
  triggeredByIncidentId?: string;
}

export interface CodeEvolutionRecord {
  id: string;
  developmentCycleId: string;
  prompt: string;
  scope: string[] | null;
  status: EvolutionStatus;
  analysisResult: EvolutionAnalysisResult | null;
  proposedChanges: ProposedChange[] | null;
  filesAffected: number | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNotes: string | null;
  appliedAt: Date | null;
  appliedCommitHash: string | null;
  revertedAt: Date | null;
  revertReason: string | null;
  revertCommitHash: string | null;
  error: string | null;
  triggeredByIncidentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class CodeEvolutionRepository {
  /**
   * Create a new evolution request
   */
  async create(input: CreateEvolutionInput): Promise<CodeEvolutionRecord> {
    const db = getDatabase();
    const now = new Date();

    const evolution: typeof codeEvolutions.$inferInsert = {
      id: randomUUID(),
      developmentCycleId: input.developmentCycleId,
      prompt: input.prompt,
      scope: input.scope ? JSON.stringify(input.scope) : null,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(codeEvolutions).values(evolution);

    return this.mapToRecord(evolution as typeof codeEvolutions.$inferSelect);
  }

  /**
   * Get evolution by ID
   */
  async findById(id: string): Promise<CodeEvolutionRecord | null> {
    const db = getDatabase();
    const result = await db.select().from(codeEvolutions).where(eq(codeEvolutions.id, id)).limit(1);
    const row = result[0];
    return row ? this.mapToRecord(row) : null;
  }

  /**
   * Get all evolutions for a development cycle
   */
  async findByCycleId(developmentCycleId: string): Promise<CodeEvolutionRecord[]> {
    const db = getDatabase();
    const results = await db
      .select()
      .from(codeEvolutions)
      .where(eq(codeEvolutions.developmentCycleId, developmentCycleId))
      .orderBy(desc(codeEvolutions.createdAt));

    return results.map((r) => this.mapToRecord(r));
  }

  /**
   * Get evolutions by status
   */
  async findByStatus(status: EvolutionStatus | EvolutionStatus[]): Promise<CodeEvolutionRecord[]> {
    const db = getDatabase();
    const statuses = Array.isArray(status) ? status : [status];
    
    const results = await db
      .select()
      .from(codeEvolutions)
      .where(inArray(codeEvolutions.status, statuses))
      .orderBy(desc(codeEvolutions.createdAt));

    return results.map((r) => this.mapToRecord(r));
  }

  /**
   * Get pending evolutions for a cycle
   */
  async findPendingByCycleId(developmentCycleId: string): Promise<CodeEvolutionRecord[]> {
    const db = getDatabase();
    const results = await db
      .select()
      .from(codeEvolutions)
      .where(
        and(
          eq(codeEvolutions.developmentCycleId, developmentCycleId),
          inArray(codeEvolutions.status, ['pending', 'analyzing', 'generating', 'review'])
        )
      )
      .orderBy(desc(codeEvolutions.createdAt));

    return results.map((r) => this.mapToRecord(r));
  }

  /**
   * Update an evolution
   */
  async update(id: string, input: UpdateEvolutionInput): Promise<CodeEvolutionRecord | null> {
    const db = getDatabase();
    const now = new Date();

    const updateData: Partial<typeof codeEvolutions.$inferInsert> = {
      updatedAt: now,
    };

    if (input.status !== undefined) updateData.status = input.status;
    if (input.analysisResult !== undefined) updateData.analysisResult = JSON.stringify(input.analysisResult);
    if (input.proposedChanges !== undefined) updateData.proposedChanges = JSON.stringify(input.proposedChanges);
    if (input.filesAffected !== undefined) updateData.filesAffected = input.filesAffected;
    if (input.reviewedBy !== undefined) updateData.reviewedBy = input.reviewedBy;
    if (input.reviewedAt !== undefined) updateData.reviewedAt = input.reviewedAt;
    if (input.reviewNotes !== undefined) updateData.reviewNotes = input.reviewNotes;
    if (input.appliedAt !== undefined) updateData.appliedAt = input.appliedAt;
    if (input.appliedCommitHash !== undefined) updateData.appliedCommitHash = input.appliedCommitHash;
    if (input.revertedAt !== undefined) updateData.revertedAt = input.revertedAt;
    if (input.revertReason !== undefined) updateData.revertReason = input.revertReason;
    if (input.revertCommitHash !== undefined) updateData.revertCommitHash = input.revertCommitHash;
    if (input.error !== undefined) updateData.error = input.error;
    if (input.triggeredByIncidentId !== undefined) updateData.triggeredByIncidentId = input.triggeredByIncidentId;

    await db.update(codeEvolutions).set(updateData).where(eq(codeEvolutions.id, id));

    return this.findById(id);
  }

  /**
   * Mark evolution as approved
   */
  async approve(id: string, reviewedBy: string, notes?: string): Promise<CodeEvolutionRecord | null> {
    return this.update(id, {
      status: 'approved',
      reviewedBy,
      reviewedAt: new Date(),
      reviewNotes: notes,
    });
  }

  /**
   * Mark evolution as rejected
   */
  async reject(id: string, reviewedBy: string, notes?: string): Promise<CodeEvolutionRecord | null> {
    return this.update(id, {
      status: 'rejected',
      reviewedBy,
      reviewedAt: new Date(),
      reviewNotes: notes,
    });
  }

  /**
   * Mark evolution as applied
   */
  async markApplied(id: string, commitHash?: string): Promise<CodeEvolutionRecord | null> {
    return this.update(id, {
      status: 'applied',
      appliedAt: new Date(),
      appliedCommitHash: commitHash,
    });
  }

  /**
   * Mark evolution as reverted
   */
  async markReverted(id: string, reason: string, commitHash?: string): Promise<CodeEvolutionRecord | null> {
    return this.update(id, {
      status: 'reverted',
      revertedAt: new Date(),
      revertReason: reason,
      revertCommitHash: commitHash,
    });
  }

  /**
   * Mark evolution as failed
   */
  async markFailed(id: string, error: string): Promise<CodeEvolutionRecord | null> {
    return this.update(id, {
      status: 'failed',
      error,
    });
  }

  /**
   * Delete an evolution
   */
  async delete(id: string): Promise<boolean> {
    const db = getDatabase();
    const result = await db.delete(codeEvolutions).where(eq(codeEvolutions.id, id));
    return result.changes > 0;
  }

  /**
   * Delete all evolutions for a development cycle
   */
  async deleteByCycleId(developmentCycleId: string): Promise<number> {
    const db = getDatabase();
    const result = await db.delete(codeEvolutions).where(eq(codeEvolutions.developmentCycleId, developmentCycleId));
    return result.changes;
  }

  /**
   * Count pending evolutions for a cycle
   */
  async countPendingByCycleId(developmentCycleId: string): Promise<number> {
    const pending = await this.findPendingByCycleId(developmentCycleId);
    return pending.length;
  }

  /**
   * Parse JSON safely
   */
  private safeJsonParse<T>(value: string | null): T | null {
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  /**
   * Map database result to record type
   */
  private mapToRecord(row: typeof codeEvolutions.$inferSelect): CodeEvolutionRecord {
    return {
      id: row.id,
      developmentCycleId: row.developmentCycleId,
      prompt: row.prompt,
      scope: this.safeJsonParse<string[]>(row.scope),
      status: row.status as EvolutionStatus,
      analysisResult: this.safeJsonParse<EvolutionAnalysisResult>(row.analysisResult),
      proposedChanges: this.safeJsonParse<ProposedChange[]>(row.proposedChanges),
      filesAffected: row.filesAffected,
      reviewedBy: row.reviewedBy,
      reviewedAt: row.reviewedAt,
      reviewNotes: row.reviewNotes,
      appliedAt: row.appliedAt,
      appliedCommitHash: row.appliedCommitHash,
      revertedAt: row.revertedAt,
      revertReason: row.revertReason,
      revertCommitHash: row.revertCommitHash,
      error: row.error,
      triggeredByIncidentId: row.triggeredByIncidentId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

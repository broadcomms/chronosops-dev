/**
 * Action Repository
 */

import { eq, desc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getDatabase } from '../connection.js';
import { actions } from '../schema.js';

export type ActionType = 'rollback' | 'restart' | 'scale' | 'manual' | 'code_fix';
export type ActionStatus = 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled';

export interface CreateActionInput {
  incidentId: string;
  hypothesisId?: string;
  type: ActionType;
  target: string;
  parameters?: Record<string, unknown>;
  status?: ActionStatus;
  dryRun: boolean;
}

export interface UpdateActionInput {
  status?: ActionStatus;
  result?: Record<string, unknown>;
  executedAt?: Date;
  completedAt?: Date;
}

export interface ActionRecord {
  id: string;
  incidentId: string;
  hypothesisId: string | null;
  type: ActionType;
  target: string;
  parameters: Record<string, unknown> | null;
  status: ActionStatus;
  result: Record<string, unknown> | null;
  dryRun: boolean;
  executedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

export class ActionRepository {
  /**
   * Create a new action
   */
  async create(input: CreateActionInput): Promise<ActionRecord> {
    const db = getDatabase();
    const now = new Date();

    const record: typeof actions.$inferInsert = {
      id: randomUUID(),
      incidentId: input.incidentId,
      hypothesisId: input.hypothesisId ?? null,
      type: input.type,
      target: input.target,
      parameters: input.parameters ? JSON.stringify(input.parameters) : null,
      status: input.status ?? 'pending',
      result: null,
      dryRun: input.dryRun,
      executedAt: null,
      completedAt: null,
      createdAt: now,
    };

    await db.insert(actions).values(record);

    return this.mapToAction(record as typeof actions.$inferSelect);
  }

  /**
   * Get action by ID
   */
  async getById(id: string): Promise<ActionRecord | null> {
    const db = getDatabase();
    const result = await db
      .select()
      .from(actions)
      .where(eq(actions.id, id))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapToAction(result[0]!);
  }

  /**
   * Get all actions for an incident
   */
  async getByIncident(incidentId: string): Promise<ActionRecord[]> {
    const db = getDatabase();
    const results = await db
      .select()
      .from(actions)
      .where(eq(actions.incidentId, incidentId))
      .orderBy(desc(actions.createdAt));

    return results.map((r) => this.mapToAction(r));
  }

  /**
   * Update action
   */
  async update(id: string, input: UpdateActionInput): Promise<ActionRecord | null> {
    const db = getDatabase();

    const updateData: Partial<typeof actions.$inferInsert> = {};

    if (input.status !== undefined) {
      updateData.status = input.status;
    }
    if (input.result !== undefined) {
      updateData.result = JSON.stringify(input.result);
    }
    if (input.executedAt !== undefined) {
      updateData.executedAt = input.executedAt;
    }
    if (input.completedAt !== undefined) {
      updateData.completedAt = input.completedAt;
    }

    await db.update(actions).set(updateData).where(eq(actions.id, id));

    return this.getById(id);
  }

  /**
   * Delete actions for an incident
   */
  async deleteByIncident(incidentId: string): Promise<void> {
    const db = getDatabase();
    await db.delete(actions).where(eq(actions.incidentId, incidentId));
  }

  /**
   * Map database row to ActionRecord type
   */
  private mapToAction(row: typeof actions.$inferSelect): ActionRecord {
    return {
      id: row.id,
      incidentId: row.incidentId,
      hypothesisId: row.hypothesisId,
      type: row.type,
      target: row.target,
      parameters: row.parameters ? JSON.parse(row.parameters) : null,
      status: row.status,
      result: row.result ? JSON.parse(row.result) : null,
      dryRun: row.dryRun,
      executedAt: row.executedAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
    };
  }
}

// Singleton instance
export const actionRepository = new ActionRepository();

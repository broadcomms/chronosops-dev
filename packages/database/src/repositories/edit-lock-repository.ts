/**
 * Edit Lock Repository
 * Manages pessimistic locks for file editing
 */

import { eq, and, lt, gt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getDatabase } from '../connection.js';
import { editLocks } from '../schema.js';

export type LockType = 'edit' | 'evolution';
export type LockScope = 'file' | 'project';
export type LockStatus = 'active' | 'expired' | 'released';

export interface AcquireLockInput {
  developmentCycleId: string;
  lockedBy: string;
  lockedByName?: string;
  lockType: LockType;
  scope: LockScope;
  lockedFiles?: string[];
  timeoutMs: number;
}

export interface UpdateLockInput {
  expiresAt?: Date;
  lastHeartbeat?: Date;
  extensionCount?: number;
  status?: LockStatus;
  localBackup?: string;
}

export interface EditLockRecord {
  id: string;
  developmentCycleId: string;
  lockedBy: string;
  lockedByName: string | null;
  lockType: LockType;
  scope: LockScope;
  lockedFiles: string[] | null;
  acquiredAt: Date;
  expiresAt: Date;
  lastHeartbeat: Date;
  extensionCount: number;
  status: LockStatus;
  localBackup: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class EditLockRepository {
  /**
   * Acquire a lock
   */
  async acquire(input: AcquireLockInput): Promise<EditLockRecord> {
    const db = getDatabase();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.timeoutMs);

    const lock: typeof editLocks.$inferInsert = {
      id: randomUUID(),
      developmentCycleId: input.developmentCycleId,
      lockedBy: input.lockedBy,
      lockedByName: input.lockedByName,
      lockType: input.lockType,
      scope: input.scope,
      lockedFiles: input.lockedFiles ? JSON.stringify(input.lockedFiles) : null,
      acquiredAt: now,
      expiresAt,
      lastHeartbeat: now,
      extensionCount: 0,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(editLocks).values(lock);

    return this.mapToRecord(lock as typeof editLocks.$inferSelect);
  }

  /**
   * Get lock by ID
   */
  async findById(id: string): Promise<EditLockRecord | null> {
    const db = getDatabase();
    const result = await db.select().from(editLocks).where(eq(editLocks.id, id)).limit(1);
    const row = result[0];
    return row ? this.mapToRecord(row) : null;
  }

  /**
   * Get active lock for a development cycle
   */
  async findActiveByCycleId(developmentCycleId: string): Promise<EditLockRecord | null> {
    const db = getDatabase();
    const now = new Date();
    
    const result = await db
      .select()
      .from(editLocks)
      .where(
        and(
          eq(editLocks.developmentCycleId, developmentCycleId),
          eq(editLocks.status, 'active'),
          gt(editLocks.expiresAt, now)
        )
      )
      .limit(1);

    const row = result[0];
    return row ? this.mapToRecord(row) : null;
  }

  /**
   * Get all active locks for a user
   */
  async findActiveByUser(lockedBy: string): Promise<EditLockRecord[]> {
    const db = getDatabase();
    const now = new Date();
    
    const results = await db
      .select()
      .from(editLocks)
      .where(
        and(
          eq(editLocks.lockedBy, lockedBy),
          eq(editLocks.status, 'active'),
          gt(editLocks.expiresAt, now)
        )
      );

    return results.map((r) => this.mapToRecord(r));
  }

  /**
   * Update a lock
   */
  async update(id: string, input: UpdateLockInput): Promise<EditLockRecord | null> {
    const db = getDatabase();
    const now = new Date();

    const updateData: Partial<typeof editLocks.$inferInsert> = {
      updatedAt: now,
    };

    if (input.expiresAt !== undefined) updateData.expiresAt = input.expiresAt;
    if (input.lastHeartbeat !== undefined) updateData.lastHeartbeat = input.lastHeartbeat;
    if (input.extensionCount !== undefined) updateData.extensionCount = input.extensionCount;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.localBackup !== undefined) updateData.localBackup = input.localBackup;

    await db.update(editLocks).set(updateData).where(eq(editLocks.id, id));

    return this.findById(id);
  }

  /**
   * Extend a lock's expiration time
   */
  async extend(id: string, extensionMs: number): Promise<EditLockRecord | null> {
    const lock = await this.findById(id);
    if (!lock) return null;

    const now = new Date();
    const newExpiresAt = new Date(Math.max(lock.expiresAt.getTime(), now.getTime()) + extensionMs);

    return this.update(id, {
      expiresAt: newExpiresAt,
      lastHeartbeat: now,
      extensionCount: lock.extensionCount + 1,
    });
  }

  /**
   * Record a heartbeat for a lock
   */
  async heartbeat(id: string): Promise<EditLockRecord | null> {
    const now = new Date();
    return this.update(id, { lastHeartbeat: now });
  }

  /**
   * Release a lock
   */
  async release(id: string): Promise<EditLockRecord | null> {
    return this.update(id, { status: 'released' });
  }

  /**
   * Mark expired locks as expired
   */
  async expireStale(): Promise<number> {
    const db = getDatabase();
    const now = new Date();

    const result = await db
      .update(editLocks)
      .set({ status: 'expired', updatedAt: now })
      .where(
        and(
          eq(editLocks.status, 'active'),
          lt(editLocks.expiresAt, now)
        )
      );

    return result.changes;
  }

  /**
   * Save local backup for a lock (before expiry or for recovery)
   */
  async saveLocalBackup(id: string, backup: Record<string, string>): Promise<EditLockRecord | null> {
    return this.update(id, { localBackup: JSON.stringify(backup) });
  }

  /**
   * Get local backup for a lock
   */
  async getLocalBackup(id: string): Promise<Record<string, string> | null> {
    const lock = await this.findById(id);
    if (!lock || !lock.localBackup) return null;
    
    try {
      return JSON.parse(lock.localBackup);
    } catch {
      return null;
    }
  }

  /**
   * Get all locks for a development cycle (active and inactive)
   */
  async findByCycleId(developmentCycleId: string): Promise<EditLockRecord[]> {
    const db = getDatabase();
    
    const results = await db
      .select()
      .from(editLocks)
      .where(eq(editLocks.developmentCycleId, developmentCycleId));

    return results.map((r) => this.mapToRecord(r));
  }

  /**
   * Delete a lock
   */
  async delete(id: string): Promise<boolean> {
    const db = getDatabase();
    const result = await db.delete(editLocks).where(eq(editLocks.id, id));
    return result.changes > 0;
  }

  /**
   * Delete all locks for a development cycle
   */
  async deleteByCycleId(developmentCycleId: string): Promise<number> {
    const db = getDatabase();
    const result = await db.delete(editLocks).where(eq(editLocks.developmentCycleId, developmentCycleId));
    return result.changes;
  }

  /**
   * Check if a user can acquire a lock (no active lock exists or they own it)
   */
  async canAcquire(developmentCycleId: string, lockedBy: string): Promise<{ canAcquire: boolean; existingLock?: EditLockRecord }> {
    const existingLock = await this.findActiveByCycleId(developmentCycleId);
    
    if (!existingLock) {
      return { canAcquire: true };
    }
    
    if (existingLock.lockedBy === lockedBy) {
      return { canAcquire: true, existingLock };
    }
    
    return { canAcquire: false, existingLock };
  }

  /**
   * Map database result to record type
   */
  private mapToRecord(row: typeof editLocks.$inferSelect): EditLockRecord {
    return {
      id: row.id,
      developmentCycleId: row.developmentCycleId,
      lockedBy: row.lockedBy,
      lockedByName: row.lockedByName,
      lockType: row.lockType as LockType,
      scope: row.scope as LockScope,
      lockedFiles: row.lockedFiles ? JSON.parse(row.lockedFiles) : null,
      acquiredAt: row.acquiredAt,
      expiresAt: row.expiresAt,
      lastHeartbeat: row.lastHeartbeat,
      extensionCount: row.extensionCount,
      status: row.status as LockStatus,
      localBackup: row.localBackup,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

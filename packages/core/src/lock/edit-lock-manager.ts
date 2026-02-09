/**
 * Edit Lock Manager
 * Handles pessimistic locking for file editing with:
 * - 30-minute timeout with 5-minute activity extension
 * - Heartbeat mechanism
 * - Local backup on lock expiry
 * - Max extensions limit
 */

import { createLogger, Logger, getConfig } from '@chronosops/shared';
import {
  EditLockRepository,
  EditLockRecord,
  LockType,
  LockScope,
} from '@chronosops/database';

export interface LockManagerOptions {
  repository?: EditLockRepository;
  logger?: Logger;
}

export interface AcquireLockOptions {
  developmentCycleId: string;
  userId: string;
  userName?: string;
  lockType?: LockType;
  scope?: LockScope;
  files?: string[];
}

export interface LockAcquisitionResult {
  success: boolean;
  lock?: EditLockRecord;
  error?: string;
  existingLock?: EditLockRecord;
}

export interface HeartbeatResult {
  success: boolean;
  lock?: EditLockRecord;
  extended?: boolean;
  error?: string;
}

export interface ReleaseLockResult {
  success: boolean;
  error?: string;
}

export interface LockInfo {
  isLocked: boolean;
  lock?: EditLockRecord;
  isOwnLock: boolean;
  remainingMs: number;
  canExtend: boolean;
}

export class EditLockManager {
  private readonly repository: EditLockRepository;
  private readonly logger: Logger;
  private readonly config: ReturnType<typeof getConfig>['editLock'];
  private heartbeatIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(options: LockManagerOptions = {}) {
    this.repository = options.repository ?? new EditLockRepository();
    this.logger = options.logger ?? createLogger('EditLockManager');
    this.config = getConfig().editLock;
  }

  /**
   * Acquire a lock for a development cycle
   */
  async acquireLock(options: AcquireLockOptions): Promise<LockAcquisitionResult> {
    const { developmentCycleId, userId, userName, lockType = 'edit', scope = 'project', files } = options;

    this.logger.info(
      { developmentCycleId, userId, lockType, scope },
      'Attempting to acquire lock'
    );

    try {
      // Check if lock can be acquired
      const canAcquireResult = await this.repository.canAcquire(developmentCycleId, userId);

      if (!canAcquireResult.canAcquire) {
        const existingLock = canAcquireResult.existingLock!;
        this.logger.info(
          { developmentCycleId, lockedBy: existingLock.lockedBy, expiresAt: existingLock.expiresAt },
          'Lock already held by another user'
        );

        return {
          success: false,
          error: `Project is currently locked by ${existingLock.lockedByName ?? existingLock.lockedBy}`,
          existingLock,
        };
      }

      // If user already has an active lock, return it (refresh heartbeat)
      if (canAcquireResult.existingLock) {
        const refreshedLock = await this.repository.heartbeat(canAcquireResult.existingLock.id);
        this.logger.info(
          { developmentCycleId, lockId: canAcquireResult.existingLock.id },
          'Refreshed existing lock'
        );

        return {
          success: true,
          lock: refreshedLock ?? canAcquireResult.existingLock,
        };
      }

      // Expire any stale locks first
      await this.repository.expireStale();

      // Acquire new lock
      const lock = await this.repository.acquire({
        developmentCycleId,
        lockedBy: userId,
        lockedByName: userName,
        lockType,
        scope,
        lockedFiles: files,
        timeoutMs: this.config.timeoutMs,
      });

      this.logger.info(
        { developmentCycleId, lockId: lock.id, expiresAt: lock.expiresAt },
        'Lock acquired'
      );

      return { success: true, lock };
    } catch (error: unknown) {
      const err = error as { message?: string };
      const errorMessage = err.message ?? 'Failed to acquire lock';
      this.logger.error({ error: errorMessage, developmentCycleId }, 'Lock acquisition failed');
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Release a lock
   */
  async releaseLock(lockId: string, userId: string): Promise<ReleaseLockResult> {
    this.logger.info({ lockId, userId }, 'Attempting to release lock');

    try {
      const lock = await this.repository.findById(lockId);

      if (!lock) {
        return { success: true }; // Lock doesn't exist, consider it released
      }

      // Verify ownership
      if (lock.lockedBy !== userId) {
        return { success: false, error: 'Cannot release lock owned by another user' };
      }

      // Stop heartbeat if running
      this.stopHeartbeat(lockId);

      // Release the lock
      await this.repository.release(lockId);

      this.logger.info({ lockId }, 'Lock released');
      return { success: true };
    } catch (error: unknown) {
      const err = error as { message?: string };
      const errorMessage = err.message ?? 'Failed to release lock';
      this.logger.error({ error: errorMessage, lockId }, 'Lock release failed');
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Process a heartbeat - extends lock if near expiry
   */
  async heartbeat(lockId: string, userId: string): Promise<HeartbeatResult> {
    try {
      const lock = await this.repository.findById(lockId);

      if (!lock) {
        return { success: false, error: 'Lock not found' };
      }

      if (lock.lockedBy !== userId) {
        return { success: false, error: 'Lock owned by another user' };
      }

      if (lock.status !== 'active') {
        return { success: false, error: `Lock is ${lock.status}` };
      }

      const now = Date.now();
      const expiresAt = lock.expiresAt.getTime();
      const remainingMs = expiresAt - now;

      // Check if we should extend (if less than half the extension time remaining)
      const shouldExtend = remainingMs < this.config.extendOnActivityMs / 2;
      const canExtend = lock.extensionCount < this.config.maxExtensions;

      if (shouldExtend && canExtend) {
        // Extend the lock
        const extendedLock = await this.repository.extend(lockId, this.config.extendOnActivityMs);
        this.logger.debug(
          { lockId, newExpiresAt: extendedLock?.expiresAt, extensionCount: extendedLock?.extensionCount },
          'Lock extended on heartbeat'
        );
        return { success: true, lock: extendedLock ?? lock, extended: true };
      }

      // Just update heartbeat
      const updatedLock = await this.repository.heartbeat(lockId);
      return { success: true, lock: updatedLock ?? lock, extended: false };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return { success: false, error: err.message ?? 'Heartbeat failed' };
    }
  }

  /**
   * Start automatic heartbeat for a lock
   */
  startHeartbeat(lockId: string, userId: string): void {
    // Stop any existing heartbeat
    this.stopHeartbeat(lockId);

    const interval = setInterval(async () => {
      const result = await this.heartbeat(lockId, userId);
      if (!result.success) {
        this.logger.warn({ lockId, error: result.error }, 'Heartbeat failed, stopping');
        this.stopHeartbeat(lockId);
      }
    }, this.config.heartbeatIntervalMs);

    this.heartbeatIntervals.set(lockId, interval);
    this.logger.debug({ lockId, intervalMs: this.config.heartbeatIntervalMs }, 'Started heartbeat');
  }

  /**
   * Stop automatic heartbeat for a lock
   */
  stopHeartbeat(lockId: string): void {
    const interval = this.heartbeatIntervals.get(lockId);
    if (interval) {
      clearInterval(interval);
      this.heartbeatIntervals.delete(lockId);
      this.logger.debug({ lockId }, 'Stopped heartbeat');
    }
  }

  /**
   * Get lock info for a development cycle
   */
  async getLockInfo(developmentCycleId: string, userId: string): Promise<LockInfo> {
    const lock = await this.repository.findActiveByCycleId(developmentCycleId);

    if (!lock) {
      return {
        isLocked: false,
        isOwnLock: false,
        remainingMs: 0,
        canExtend: false,
      };
    }

    const now = Date.now();
    const expiresAt = lock.expiresAt.getTime();
    const remainingMs = Math.max(0, expiresAt - now);
    const isOwnLock = lock.lockedBy === userId;
    const canExtend = isOwnLock && lock.extensionCount < this.config.maxExtensions;

    return {
      isLocked: true,
      lock,
      isOwnLock,
      remainingMs,
      canExtend,
    };
  }

  /**
   * Save unsaved changes as local backup before lock expires
   */
  async saveLocalBackup(lockId: string, changes: Record<string, string>): Promise<boolean> {
    try {
      await this.repository.saveLocalBackup(lockId, changes);
      this.logger.info({ lockId, fileCount: Object.keys(changes).length }, 'Local backup saved');
      return true;
    } catch (error: unknown) {
      const err = error as { message?: string };
      this.logger.error({ error: err.message, lockId }, 'Failed to save local backup');
      return false;
    }
  }

  /**
   * Get local backup for a lock
   */
  async getLocalBackup(lockId: string): Promise<Record<string, string> | null> {
    return this.repository.getLocalBackup(lockId);
  }

  /**
   * Expire stale locks (run periodically)
   */
  async expireStaleLocks(): Promise<number> {
    const expired = await this.repository.expireStale();
    if (expired > 0) {
      this.logger.info({ count: expired }, 'Expired stale locks');
    }
    return expired;
  }

  /**
   * Force release a lock (admin operation)
   */
  async forceRelease(lockId: string): Promise<ReleaseLockResult> {
    this.logger.warn({ lockId }, 'Force releasing lock');
    
    try {
      this.stopHeartbeat(lockId);
      await this.repository.release(lockId);
      return { success: true };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return { success: false, error: err.message ?? 'Force release failed' };
    }
  }

  /**
   * Clean up on shutdown
   */
  shutdown(): void {
    for (const [lockId] of this.heartbeatIntervals) {
      this.stopHeartbeat(lockId);
    }
    this.logger.info('Lock manager shutdown complete');
  }
}

// Singleton instance
let lockManagerInstance: EditLockManager | null = null;

export function getEditLockManager(): EditLockManager {
  if (!lockManagerInstance) {
    lockManagerInstance = new EditLockManager();
  }
  return lockManagerInstance;
}

export function resetEditLockManager(): void {
  if (lockManagerInstance) {
    lockManagerInstance.shutdown();
    lockManagerInstance = null;
  }
}

/**
 * Action Cooldown Manager
 * Prevents rapid execution of actions on the same target
 */

import { createChildLogger } from '@chronosops/shared';
import type { ActionType } from './types.js';

const logger = createChildLogger({ component: 'CooldownManager' });

export interface CooldownConfig {
  /** Default cooldown in milliseconds */
  defaultCooldownMs: number;
  /** Per-action-type cooldowns (overrides default) */
  actionCooldowns?: Partial<Record<ActionType, number>>;
  /** Maximum actions per target within a time window */
  maxActionsPerWindow?: number;
  /** Time window for max actions limit (ms) */
  windowMs?: number;
}

interface CooldownEntry {
  lastActionTime: number;
  actionType: ActionType;
  actionCount: number;
  windowStart: number;
}

const DEFAULT_CONFIG: CooldownConfig = {
  defaultCooldownMs: 60000, // 1 minute default cooldown
  actionCooldowns: {
    restart: 60000,   // 1 minute between restarts
    rollback: 120000, // 2 minutes between rollbacks
    scale: 30000,     // 30 seconds between scales
  },
  maxActionsPerWindow: 5,  // Max 5 actions per target
  windowMs: 300000,        // within 5 minutes
};

/**
 * Manages cooldowns for action execution
 */
export class CooldownManager {
  private config: Required<CooldownConfig>;
  private cooldowns: Map<string, CooldownEntry> = new Map();

  constructor(config: Partial<CooldownConfig> = {}) {
    this.config = {
      defaultCooldownMs: config.defaultCooldownMs ?? DEFAULT_CONFIG.defaultCooldownMs,
      actionCooldowns: { ...DEFAULT_CONFIG.actionCooldowns, ...config.actionCooldowns },
      maxActionsPerWindow: config.maxActionsPerWindow ?? DEFAULT_CONFIG.maxActionsPerWindow!,
      windowMs: config.windowMs ?? DEFAULT_CONFIG.windowMs!,
    };
  }

  /**
   * Generate a unique key for a target
   */
  private getTargetKey(namespace: string, deployment: string): string {
    return `${namespace}/${deployment}`;
  }

  /**
   * Get cooldown duration for an action type
   */
  private getCooldownDuration(actionType: ActionType): number {
    return this.config.actionCooldowns?.[actionType] ?? this.config.defaultCooldownMs;
  }

  /**
   * Check if an action can be executed (not on cooldown)
   */
  canExecute(
    namespace: string,
    deployment: string,
    actionType: ActionType
  ): { allowed: boolean; reason?: string; retryAfterMs?: number } {
    const key = this.getTargetKey(namespace, deployment);
    const entry = this.cooldowns.get(key);
    const now = Date.now();

    if (!entry) {
      return { allowed: true };
    }

    // Check rate limiting (max actions per window)
    if (now - entry.windowStart < this.config.windowMs) {
      if (entry.actionCount >= this.config.maxActionsPerWindow) {
        const retryAfterMs = this.config.windowMs - (now - entry.windowStart);
        logger.warn(
          { namespace, deployment, actionCount: entry.actionCount },
          'Rate limit exceeded for target'
        );
        return {
          allowed: false,
          reason: `Rate limit exceeded: ${entry.actionCount} actions in ${Math.round(this.config.windowMs / 1000)}s window. Max: ${this.config.maxActionsPerWindow}`,
          retryAfterMs,
        };
      }
    }

    // Check cooldown for specific action
    const cooldownDuration = this.getCooldownDuration(actionType);
    const timeSinceLastAction = now - entry.lastActionTime;

    if (timeSinceLastAction < cooldownDuration) {
      const retryAfterMs = cooldownDuration - timeSinceLastAction;
      logger.warn(
        { namespace, deployment, actionType, retryAfterMs },
        'Action on cooldown'
      );
      return {
        allowed: false,
        reason: `Action '${actionType}' is on cooldown. Last action was ${Math.round(timeSinceLastAction / 1000)}s ago. Cooldown: ${Math.round(cooldownDuration / 1000)}s`,
        retryAfterMs,
      };
    }

    return { allowed: true };
  }

  /**
   * Record an action execution
   */
  recordAction(namespace: string, deployment: string, actionType: ActionType): void {
    const key = this.getTargetKey(namespace, deployment);
    const now = Date.now();
    const existing = this.cooldowns.get(key);

    if (existing && now - existing.windowStart < this.config.windowMs) {
      // Update existing entry within the same window
      this.cooldowns.set(key, {
        lastActionTime: now,
        actionType,
        actionCount: existing.actionCount + 1,
        windowStart: existing.windowStart,
      });
    } else {
      // Start a new window
      this.cooldowns.set(key, {
        lastActionTime: now,
        actionType,
        actionCount: 1,
        windowStart: now,
      });
    }

    logger.info(
      { namespace, deployment, actionType },
      'Action recorded for cooldown tracking'
    );
  }

  /**
   * Clear cooldown for a target (e.g., after successful verification)
   */
  clearCooldown(namespace: string, deployment: string): void {
    const key = this.getTargetKey(namespace, deployment);
    this.cooldowns.delete(key);
    logger.info({ namespace, deployment }, 'Cooldown cleared for target');
  }

  /**
   * Get remaining cooldown time for a target
   */
  getRemainingCooldown(
    namespace: string,
    deployment: string,
    actionType: ActionType
  ): number {
    const key = this.getTargetKey(namespace, deployment);
    const entry = this.cooldowns.get(key);

    if (!entry) {
      return 0;
    }

    const cooldownDuration = this.getCooldownDuration(actionType);
    const elapsed = Date.now() - entry.lastActionTime;
    const remaining = cooldownDuration - elapsed;

    return remaining > 0 ? remaining : 0;
  }

  /**
   * Get current stats for monitoring
   */
  getStats(): {
    trackedTargets: number;
    cooldownsByTarget: Array<{
      target: string;
      actionCount: number;
      lastActionType: ActionType;
      lastActionAgo: number;
    }>;
  } {
    const now = Date.now();
    const cooldownsByTarget = Array.from(this.cooldowns.entries()).map(([key, entry]) => ({
      target: key,
      actionCount: entry.actionCount,
      lastActionType: entry.actionType,
      lastActionAgo: now - entry.lastActionTime,
    }));

    return {
      trackedTargets: this.cooldowns.size,
      cooldownsByTarget,
    };
  }

  /**
   * Clean up expired entries (call periodically)
   */
  cleanup(): void {
    const now = Date.now();
    const maxAge = this.config.windowMs * 2; // Keep entries for 2x the window

    for (const [key, entry] of this.cooldowns.entries()) {
      if (now - entry.lastActionTime > maxAge) {
        this.cooldowns.delete(key);
      }
    }
  }
}

// Singleton instance for global cooldown management
let globalCooldownManager: CooldownManager | null = null;

export function getCooldownManager(config?: Partial<CooldownConfig>): CooldownManager {
  if (!globalCooldownManager) {
    globalCooldownManager = new CooldownManager(config);
  }
  return globalCooldownManager;
}

export function resetCooldownManager(): void {
  globalCooldownManager = null;
}

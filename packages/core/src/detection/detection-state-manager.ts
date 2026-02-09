/**
 * Detection State Manager
 * Manages cooldowns, duplicate detection, and rate limiting for autonomous anomaly detection
 * Also tracks pending evolutions to prevent duplicate incidents during code fixes
 */

import { createChildLogger } from '@chronosops/shared';

const logger = createChildLogger({ component: 'DetectionStateManager' });

/**
 * Pending evolution record for evolution-aware cooldown
 */
export interface PendingEvolutionRecord {
  evolutionId: string;
  startTime: number;
}

/**
 * Anomaly fingerprint for deduplication
 */
export interface AnomalyFingerprint {
  type: string;
  severity: string;
  timestamp: number;
  incidentId?: string;
}

/**
 * App investigation record for post-investigation cooldown
 */
export interface AppInvestigationRecord {
  timestamp: number;
  incidentId: string;
  cooldownUntil: number;
}

/**
 * Detection state configuration
 */
export interface DetectionStateConfig {
  cooldownMs: number;
  maxConcurrentInvestigations: number;
  fingerprintTtlMs: number;
  postInvestigationCooldownMs: number;
}

const DEFAULT_CONFIG: DetectionStateConfig = {
  cooldownMs: 300000, // 5 minutes
  maxConcurrentInvestigations: 3,
  fingerprintTtlMs: 600000, // 10 minutes TTL for fingerprints
  postInvestigationCooldownMs: 300000, // 5 minutes post-investigation cooldown
};

/**
 * DetectionStateManager - Prevents duplicate detections and manages rate limiting
 */
export class DetectionStateManager {
  private config: DetectionStateConfig;
  private recentAnomalies: Map<string, AnomalyFingerprint> = new Map();
  private activeInvestigations: Set<string> = new Set();
  private appInvestigationHistory: Map<string, AppInvestigationRecord> = new Map();
  private pendingEvolutionApps: Map<string, PendingEvolutionRecord> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  // Singleton instance
  private static instance: DetectionStateManager | null = null;

  constructor(config: Partial<DetectionStateConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startCleanup();
  }

  /**
   * Get singleton instance of DetectionStateManager
   * Creates a new instance with default config if none exists
   */
  static getInstance(config?: Partial<DetectionStateConfig>): DetectionStateManager {
    if (!DetectionStateManager.instance) {
      DetectionStateManager.instance = new DetectionStateManager(config);
    }
    return DetectionStateManager.instance;
  }

  /**
   * Reset singleton instance (for testing)
   */
  static resetInstance(): void {
    if (DetectionStateManager.instance) {
      DetectionStateManager.instance.stop();
      DetectionStateManager.instance = null;
    }
  }

  /**
   * Generate a unique fingerprint key for an anomaly
   */
  private generateFingerprintKey(type: string, description: string): string {
    // Normalize the description to avoid minor text differences causing duplicates
    const normalizedDesc = description.toLowerCase().slice(0, 100);
    return `${type}:${normalizedDesc}`;
  }

  /**
   * Check if an anomaly should trigger an incident
   * Returns true if the anomaly is new and not in cooldown
   * @param appName - Optional app name for post-investigation cooldown check
   */
  shouldTriggerIncident(
    type: string,
    _severity: string,
    description: string,
    appName?: string
  ): { shouldTrigger: boolean; reason?: string } {
    // Check concurrent investigation limit
    if (this.activeInvestigations.size >= this.config.maxConcurrentInvestigations) {
      return {
        shouldTrigger: false,
        reason: `Max concurrent investigations (${this.config.maxConcurrentInvestigations}) reached`,
      };
    }

    // Check app post-investigation cooldown
    if (appName) {
      const appRecord = this.appInvestigationHistory.get(appName);
      if (appRecord && Date.now() < appRecord.cooldownUntil) {
        const remainingMs = appRecord.cooldownUntil - Date.now();
        const remainingSec = Math.ceil(remainingMs / 1000);
        return {
          shouldTrigger: false,
          reason: `App "${appName}" recently investigated (${remainingSec}s post-investigation cooldown remaining)`,
        };
      }

      // Check if app has pending evolution (prevents duplicates during code fix)
      if (this.hasPendingEvolution(appName)) {
        const pending = this.pendingEvolutionApps.get(appName)!;
        return {
          shouldTrigger: false,
          reason: `App "${appName}" has pending code evolution (${pending.evolutionId})`,
        };
      }
    }

    // Check fingerprint cooldown
    const key = this.generateFingerprintKey(type, description);
    const existing = this.recentAnomalies.get(key);

    if (existing) {
      const elapsed = Date.now() - existing.timestamp;
      if (elapsed < this.config.cooldownMs) {
        const remaining = Math.ceil((this.config.cooldownMs - elapsed) / 1000);
        return {
          shouldTrigger: false,
          reason: `Similar anomaly detected ${remaining}s ago (cooldown active)`,
        };
      }
    }

    return { shouldTrigger: true };
  }

  /**
   * Record a detected anomaly
   */
  recordAnomaly(type: string, description: string, incidentId?: string): void {
    const key = this.generateFingerprintKey(type, description);
    const fingerprint: AnomalyFingerprint = {
      type,
      severity: 'high', // Default severity for recorded anomalies
      timestamp: Date.now(),
      incidentId,
    };
    this.recentAnomalies.set(key, fingerprint);
    logger.debug({ key, incidentId }, 'Recorded anomaly fingerprint');
  }

  /**
   * Start tracking an active investigation
   */
  startInvestigation(incidentId: string): void {
    this.activeInvestigations.add(incidentId);
    logger.info(
      { incidentId, activeCount: this.activeInvestigations.size },
      'Started tracking investigation'
    );
  }

  /**
   * Stop tracking an active investigation and optionally register app-level cooldown
   * @param appName - Optional app name to register post-investigation cooldown
   * @param postInvestigationCooldownMs - Optional cooldown duration (defaults to config)
   */
  completeInvestigation(
    incidentId: string,
    appName?: string,
    postInvestigationCooldownMs?: number
  ): void {
    this.activeInvestigations.delete(incidentId);

    // Register post-investigation cooldown for the app
    if (appName) {
      const cooldownMs = postInvestigationCooldownMs ?? this.config.postInvestigationCooldownMs;
      this.appInvestigationHistory.set(appName, {
        timestamp: Date.now(),
        incidentId,
        cooldownUntil: Date.now() + cooldownMs,
      });
      logger.info(
        { appName, incidentId, cooldownSeconds: cooldownMs / 1000 },
        'Registered post-investigation cooldown for app'
      );
    }

    logger.info(
      { incidentId, activeCount: this.activeInvestigations.size },
      'Completed investigation tracking'
    );
  }

  /**
   * Get current state for status reporting
   */
  getState(): {
    activeInvestigations: number;
    recentAnomalyCount: number;
    cooldownMs: number;
    appsInCooldown: number;
    appsWithPendingEvolution: number;
  } {
    return {
      activeInvestigations: this.activeInvestigations.size,
      recentAnomalyCount: this.recentAnomalies.size,
      cooldownMs: this.config.cooldownMs,
      appsInCooldown: this.appInvestigationHistory.size,
      appsWithPendingEvolution: this.pendingEvolutionApps.size,
    };
  }

  /**
   * Clear all state (useful for testing)
   */
  clear(): void {
    this.recentAnomalies.clear();
    this.activeInvestigations.clear();
    this.appInvestigationHistory.clear();
    this.pendingEvolutionApps.clear();
    logger.info('Cleared all detection state');
  }

  /**
   * Start cleanup interval for expired fingerprints
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredFingerprints();
    }, 60000); // Cleanup every minute
  }

  /**
   * Stop cleanup interval
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Remove expired fingerprints and app investigation records
   */
  private cleanupExpiredFingerprints(): void {
    const now = Date.now();
    let removedFingerprints = 0;
    let removedAppRecords = 0;
    let removedEvolutionRecords = 0;

    // Clean fingerprints
    for (const [key, fingerprint] of this.recentAnomalies.entries()) {
      if (now - fingerprint.timestamp > this.config.fingerprintTtlMs) {
        this.recentAnomalies.delete(key);
        removedFingerprints++;
      }
    }

    // Clean expired app investigation records
    for (const [appName, record] of this.appInvestigationHistory.entries()) {
      if (now > record.cooldownUntil) {
        this.appInvestigationHistory.delete(appName);
        removedAppRecords++;
        logger.debug({ appName }, 'Cleared app investigation cooldown (expired)');
      }
    }

    // Clean expired pending evolution records (30 min max wait)
    const maxEvolutionWaitMs = 30 * 60 * 1000;
    for (const [appName, record] of this.pendingEvolutionApps.entries()) {
      if (now - record.startTime > maxEvolutionWaitMs) {
        this.pendingEvolutionApps.delete(appName);
        removedEvolutionRecords++;
        logger.debug({ appName, evolutionId: record.evolutionId }, 'Cleared expired evolution cooldown');
      }
    }

    if (removedFingerprints > 0 || removedAppRecords > 0 || removedEvolutionRecords > 0) {
      logger.debug(
        { removedFingerprints, removedAppRecords, removedEvolutionRecords },
        'Cleaned up expired records'
      );
    }
  }

  // ===========================================
  // Evolution-Aware Cooldown Methods
  // ===========================================

  /**
   * Register that an app has a pending evolution (prevents new incidents)
   * Used when code_fix action is triggered during escalating remediation
   */
  registerPendingEvolution(appName: string, evolutionId: string): void {
    this.pendingEvolutionApps.set(appName, {
      evolutionId,
      startTime: Date.now(),
    });
    logger.info({ appName, evolutionId }, 'Registered pending evolution cooldown');
  }

  /**
   * Clear pending evolution cooldown when evolution completes
   * Called when evolution is applied, rejected, or failed
   */
  clearPendingEvolution(appName: string): void {
    const existing = this.pendingEvolutionApps.get(appName);
    if (existing) {
      this.pendingEvolutionApps.delete(appName);
      logger.info({ appName, evolutionId: existing.evolutionId }, 'Cleared pending evolution cooldown');
    }
  }

  /**
   * Check if app has pending evolution
   * Returns true if evolution is pending and hasn't exceeded max wait time
   */
  hasPendingEvolution(appName: string): boolean {
    const pending = this.pendingEvolutionApps.get(appName);
    if (!pending) return false;

    // Auto-expire after 30 minutes (failsafe)
    const maxEvolutionWaitMs = 30 * 60 * 1000;
    if (Date.now() - pending.startTime > maxEvolutionWaitMs) {
      this.pendingEvolutionApps.delete(appName);
      logger.warn({ appName, evolutionId: pending.evolutionId }, 'Evolution cooldown auto-expired (30 min timeout)');
      return false;
    }

    return true;
  }

  /**
   * Get pending evolution info for an app
   * Returns null if no pending evolution or if expired
   */
  getPendingEvolution(appName: string): PendingEvolutionRecord | null {
    if (!this.hasPendingEvolution(appName)) {
      return null;
    }
    return this.pendingEvolutionApps.get(appName) ?? null;
  }
}

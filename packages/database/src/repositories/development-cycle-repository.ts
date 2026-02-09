/**
 * Development Cycle Repository
 */

import { eq, desc, and, isNull, ne } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { DevelopmentPhase, ServiceType } from '@chronosops/shared';
import { getDatabase } from '../connection.js';
import { developmentCycles } from '../schema.js';

export type RequirementSource = 'user' | 'incident' | 'improvement' | 'pattern';
export type RequirementPriority = 'low' | 'medium' | 'high' | 'critical';
export type StorageMode = 'memory' | 'sqlite' | 'postgres';

export interface CreateDevelopmentCycleInput {
  requirementSource: RequirementSource;
  requirementRaw: string;
  requirementPriority: RequirementPriority;
  triggeredByIncidentId?: string;
  maxIterations?: number;
  /** Service type: backend, frontend, or fullstack */
  serviceType?: ServiceType;
  /** Frontend configuration (JSON) - for frontend/fullstack types */
  frontendConfig?: string;
  /** Storage mode for database persistence: memory, sqlite, or postgres */
  storageMode?: StorageMode;
}

export interface UpdateDevelopmentCycleInput {
  phase?: DevelopmentPhase;
  analyzedRequirement?: string; // JSON
  architecture?: string; // JSON
  architectureDiagramUrl?: string; // URL path to generated diagram image
  generatedCodeSummary?: string; // JSON
  testResults?: string; // JSON
  buildResult?: string; // JSON
  deployment?: string; // JSON
  verification?: string; // JSON
  iterations?: number;
  error?: string; // JSON
  thoughtSignature?: string;
  /** Per-phase retry tracking (JSON) */
  phaseRetries?: string;
  completedAt?: Date;
}

export interface DevelopmentCycleFilters {
  phase?: DevelopmentPhase;
  requirementSource?: RequirementSource;
  requirementPriority?: RequirementPriority;
  triggeredByIncidentId?: string;
  isActive?: boolean; // Not completed or failed
}

export interface DevelopmentCycleRecord {
  id: string;
  phase: DevelopmentPhase;
  serviceType: ServiceType;
  frontendConfig: string | null;
  storageMode: StorageMode;
  requirementSource: RequirementSource;
  requirementRaw: string;
  requirementPriority: RequirementPriority;
  analyzedRequirement: string | null;
  architecture: string | null;
  architectureDiagramUrl: string | null;
  generatedCodeSummary: string | null;
  testResults: string | null;
  buildResult: string | null;
  deployment: string | null;
  verification: string | null;
  triggeredByIncidentId: string | null;
  iterations: number;
  maxIterations: number;
  error: string | null;
  thoughtSignature: string | null;
  /** Per-phase retry tracking (JSON) */
  phaseRetries: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export class DevelopmentCycleRepository {
  /**
   * Create a new development cycle
   */
  async create(input: CreateDevelopmentCycleInput): Promise<DevelopmentCycleRecord> {
    const db = getDatabase();
    const now = new Date();

    const cycle: typeof developmentCycles.$inferInsert = {
      id: randomUUID(),
      phase: 'IDLE',
      serviceType: input.serviceType ?? 'backend',
      frontendConfig: input.frontendConfig ?? null,
      storageMode: input.storageMode ?? 'memory',
      requirementSource: input.requirementSource,
      requirementRaw: input.requirementRaw,
      requirementPriority: input.requirementPriority,
      triggeredByIncidentId: input.triggeredByIncidentId ?? null,
      iterations: 0,
      maxIterations: input.maxIterations ?? 5,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(developmentCycles).values(cycle);

    return this.mapToRecord(cycle as typeof developmentCycles.$inferSelect);
  }

  /**
   * Get development cycle by ID
   */
  async getById(id: string): Promise<DevelopmentCycleRecord | null> {
    const db = getDatabase();
    const result = await db
      .select()
      .from(developmentCycles)
      .where(eq(developmentCycles.id, id))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapToRecord(result[0]!);
  }

  /**
   * Update development cycle
   */
  async update(id: string, input: UpdateDevelopmentCycleInput): Promise<DevelopmentCycleRecord | null> {
    const db = getDatabase();
    const now = new Date();

    await db
      .update(developmentCycles)
      .set({
        ...input,
        updatedAt: now,
      })
      .where(eq(developmentCycles.id, id));

    return this.getById(id);
  }

  /**
   * Update phase only
   */
  async updatePhase(id: string, phase: DevelopmentPhase): Promise<DevelopmentCycleRecord | null> {
    return this.update(id, { phase });
  }

  /**
   * Increment iteration count
   */
  async incrementIterations(id: string): Promise<DevelopmentCycleRecord | null> {
    const cycle = await this.getById(id);
    if (!cycle) return null;
    return this.update(id, { iterations: cycle.iterations + 1 });
  }

  /**
   * Mark cycle as completed
   */
  async complete(id: string, verification?: string): Promise<DevelopmentCycleRecord | null> {
    return this.update(id, {
      phase: 'COMPLETED',
      verification,
      completedAt: new Date(),
    });
  }

  /**
   * Mark cycle as failed
   */
  async fail(id: string, error: string): Promise<DevelopmentCycleRecord | null> {
    return this.update(id, {
      phase: 'FAILED',
      error,
      completedAt: new Date(),
    });
  }

  /**
   * List development cycles with filters
   */
  async list(
    filters: DevelopmentCycleFilters = {},
    limit = 50,
    offset = 0
  ): Promise<DevelopmentCycleRecord[]> {
    const db = getDatabase();

    const conditions = [];

    if (filters.phase) {
      conditions.push(eq(developmentCycles.phase, filters.phase));
    }
    if (filters.requirementSource) {
      conditions.push(eq(developmentCycles.requirementSource, filters.requirementSource));
    }
    if (filters.requirementPriority) {
      conditions.push(eq(developmentCycles.requirementPriority, filters.requirementPriority));
    }
    if (filters.triggeredByIncidentId) {
      conditions.push(eq(developmentCycles.triggeredByIncidentId, filters.triggeredByIncidentId));
    }
    if (filters.isActive) {
      // Active means not completed and not failed
      conditions.push(ne(developmentCycles.phase, 'COMPLETED'));
      conditions.push(ne(developmentCycles.phase, 'FAILED'));
    }

    const query = db
      .select()
      .from(developmentCycles)
      .orderBy(desc(developmentCycles.createdAt))
      .limit(limit)
      .offset(offset);

    if (conditions.length > 0) {
      query.where(and(...conditions));
    }

    const results = await query;
    return results.map((r) => this.mapToRecord(r));
  }

  /**
   * Get active cycles (not completed or failed)
   */
  async getActive(): Promise<DevelopmentCycleRecord[]> {
    const db = getDatabase();
    const results = await db
      .select()
      .from(developmentCycles)
      .where(isNull(developmentCycles.completedAt))
      .orderBy(desc(developmentCycles.createdAt));

    return results.map((r) => this.mapToRecord(r));
  }

  /**
   * Get interrupted cycles for server restart recovery
   * Returns cycles that are in an active phase (not IDLE, COMPLETED, or FAILED)
   * and don't have a completedAt timestamp
   */
  async getInterruptedCycles(): Promise<DevelopmentCycleRecord[]> {
    const db = getDatabase();

    // Find cycles that are:
    // 1. Not completed (no completedAt)
    // 2. In an active phase (not IDLE, COMPLETED, or FAILED)
    const results = await db
      .select()
      .from(developmentCycles)
      .where(
        and(
          isNull(developmentCycles.completedAt),
          ne(developmentCycles.phase, 'IDLE'),
          ne(developmentCycles.phase, 'COMPLETED'),
          ne(developmentCycles.phase, 'FAILED')
        )
      )
      .orderBy(desc(developmentCycles.updatedAt));

    return results.map((r) => this.mapToRecord(r));
  }

  /**
   * Get cycles triggered by an incident
   */
  async getByIncident(incidentId: string): Promise<DevelopmentCycleRecord[]> {
    const db = getDatabase();
    const results = await db
      .select()
      .from(developmentCycles)
      .where(eq(developmentCycles.triggeredByIncidentId, incidentId))
      .orderBy(desc(developmentCycles.createdAt));

    return results.map((r) => this.mapToRecord(r));
  }

  /**
   * Nullify triggered_by_incident_id for all cycles linked to an incident
   */
  async nullifyTriggeredByIncidentId(incidentId: string): Promise<void> {
    const db = getDatabase();
    await db
      .update(developmentCycles)
      .set({ triggeredByIncidentId: null })
      .where(eq(developmentCycles.triggeredByIncidentId, incidentId));
  }

  /**
   * Delete development cycle (for testing only)
   */
  async delete(id: string): Promise<void> {
    const db = getDatabase();
    await db.delete(developmentCycles).where(eq(developmentCycles.id, id));
  }

  /**
   * Map database row to record type
   */
  private mapToRecord(row: typeof developmentCycles.$inferSelect): DevelopmentCycleRecord {
    return {
      id: row.id,
      phase: row.phase as DevelopmentPhase,
      serviceType: row.serviceType as ServiceType,
      frontendConfig: row.frontendConfig,
      storageMode: row.storageMode as StorageMode,
      requirementSource: row.requirementSource as RequirementSource,
      requirementRaw: row.requirementRaw,
      requirementPriority: row.requirementPriority as RequirementPriority,
      analyzedRequirement: row.analyzedRequirement,
      architecture: row.architecture,
      architectureDiagramUrl: row.architectureDiagramUrl ?? null,
      generatedCodeSummary: row.generatedCodeSummary,
      testResults: row.testResults,
      buildResult: row.buildResult,
      deployment: row.deployment,
      verification: row.verification,
      triggeredByIncidentId: row.triggeredByIncidentId,
      iterations: row.iterations,
      maxIterations: row.maxIterations,
      error: row.error,
      thoughtSignature: row.thoughtSignature,
      phaseRetries: row.phaseRetries ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      completedAt: row.completedAt,
    };
  }
}

// Singleton instance
export const developmentCycleRepository = new DevelopmentCycleRepository();

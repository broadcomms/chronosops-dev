/**
 * Monitored App Repository
 * CRUD operations for monitored Kubernetes applications
 */

import { eq, and } from 'drizzle-orm';
import { getDatabase } from '../connection.js';
import { monitoredApps } from '../schema.js';
import { randomUUID } from 'node:crypto';

export interface MonitoredApp {
  id: string;
  namespace: string;
  deployment: string;
  displayName: string;
  grafanaDashboardUid: string | null;
  grafanaDashboardUrl: string | null;
  isActive: boolean;
  // Self-healing integration
  developmentCycleId: string | null;
  prometheusJob: string | null;
  alertRulesConfig: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMonitoredAppInput {
  namespace: string;
  deployment: string;
  displayName: string;
  grafanaDashboardUid?: string;
  grafanaDashboardUrl?: string;
  isActive?: boolean;
  // Self-healing integration
  developmentCycleId?: string;
  prometheusJob?: string;
  alertRulesConfig?: string;
}

export interface UpdateMonitoredAppInput {
  displayName?: string;
  grafanaDashboardUid?: string;
  grafanaDashboardUrl?: string;
  isActive?: boolean;
  // Self-healing integration
  developmentCycleId?: string;
  prometheusJob?: string;
  alertRulesConfig?: string;
}

export class MonitoredAppRepository {
  /**
   * Get all monitored apps
   */
  async getAll(): Promise<MonitoredApp[]> {
    const db = getDatabase();
    const results = await db.select().from(monitoredApps);
    return results.map((r) => this.mapToApp(r));
  }

  /**
   * Get active monitored apps only
   */
  async getActive(): Promise<MonitoredApp[]> {
    const db = getDatabase();
    const results = await db
      .select()
      .from(monitoredApps)
      .where(eq(monitoredApps.isActive, true));
    return results.map((r) => this.mapToApp(r));
  }

  /**
   * Get monitored app by ID
   */
  async getById(id: string): Promise<MonitoredApp | null> {
    const db = getDatabase();
    const result = await db
      .select()
      .from(monitoredApps)
      .where(eq(monitoredApps.id, id))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapToApp(result[0]!);
  }

  /**
   * Get monitored app by namespace and deployment
   */
  async getByNamespaceAndDeployment(
    namespace: string,
    deployment: string
  ): Promise<MonitoredApp | null> {
    const db = getDatabase();
    const result = await db
      .select()
      .from(monitoredApps)
      .where(
        and(
          eq(monitoredApps.namespace, namespace),
          eq(monitoredApps.deployment, deployment)
        )
      )
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapToApp(result[0]!);
  }

  /**
   * Get all active namespaces (for K8s executor validation)
   */
  async getActiveNamespaces(): Promise<string[]> {
    const activeApps = await this.getActive();
    const namespaces = new Set(activeApps.map((app) => app.namespace));
    return Array.from(namespaces);
  }

  /**
   * Create a monitored app
   */
  async create(input: CreateMonitoredAppInput): Promise<MonitoredApp> {
    const db = getDatabase();
    const now = new Date();
    const id = randomUUID();

    await db.insert(monitoredApps).values({
      id,
      namespace: input.namespace,
      deployment: input.deployment,
      displayName: input.displayName,
      grafanaDashboardUid: input.grafanaDashboardUid ?? null,
      grafanaDashboardUrl: input.grafanaDashboardUrl ?? null,
      isActive: input.isActive ?? true,
      // Self-healing integration
      developmentCycleId: input.developmentCycleId ?? null,
      prometheusJob: input.prometheusJob ?? null,
      alertRulesConfig: input.alertRulesConfig ?? null,
      createdAt: now,
      updatedAt: now,
    });

    return this.getById(id) as Promise<MonitoredApp>;
  }

  /**
   * Update a monitored app
   */
  async update(id: string, input: UpdateMonitoredAppInput): Promise<MonitoredApp | null> {
    const db = getDatabase();
    const now = new Date();

    await db
      .update(monitoredApps)
      .set({
        ...(input.displayName !== undefined && { displayName: input.displayName }),
        ...(input.grafanaDashboardUid !== undefined && {
          grafanaDashboardUid: input.grafanaDashboardUid,
        }),
        ...(input.grafanaDashboardUrl !== undefined && {
          grafanaDashboardUrl: input.grafanaDashboardUrl,
        }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        // Self-healing integration
        ...(input.developmentCycleId !== undefined && {
          developmentCycleId: input.developmentCycleId,
        }),
        ...(input.prometheusJob !== undefined && {
          prometheusJob: input.prometheusJob,
        }),
        ...(input.alertRulesConfig !== undefined && {
          alertRulesConfig: input.alertRulesConfig,
        }),
        updatedAt: now,
      })
      .where(eq(monitoredApps.id, id));

    return this.getById(id);
  }

  /**
   * Set Grafana dashboard for an app
   */
  async setGrafanaDashboard(
    id: string,
    dashboardUid: string,
    dashboardUrl: string
  ): Promise<MonitoredApp | null> {
    const db = getDatabase();
    const now = new Date();

    await db
      .update(monitoredApps)
      .set({
        grafanaDashboardUid: dashboardUid,
        grafanaDashboardUrl: dashboardUrl,
        updatedAt: now,
      })
      .where(eq(monitoredApps.id, id));

    return this.getById(id);
  }

  /**
   * Delete a monitored app
   */
  async delete(id: string): Promise<void> {
    const db = getDatabase();
    await db.delete(monitoredApps).where(eq(monitoredApps.id, id));
  }

  /**
   * Deactivate all apps (for cleanup/reset)
   */
  async deactivateAll(): Promise<void> {
    const db = getDatabase();
    const now = new Date();

    await db.update(monitoredApps).set({
      isActive: false,
      updatedAt: now,
    });
  }

  /**
   * Get monitored app by development cycle ID
   */
  async getByDevelopmentCycleId(cycleId: string): Promise<MonitoredApp | null> {
    const db = getDatabase();
    const result = await db
      .select()
      .from(monitoredApps)
      .where(eq(monitoredApps.developmentCycleId, cycleId))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapToApp(result[0]!);
  }

  /**
   * Delete monitored app by development cycle ID
   */
  async deleteByDevelopmentCycleId(cycleId: string): Promise<void> {
    const db = getDatabase();
    await db.delete(monitoredApps).where(eq(monitoredApps.developmentCycleId, cycleId));
  }

  /**
   * Map database row to MonitoredApp type
   */
  private mapToApp(row: typeof monitoredApps.$inferSelect): MonitoredApp {
    return {
      id: row.id,
      namespace: row.namespace,
      deployment: row.deployment,
      displayName: row.displayName,
      grafanaDashboardUid: row.grafanaDashboardUid,
      grafanaDashboardUrl: row.grafanaDashboardUrl,
      isActive: row.isActive,
      // Self-healing integration
      developmentCycleId: row.developmentCycleId,
      prometheusJob: row.prometheusJob,
      alertRulesConfig: row.alertRulesConfig,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

// Singleton instance
export const monitoredAppRepository = new MonitoredAppRepository();

/**
 * Service Registry Repository
 * Manages deployed services with their API endpoints for multi-service architecture
 */

import { eq, desc, and, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { ServiceType, ServiceStatus } from '@chronosops/shared';
import { getDatabase } from '../connection.js';
import { serviceRegistry } from '../schema.js';

export interface CreateServiceInput {
  developmentCycleId: string;
  name: string;
  displayName: string;
  description?: string;
  serviceType: ServiceType;
  namespace: string;
  serviceUrl: string;
  healthEndpoint?: string;
  apiSpec?: string; // JSON
  apiVersion?: string;
  endpoints?: string; // JSON array
  dependsOnServices?: string; // JSON array
}

export interface UpdateServiceInput {
  displayName?: string;
  description?: string;
  serviceUrl?: string;
  healthEndpoint?: string;
  apiSpec?: string; // JSON
  apiVersion?: string;
  endpoints?: string; // JSON array
  status?: ServiceStatus;
  lastHealthCheck?: Date;
}

export interface ServiceRegistryFilters {
  serviceType?: ServiceType;
  status?: ServiceStatus;
  namespace?: string;
  developmentCycleId?: string;
}

export interface ServiceRegistryRecord {
  id: string;
  developmentCycleId: string;
  name: string;
  displayName: string;
  description: string | null;
  serviceType: ServiceType;
  namespace: string;
  serviceUrl: string;
  healthEndpoint: string | null;
  apiSpec: string | null;
  apiVersion: string | null;
  endpoints: string | null;
  dependsOnServices: string | null;
  status: ServiceStatus;
  lastHealthCheck: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class ServiceRegistryRepository {
  /**
   * Register a new service
   */
  async create(input: CreateServiceInput): Promise<ServiceRegistryRecord> {
    const db = getDatabase();
    const now = new Date();

    const service: typeof serviceRegistry.$inferInsert = {
      id: randomUUID(),
      developmentCycleId: input.developmentCycleId,
      name: input.name,
      displayName: input.displayName,
      description: input.description ?? null,
      serviceType: input.serviceType,
      namespace: input.namespace,
      serviceUrl: input.serviceUrl,
      healthEndpoint: input.healthEndpoint ?? '/health',
      apiSpec: input.apiSpec ?? null,
      apiVersion: input.apiVersion ?? null,
      endpoints: input.endpoints ?? '[]',
      dependsOnServices: input.dependsOnServices ?? '[]',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(serviceRegistry).values(service);

    return this.mapToRecord(service as typeof serviceRegistry.$inferSelect);
  }

  /**
   * Get service by ID
   */
  async getById(id: string): Promise<ServiceRegistryRecord | null> {
    const db = getDatabase();
    const result = await db
      .select()
      .from(serviceRegistry)
      .where(eq(serviceRegistry.id, id))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapToRecord(result[0]!);
  }

  /**
   * Get service by development cycle ID
   */
  async getByDevelopmentCycleId(cycleId: string): Promise<ServiceRegistryRecord | null> {
    const db = getDatabase();
    const result = await db
      .select()
      .from(serviceRegistry)
      .where(eq(serviceRegistry.developmentCycleId, cycleId))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapToRecord(result[0]!);
  }

  /**
   * Get service by name (deployment name)
   */
  async getByName(name: string): Promise<ServiceRegistryRecord | null> {
    const db = getDatabase();
    const result = await db
      .select()
      .from(serviceRegistry)
      .where(eq(serviceRegistry.name, name))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapToRecord(result[0]!);
  }

  /**
   * Update service
   */
  async update(id: string, input: UpdateServiceInput): Promise<ServiceRegistryRecord | null> {
    const db = getDatabase();
    const now = new Date();

    await db
      .update(serviceRegistry)
      .set({
        ...input,
        updatedAt: now,
      })
      .where(eq(serviceRegistry.id, id));

    return this.getById(id);
  }

  /**
   * Update API specification
   */
  async updateApiSpec(
    id: string,
    apiSpec: string,
    endpoints: string,
    apiVersion?: string
  ): Promise<ServiceRegistryRecord | null> {
    return this.update(id, { apiSpec, endpoints, apiVersion });
  }

  /**
   * Update service status
   */
  async updateStatus(id: string, status: ServiceStatus): Promise<ServiceRegistryRecord | null> {
    return this.update(id, { status, lastHealthCheck: new Date() });
  }

  /**
   * List all backend services (for frontend service picker)
   */
  async listBackends(namespace?: string): Promise<ServiceRegistryRecord[]> {
    const db = getDatabase();

    const conditions = [eq(serviceRegistry.serviceType, 'backend')];

    if (namespace) {
      conditions.push(eq(serviceRegistry.namespace, namespace));
    }

    // Only show active services
    conditions.push(eq(serviceRegistry.status, 'active'));

    const results = await db
      .select()
      .from(serviceRegistry)
      .where(and(...conditions))
      .orderBy(desc(serviceRegistry.createdAt));

    return results.map((r) => this.mapToRecord(r));
  }

  /**
   * List services by type
   */
  async listByType(type: ServiceType): Promise<ServiceRegistryRecord[]> {
    const db = getDatabase();
    const results = await db
      .select()
      .from(serviceRegistry)
      .where(eq(serviceRegistry.serviceType, type))
      .orderBy(desc(serviceRegistry.createdAt));

    return results.map((r) => this.mapToRecord(r));
  }

  /**
   * List services with filters
   */
  async list(
    filters: ServiceRegistryFilters = {},
    limit = 50,
    offset = 0
  ): Promise<ServiceRegistryRecord[]> {
    const db = getDatabase();

    const conditions = [];

    if (filters.serviceType) {
      conditions.push(eq(serviceRegistry.serviceType, filters.serviceType));
    }
    if (filters.status) {
      conditions.push(eq(serviceRegistry.status, filters.status));
    }
    if (filters.namespace) {
      conditions.push(eq(serviceRegistry.namespace, filters.namespace));
    }
    if (filters.developmentCycleId) {
      conditions.push(eq(serviceRegistry.developmentCycleId, filters.developmentCycleId));
    }

    const query = db
      .select()
      .from(serviceRegistry)
      .orderBy(desc(serviceRegistry.createdAt))
      .limit(limit)
      .offset(offset);

    if (conditions.length > 0) {
      query.where(and(...conditions));
    }

    const results = await query;
    return results.map((r) => this.mapToRecord(r));
  }

  /**
   * Get multiple services by IDs
   */
  async getByIds(ids: string[]): Promise<ServiceRegistryRecord[]> {
    if (ids.length === 0) return [];

    const db = getDatabase();
    const results = await db
      .select()
      .from(serviceRegistry)
      .where(inArray(serviceRegistry.id, ids));

    return results.map((r) => this.mapToRecord(r));
  }

  /**
   * Delete service
   */
  async delete(id: string): Promise<void> {
    const db = getDatabase();
    await db.delete(serviceRegistry).where(eq(serviceRegistry.id, id));
  }

  /**
   * Delete service by development cycle ID
   */
  async deleteByDevelopmentCycleId(cycleId: string): Promise<void> {
    const db = getDatabase();
    await db.delete(serviceRegistry).where(eq(serviceRegistry.developmentCycleId, cycleId));
  }

  /**
   * Map database row to record type
   */
  private mapToRecord(row: typeof serviceRegistry.$inferSelect): ServiceRegistryRecord {
    return {
      id: row.id,
      developmentCycleId: row.developmentCycleId,
      name: row.name,
      displayName: row.displayName,
      description: row.description,
      serviceType: row.serviceType as ServiceType,
      namespace: row.namespace,
      serviceUrl: row.serviceUrl,
      healthEndpoint: row.healthEndpoint,
      apiSpec: row.apiSpec,
      apiVersion: row.apiVersion,
      endpoints: row.endpoints,
      dependsOnServices: row.dependsOnServices,
      status: row.status as ServiceStatus,
      lastHealthCheck: row.lastHealthCheck,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

// Singleton instance
export const serviceRegistryRepository = new ServiceRegistryRepository();

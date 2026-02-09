/**
 * Configuration Repository
 * Stores and retrieves user-defined configuration settings
 */

import { eq } from 'drizzle-orm';
import { getDatabase } from '../connection.js';
import { configs } from '../schema.js';

export type ConfigCategory = 'kubernetes' | 'dashboard' | 'safety' | 'development' | 'platform';

export interface ConfigRecord {
  id: string;
  category: ConfigCategory;
  config: Record<string, unknown>;
  isValid: boolean;
  lastTestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertConfigInput {
  id: string;
  category: ConfigCategory;
  config: Record<string, unknown>;
  isValid?: boolean;
}

export class ConfigRepository {
  /**
   * Get config by ID
   */
  async getById(id: string): Promise<ConfigRecord | null> {
    const db = getDatabase();
    const result = await db.select().from(configs).where(eq(configs.id, id)).limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapToConfig(result[0]!);
  }

  /**
   * Get config by category
   */
  async getByCategory(category: ConfigCategory): Promise<ConfigRecord | null> {
    const db = getDatabase();
    const result = await db.select().from(configs).where(eq(configs.category, category)).limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapToConfig(result[0]!);
  }

  /**
   * Get all configs
   */
  async getAll(): Promise<ConfigRecord[]> {
    const db = getDatabase();
    const results = await db.select().from(configs);
    return results.map((r) => this.mapToConfig(r));
  }

  /**
   * Upsert config (create or update)
   */
  async upsert(input: UpsertConfigInput): Promise<ConfigRecord> {
    const db = getDatabase();
    const now = new Date();
    const existing = await this.getById(input.id);

    if (existing) {
      // Update existing config
      await db
        .update(configs)
        .set({
          config: JSON.stringify(input.config),
          isValid: input.isValid ?? existing.isValid,
          updatedAt: now,
        })
        .where(eq(configs.id, input.id));
    } else {
      // Create new config
      await db.insert(configs).values({
        id: input.id,
        category: input.category,
        config: JSON.stringify(input.config),
        isValid: input.isValid ?? false,
        createdAt: now,
        updatedAt: now,
      });
    }

    return this.getById(input.id) as Promise<ConfigRecord>;
  }

  /**
   * Mark config as valid/invalid
   */
  async setValid(id: string, isValid: boolean): Promise<ConfigRecord | null> {
    const db = getDatabase();
    const now = new Date();

    await db
      .update(configs)
      .set({
        isValid,
        lastTestedAt: isValid ? now : undefined,
        updatedAt: now,
      })
      .where(eq(configs.id, id));

    return this.getById(id);
  }

  /**
   * Delete config
   */
  async delete(id: string): Promise<void> {
    const db = getDatabase();
    await db.delete(configs).where(eq(configs.id, id));
  }

  /**
   * Seed default configurations if they don't exist
   * This ensures the app starts with sensible defaults configured
   */
  async seedDefaultConfigs(): Promise<void> {
    const existing = await this.getAll();
    const existingCategories = new Set(existing.map(c => c.category));

    // Default Kubernetes configuration
    if (!existingCategories.has('kubernetes')) {
      await this.upsert({
        id: 'kubernetes',
        category: 'kubernetes',
        config: {
          context: 'docker-desktop',
          namespace: 'development',
          allowedNamespaces: ['development', 'default'],
          allowedActions: {
            rollback: true,
            restart: true,
            scale: true,
          },
        },
        isValid: true, // Mark as valid since docker-desktop is a standard context
      });
    }

    // Default Dashboard/Vision configuration
    if (!existingCategories.has('dashboard')) {
      await this.upsert({
        id: 'dashboard',
        category: 'dashboard',
        config: {
          visionFps: 2,
          visionWidth: 1280,
          visionHeight: 720,
          recordingDirectory: './data/recordings',
        },
        isValid: true,
      });
    }

    // Default Safety configuration
    if (!existingCategories.has('safety')) {
      await this.upsert({
        id: 'safety',
        category: 'safety',
        config: {
          actionCooldownMs: 60000,
          maxActionsPerWindow: 5,
          actionWindowMs: 300000,
          dryRunMode: false,
          enforceCooldowns: true,
          requireManualCodeEvolutionApproval: false, // Automatic evolution by default
        },
        isValid: true,
      });
    }

    // Default Development Settings configuration
    if (!existingCategories.has('development')) {
      await this.upsert({
        id: 'development',
        category: 'development',
        config: {
          enableFaultInjection: false, // Production-ready by default, no bug endpoints
        },
        isValid: true,
      });
    }
  }

  /**
   * Map database row to ConfigRecord type
   */
  private mapToConfig(row: typeof configs.$inferSelect): ConfigRecord {
    return {
      id: row.id,
      category: row.category,
      config: JSON.parse(row.config) as Record<string, unknown>,
      isValid: row.isValid,
      lastTestedAt: row.lastTestedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

// Singleton instance
export const configRepository = new ConfigRepository();

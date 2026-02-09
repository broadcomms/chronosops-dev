/**
 * File Version Repository
 * Tracks version history for generated files
 */

import { eq, desc, and } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { getDatabase } from '../connection.js';
import { fileVersions } from '../schema.js';

export type ChangeType = 'create' | 'edit' | 'evolution' | 'revert';
export type ChangedBy = 'user' | 'ai' | 'system';

export interface CreateFileVersionInput {
  generatedFileId: string;
  developmentCycleId: string;
  version: number;
  content: string;
  changeType: ChangeType;
  changeDescription?: string;
  changedBy: ChangedBy;
  evolutionId?: string;
  commitHash?: string;
}

export interface FileVersionRecord {
  id: string;
  generatedFileId: string;
  developmentCycleId: string;
  version: number;
  content: string;
  contentHash: string;
  changeType: ChangeType;
  changeDescription: string | null;
  changedBy: ChangedBy;
  evolutionId: string | null;
  commitHash: string | null;
  createdAt: Date;
}

export interface FileVersionFilters {
  generatedFileId?: string;
  developmentCycleId?: string;
  changeType?: ChangeType;
  changedBy?: ChangedBy;
}

export class FileVersionRepository {
  /**
   * Create a new file version record
   */
  async create(input: CreateFileVersionInput): Promise<FileVersionRecord> {
    const db = getDatabase();
    const now = new Date();
    const contentHash = this.hashContent(input.content);

    const version: typeof fileVersions.$inferInsert = {
      id: randomUUID(),
      generatedFileId: input.generatedFileId,
      developmentCycleId: input.developmentCycleId,
      version: input.version,
      content: input.content,
      contentHash,
      changeType: input.changeType,
      changeDescription: input.changeDescription,
      changedBy: input.changedBy,
      evolutionId: input.evolutionId,
      commitHash: input.commitHash,
      createdAt: now,
    };

    await db.insert(fileVersions).values(version);

    return this.mapToRecord(version as typeof fileVersions.$inferSelect);
  }

  /**
   * Get a file version by ID
   */
  async findById(id: string): Promise<FileVersionRecord | null> {
    const db = getDatabase();
    const result = await db.select().from(fileVersions).where(eq(fileVersions.id, id)).limit(1);
    const row = result[0];
    return row ? this.mapToRecord(row) : null;
  }

  /**
   * Get all versions for a file
   */
  async findByFileId(generatedFileId: string): Promise<FileVersionRecord[]> {
    const db = getDatabase();
    const results = await db
      .select()
      .from(fileVersions)
      .where(eq(fileVersions.generatedFileId, generatedFileId))
      .orderBy(desc(fileVersions.version));

    return results.map((r) => this.mapToRecord(r));
  }

  /**
   * Get the latest version of a file
   */
  async findLatestByFileId(generatedFileId: string): Promise<FileVersionRecord | null> {
    const db = getDatabase();
    const results = await db
      .select()
      .from(fileVersions)
      .where(eq(fileVersions.generatedFileId, generatedFileId))
      .orderBy(desc(fileVersions.version))
      .limit(1);

    const row = results[0];
    return row ? this.mapToRecord(row) : null;
  }

  /**
   * Get a specific version of a file
   */
  async findByFileIdAndVersion(
    generatedFileId: string,
    version: number
  ): Promise<FileVersionRecord | null> {
    const db = getDatabase();
    const results = await db
      .select()
      .from(fileVersions)
      .where(
        and(
          eq(fileVersions.generatedFileId, generatedFileId),
          eq(fileVersions.version, version)
        )
      )
      .limit(1);

    const row = results[0];
    return row ? this.mapToRecord(row) : null;
  }

  /**
   * Get all versions for a development cycle
   */
  async findByCycleId(developmentCycleId: string): Promise<FileVersionRecord[]> {
    const db = getDatabase();
    const results = await db
      .select()
      .from(fileVersions)
      .where(eq(fileVersions.developmentCycleId, developmentCycleId))
      .orderBy(desc(fileVersions.createdAt));

    return results.map((r) => this.mapToRecord(r));
  }

  /**
   * Get versions by evolution ID
   */
  async findByEvolutionId(evolutionId: string): Promise<FileVersionRecord[]> {
    const db = getDatabase();
    const results = await db
      .select()
      .from(fileVersions)
      .where(eq(fileVersions.evolutionId, evolutionId))
      .orderBy(desc(fileVersions.createdAt));

    return results.map((r) => this.mapToRecord(r));
  }

  /**
   * Get the next version number for a file
   */
  async getNextVersionNumber(generatedFileId: string): Promise<number> {
    const latest = await this.findLatestByFileId(generatedFileId);
    return latest ? latest.version + 1 : 1;
  }

  /**
   * Delete all versions for a file
   */
  async deleteByFileId(generatedFileId: string): Promise<number> {
    const db = getDatabase();
    const result = await db.delete(fileVersions).where(eq(fileVersions.generatedFileId, generatedFileId));
    return result.changes;
  }

  /**
   * Delete all versions for a development cycle
   */
  async deleteByCycleId(developmentCycleId: string): Promise<number> {
    const db = getDatabase();
    const result = await db.delete(fileVersions).where(eq(fileVersions.developmentCycleId, developmentCycleId));
    return result.changes;
  }

  /**
   * Hash content for comparison
   */
  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Map database result to record type
   */
  private mapToRecord(row: typeof fileVersions.$inferSelect): FileVersionRecord {
    return {
      id: row.id,
      generatedFileId: row.generatedFileId,
      developmentCycleId: row.developmentCycleId,
      version: row.version,
      content: row.content,
      contentHash: row.contentHash,
      changeType: row.changeType as ChangeType,
      changeDescription: row.changeDescription,
      changedBy: row.changedBy as ChangedBy,
      evolutionId: row.evolutionId,
      commitHash: row.commitHash,
      createdAt: row.createdAt,
    };
  }
}

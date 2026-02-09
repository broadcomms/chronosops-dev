/**
 * Generated File Repository
 */

import { eq, desc, and } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { getDatabase } from '../connection.js';
import { generatedFiles } from '../schema.js';

export type FileLanguage =
  | 'typescript'
  | 'javascript'
  | 'json'
  | 'yaml'
  | 'dockerfile'
  | 'markdown'
  | 'shell'
  | 'css'
  | 'html';

export type ValidationStatus = 'pending' | 'valid' | 'invalid' | 'fixed';

export interface CreateGeneratedFileInput {
  developmentCycleId: string;
  path: string;
  language: FileLanguage;
  purpose: string;
  isNew: boolean;
  content: string;
}

export interface UpdateGeneratedFileInput {
  content?: string;
  validationStatus?: ValidationStatus;
  validationErrors?: string; // JSON array
}

export interface GeneratedFileFilters {
  developmentCycleId?: string;
  language?: FileLanguage;
  validationStatus?: ValidationStatus;
  isNew?: boolean;
}

export interface GeneratedFileRecord {
  id: string;
  developmentCycleId: string;
  path: string;
  language: FileLanguage;
  purpose: string;
  isNew: boolean;
  content: string;
  contentHash: string | null;
  validationStatus: ValidationStatus;
  validationErrors: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class GeneratedFileRepository {
  /**
   * Create a new generated file record
   */
  async create(input: CreateGeneratedFileInput): Promise<GeneratedFileRecord> {
    const db = getDatabase();
    const now = new Date();
    const contentHash = this.hashContent(input.content);

    const file: typeof generatedFiles.$inferInsert = {
      id: randomUUID(),
      developmentCycleId: input.developmentCycleId,
      path: input.path,
      language: input.language,
      purpose: input.purpose,
      isNew: input.isNew,
      content: input.content,
      contentHash,
      validationStatus: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(generatedFiles).values(file);

    return this.mapToRecord(file as typeof generatedFiles.$inferSelect);
  }

  /**
   * Create multiple files at once
   */
  async createMany(inputs: CreateGeneratedFileInput[]): Promise<GeneratedFileRecord[]> {
    const db = getDatabase();
    const now = new Date();

    const files = inputs.map((input) => ({
      id: randomUUID(),
      developmentCycleId: input.developmentCycleId,
      path: input.path,
      language: input.language,
      purpose: input.purpose,
      isNew: input.isNew,
      content: input.content,
      contentHash: this.hashContent(input.content),
      validationStatus: 'pending' as ValidationStatus,
      createdAt: now,
      updatedAt: now,
    }));

    if (files.length > 0) {
      await db.insert(generatedFiles).values(files);
    }

    return files.map((f) => this.mapToRecord(f as typeof generatedFiles.$inferSelect));
  }

  /**
   * Get generated file by ID
   */
  async getById(id: string): Promise<GeneratedFileRecord | null> {
    const db = getDatabase();
    const result = await db
      .select()
      .from(generatedFiles)
      .where(eq(generatedFiles.id, id))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapToRecord(result[0]!);
  }

  /**
   * Get all files for a development cycle
   */
  async getByDevelopmentCycle(developmentCycleId: string): Promise<GeneratedFileRecord[]> {
    const db = getDatabase();
    const results = await db
      .select()
      .from(generatedFiles)
      .where(eq(generatedFiles.developmentCycleId, developmentCycleId))
      .orderBy(generatedFiles.path);

    return results.map((r) => this.mapToRecord(r));
  }

  /**
   * Update generated file
   */
  async update(id: string, input: UpdateGeneratedFileInput): Promise<GeneratedFileRecord | null> {
    const db = getDatabase();
    const now = new Date();

    const updateData: Record<string, unknown> = {
      ...input,
      updatedAt: now,
    };

    // Update content hash if content changed
    if (input.content) {
      updateData.contentHash = this.hashContent(input.content);
    }

    await db.update(generatedFiles).set(updateData).where(eq(generatedFiles.id, id));

    return this.getById(id);
  }

  /**
   * Update validation status for a file
   */
  async updateValidationStatus(
    id: string,
    status: ValidationStatus,
    errors?: string[]
  ): Promise<GeneratedFileRecord | null> {
    return this.update(id, {
      validationStatus: status,
      validationErrors: errors ? JSON.stringify(errors) : undefined,
    });
  }

  /**
   * Mark file as valid
   */
  async markValid(id: string): Promise<GeneratedFileRecord | null> {
    return this.updateValidationStatus(id, 'valid');
  }

  /**
   * Mark file as invalid with errors
   */
  async markInvalid(id: string, errors: string[]): Promise<GeneratedFileRecord | null> {
    return this.updateValidationStatus(id, 'invalid', errors);
  }

  /**
   * Mark file as fixed
   */
  async markFixed(id: string, newContent: string): Promise<GeneratedFileRecord | null> {
    return this.update(id, {
      content: newContent,
      validationStatus: 'fixed',
      validationErrors: undefined,
    });
  }

  /**
   * List generated files with filters
   */
  async list(
    filters: GeneratedFileFilters = {},
    limit = 100,
    offset = 0
  ): Promise<GeneratedFileRecord[]> {
    const db = getDatabase();

    const conditions = [];

    if (filters.developmentCycleId) {
      conditions.push(eq(generatedFiles.developmentCycleId, filters.developmentCycleId));
    }
    if (filters.language) {
      conditions.push(eq(generatedFiles.language, filters.language));
    }
    if (filters.validationStatus) {
      conditions.push(eq(generatedFiles.validationStatus, filters.validationStatus));
    }
    if (filters.isNew !== undefined) {
      conditions.push(eq(generatedFiles.isNew, filters.isNew));
    }

    const query = db
      .select()
      .from(generatedFiles)
      .orderBy(desc(generatedFiles.createdAt))
      .limit(limit)
      .offset(offset);

    if (conditions.length > 0) {
      query.where(and(...conditions));
    }

    const results = await query;
    return results.map((r) => this.mapToRecord(r));
  }

  /**
   * Get files with validation errors
   */
  async getInvalid(developmentCycleId?: string): Promise<GeneratedFileRecord[]> {
    return this.list({
      developmentCycleId,
      validationStatus: 'invalid',
    });
  }

  /**
   * Delete generated file
   */
  async delete(id: string): Promise<void> {
    const db = getDatabase();
    await db.delete(generatedFiles).where(eq(generatedFiles.id, id));
  }

  /**
   * Delete all files for a development cycle
   */
  async deleteByDevelopmentCycle(developmentCycleId: string): Promise<void> {
    const db = getDatabase();
    await db
      .delete(generatedFiles)
      .where(eq(generatedFiles.developmentCycleId, developmentCycleId));
  }

  /**
   * Calculate SHA256 hash of content
   */
  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Map database row to record type
   */
  private mapToRecord(row: typeof generatedFiles.$inferSelect): GeneratedFileRecord {
    return {
      id: row.id,
      developmentCycleId: row.developmentCycleId,
      path: row.path,
      language: row.language as FileLanguage,
      purpose: row.purpose,
      isNew: row.isNew,
      content: row.content,
      contentHash: row.contentHash,
      validationStatus: row.validationStatus as ValidationStatus,
      validationErrors: row.validationErrors,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

// Singleton instance
export const generatedFileRepository = new GeneratedFileRepository();

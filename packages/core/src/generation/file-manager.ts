/**
 * File Manager
 * Handles writing generated files to disk
 */

import { createChildLogger } from '@chronosops/shared';
import type { GeneratedFile } from '@chronosops/shared';
import { writeFile, mkdir, readFile, rm, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { FileWriteResult, BatchFileWriteResult } from './types.js';

export class FileManager {
  private logger = createChildLogger({ component: 'FileManager' });
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  /**
   * Write a single file to disk
   */
  async writeFile(file: GeneratedFile): Promise<FileWriteResult> {
    const fullPath = join(this.baseDir, file.path);

    try {
      // Ensure directory exists
      const dir = dirname(fullPath);
      await mkdir(dir, { recursive: true });

      // Write file
      await writeFile(fullPath, file.content, 'utf-8');

      this.logger.debug({ path: file.path }, 'File written');

      return {
        success: true,
        path: fullPath,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error: errorMessage, path: file.path }, 'Failed to write file');

      return {
        success: false,
        path: fullPath,
        error: errorMessage,
      };
    }
  }

  /**
   * Write multiple files to disk
   */
  async writeFiles(files: GeneratedFile[]): Promise<BatchFileWriteResult> {
    this.logger.info({ fileCount: files.length, baseDir: this.baseDir }, 'Writing files to disk');

    const written: string[] = [];
    const failed: Array<{ path: string; error: string }> = [];

    for (const file of files) {
      const result = await this.writeFile(file);

      if (result.success) {
        written.push(result.path);
      } else {
        failed.push({
          path: result.path,
          error: result.error ?? 'Unknown error',
        });
      }
    }

    this.logger.info({
      written: written.length,
      failed: failed.length,
    }, 'File write operation complete');

    return {
      success: failed.length === 0,
      written,
      failed,
      totalFiles: files.length,
    };
  }

  /**
   * Read a file from disk
   */
  async readFile(relativePath: string): Promise<string | null> {
    const fullPath = join(this.baseDir, relativePath);

    try {
      const content = await readFile(fullPath, 'utf-8');
      return content;
    } catch {
      return null;
    }
  }

  /**
   * Check if a file exists
   */
  async fileExists(relativePath: string): Promise<boolean> {
    const fullPath = join(this.baseDir, relativePath);

    try {
      await access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a file
   */
  async deleteFile(relativePath: string): Promise<boolean> {
    const fullPath = join(this.baseDir, relativePath);

    try {
      await rm(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clean up the entire base directory
   */
  async cleanup(): Promise<void> {
    try {
      await rm(this.baseDir, { recursive: true, force: true });
      this.logger.info({ baseDir: this.baseDir }, 'Cleaned up directory');
    } catch (error) {
      this.logger.error({
        error: (error as Error).message,
        baseDir: this.baseDir,
      }, 'Failed to cleanup directory');
    }
  }

  /**
   * Create the base directory
   */
  async initialize(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    this.logger.debug({ baseDir: this.baseDir }, 'Initialized file manager');
  }

  /**
   * Get full path for a relative path
   */
  getFullPath(relativePath: string): string {
    return join(this.baseDir, relativePath);
  }

  /**
   * Get the base directory
   */
  getBaseDir(): string {
    return this.baseDir;
  }
}

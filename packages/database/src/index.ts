/**
 * @chronosops/database
 * Database layer and repositories
 */

export { initializeDatabase, getDatabase, closeDatabase, runMigrations } from './connection.js';
export type { DatabaseConnection, DatabaseConfig } from './connection.js';

export * from './schema.js';
export * from './repositories/index.js';

// Re-export drizzle-orm operators for use in API routes (H1 fix)
export { eq, and, or, lt, gt, gte, lte, desc, asc } from 'drizzle-orm';

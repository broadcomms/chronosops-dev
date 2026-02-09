/**
 * PostgreSQL Manager
 * Manages per-app databases in the shared PostgreSQL instance
 */

import { createChildLogger } from '@chronosops/shared';
import pg from 'pg';

const logger = createChildLogger({ component: 'PostgresManager' });

export interface PostgresManagerConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  /** Admin database to connect to (default: postgres) */
  adminDatabase?: string;
}

export interface EnsureDatabaseResult {
  success: boolean;
  databaseName: string;
  created: boolean;
  error?: string;
}

export interface ConnectionCheckResult {
  success: boolean;
  host: string;
  port: number;
  error?: string;
}

/**
 * Default configuration for PostgreSQL connection
 *
 * When running outside the Kubernetes cluster (local development):
 * - Uses localhost:30432 (NodePort service)
 *
 * When running inside the Kubernetes cluster:
 * - Set POSTGRES_HOST=chronosops-postgres.database.svc.cluster.local
 * - Set POSTGRES_PORT=5432
 */
export const DEFAULT_POSTGRES_CONFIG: PostgresManagerConfig = {
  // Default to localhost for local development (NodePort 30432)
  // Override with POSTGRES_HOST for in-cluster deployment
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '30432', 10),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'chronosops-dev-password',
  adminDatabase: process.env.POSTGRES_DATABASE || 'postgres',
};

/**
 * PostgresManager handles database creation and management
 * for generated apps using PostgreSQL storage mode
 */
export class PostgresManager {
  private config: PostgresManagerConfig;
  private pool: pg.Pool | null = null;

  constructor(config: Partial<PostgresManagerConfig> = {}) {
    this.config = { ...DEFAULT_POSTGRES_CONFIG, ...config };
  }

  /**
   * Get or create the connection pool
   */
  private getPool(): pg.Pool {
    if (!this.pool) {
      this.pool = new pg.Pool({
        host: this.config.host,
        port: this.config.port,
        user: this.config.user,
        password: this.config.password,
        database: this.config.adminDatabase,
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      });

      // Handle pool errors
      this.pool.on('error', (err: Error) => {
        logger.error({ err: err.message }, 'PostgreSQL pool error');
      });
    }
    return this.pool;
  }

  /**
   * Sanitize database name to be PostgreSQL compatible
   * - Converts hyphens to underscores
   * - Converts to lowercase
   * - Removes invalid characters
   * - Ensures it starts with a letter
   */
  sanitizeDatabaseName(name: string): string {
    // Convert hyphens to underscores and lowercase
    let sanitized = name.toLowerCase().replace(/-/g, '_');

    // Remove any characters that aren't alphanumeric or underscore
    sanitized = sanitized.replace(/[^a-z0-9_]/g, '');

    // Ensure it starts with a letter (prepend 'db_' if it starts with number)
    if (/^[0-9]/.test(sanitized)) {
      sanitized = 'db_' + sanitized;
    }

    // Truncate to 63 characters (PostgreSQL identifier limit)
    if (sanitized.length > 63) {
      sanitized = sanitized.substring(0, 63);
    }

    return sanitized;
  }

  /**
   * Ensure a database exists, creating it if necessary
   * This operation is idempotent - safe to call multiple times
   */
  async ensureDatabase(name: string): Promise<EnsureDatabaseResult> {
    const databaseName = this.sanitizeDatabaseName(name);

    logger.info({ originalName: name, databaseName }, 'Ensuring database exists');

    const pool = this.getPool();
    let client: pg.PoolClient | null = null;

    try {
      client = await this.connectWithRetry(pool);

      // Check if database exists
      const checkResult = await client.query(
        `SELECT 1 FROM pg_database WHERE datname = $1`,
        [databaseName]
      );

      if (checkResult.rows.length > 0) {
        logger.info({ databaseName }, 'Database already exists');
        return {
          success: true,
          databaseName,
          created: false,
        };
      }

      // Create the database
      // Note: CREATE DATABASE cannot be parameterized, but we've already sanitized the name
      await client.query(`CREATE DATABASE "${databaseName}"`);

      logger.info({ databaseName }, 'Database created successfully');
      return {
        success: true,
        databaseName,
        created: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if error is "database already exists" - this is fine in concurrent scenarios
      if (errorMessage.includes('already exists')) {
        logger.info({ databaseName }, 'Database already exists (concurrent creation)');
        return {
          success: true,
          databaseName,
          created: false,
        };
      }

      logger.error({ databaseName, err: errorMessage }, 'Failed to ensure database');
      return {
        success: false,
        databaseName,
        created: false,
        error: errorMessage,
      };
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  /**
   * Connect to PostgreSQL with exponential backoff retry
   */
  private async connectWithRetry(pool: pg.Pool, maxRetries: number = 3): Promise<pg.PoolClient> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const client = await pool.connect();
        return client;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          logger.warn(
            { attempt, maxRetries, delay, err: lastError.message },
            'PostgreSQL connection failed, retrying'
          );
          await this.sleep(delay);
        }
      }
    }

    throw lastError || new Error('Failed to connect to PostgreSQL');
  }

  /**
   * Check if PostgreSQL is reachable and healthy
   */
  async checkConnection(): Promise<ConnectionCheckResult> {
    const pool = this.getPool();
    let client: pg.PoolClient | null = null;

    try {
      client = await pool.connect();
      await client.query('SELECT 1');

      return {
        success: true,
        host: this.config.host,
        port: this.config.port,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        success: false,
        host: this.config.host,
        port: this.config.port,
        error: errorMessage,
      };
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  /**
   * Get the connection URL for a specific database
   */
  getConnectionUrl(databaseName: string): string {
    const sanitizedName = this.sanitizeDatabaseName(databaseName);
    return `postgres://${this.config.user}:${this.config.password}@${this.config.host}:${this.config.port}/${sanitizedName}`;
  }

  /**
   * Drop a database (for cleanup/testing)
   * WARNING: This will permanently delete all data in the database
   */
  async dropDatabase(name: string): Promise<{ success: boolean; error?: string }> {
    const databaseName = this.sanitizeDatabaseName(name);

    logger.warn({ databaseName }, 'Dropping database');

    const pool = this.getPool();
    let client: pg.PoolClient | null = null;

    try {
      client = await pool.connect();

      // Terminate all connections to the database first
      await client.query(`
        SELECT pg_terminate_backend(pg_stat_activity.pid)
        FROM pg_stat_activity
        WHERE pg_stat_activity.datname = $1
          AND pid <> pg_backend_pid()
      `, [databaseName]);

      // Drop the database
      await client.query(`DROP DATABASE IF EXISTS "${databaseName}"`);

      logger.info({ databaseName }, 'Database dropped successfully');
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ databaseName, err: errorMessage }, 'Failed to drop database');
      return { success: false, error: errorMessage };
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  /**
   * List all databases created by ChronosOps (by naming convention)
   */
  async listDatabases(): Promise<{ success: boolean; databases?: string[]; error?: string }> {
    const pool = this.getPool();
    let client: pg.PoolClient | null = null;

    try {
      client = await pool.connect();

      const result = await client.query(`
        SELECT datname FROM pg_database
        WHERE datistemplate = false
          AND datname NOT IN ('postgres')
        ORDER BY datname
      `);

      const databases = result.rows.map((row: { datname: string }) => row.datname);
      return { success: true, databases };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  /**
   * Close the connection pool
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      logger.info({}, 'PostgreSQL pool closed');
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Create a PostgresManager from environment variables
 */
export function createPostgresManagerFromEnv(): PostgresManager {
  return new PostgresManager({
    host: process.env.POSTGRES_HOST || DEFAULT_POSTGRES_CONFIG.host,
    port: parseInt(process.env.POSTGRES_PORT || String(DEFAULT_POSTGRES_CONFIG.port), 10),
    user: process.env.POSTGRES_USER || DEFAULT_POSTGRES_CONFIG.user,
    password: process.env.POSTGRES_PASSWORD || DEFAULT_POSTGRES_CONFIG.password,
    adminDatabase: process.env.POSTGRES_DATABASE || DEFAULT_POSTGRES_CONFIG.adminDatabase,
  });
}

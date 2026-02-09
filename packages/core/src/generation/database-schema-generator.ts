/**
 * Database Schema Generator
 * Transforms Zod schemas into Drizzle ORM table definitions for SQLite and PostgreSQL
 */

import { createChildLogger } from '@chronosops/shared';
import type { StorageMode } from './types.js';

const logger = createChildLogger({ component: 'DatabaseSchemaGenerator' });

/**
 * Field definition extracted from requirements or existing Zod schema
 */
export interface FieldDefinition {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'json' | 'uuid' | 'email' | 'enum';
  required: boolean;
  isId?: boolean;
  isCreatedAt?: boolean;
  isUpdatedAt?: boolean;
  enumValues?: string[];
  defaultValue?: string | number | boolean;
  description?: string;
}

/**
 * Table definition for schema generation
 */
export interface TableDefinition {
  name: string;
  singularName: string;
  fields: FieldDefinition[];
}

/**
 * Generated database schema files
 */
export interface GeneratedDatabaseSchema {
  schemaFile: string;
  connectionFile: string;
  dependencies: Array<{ name: string; version: string; devOnly: boolean }>;
}

/**
 * Map Zod type descriptions to Drizzle SQLite column types
 */
function mapToSqliteType(field: FieldDefinition): string {
  const { type, name, isId, isCreatedAt, isUpdatedAt, required, enumValues, defaultValue } = field;

  let columnDef: string;

  switch (type) {
    case 'uuid':
    case 'string':
    case 'email':
      if (isId) {
        columnDef = `text('${name}').primaryKey()`;
      } else if (enumValues && enumValues.length > 0) {
        const enumStr = enumValues.map((v) => `'${v}'`).join(', ');
        columnDef = `text('${name}', { enum: [${enumStr}] })`;
      } else {
        columnDef = `text('${name}')`;
      }
      break;

    case 'number':
      columnDef = `real('${name}')`;
      break;

    case 'boolean':
      columnDef = `integer('${name}', { mode: 'boolean' })`;
      break;

    case 'date':
      if (isCreatedAt || isUpdatedAt) {
        columnDef = `text('${name}')`;
      } else {
        columnDef = `text('${name}')`;
      }
      break;

    case 'json':
      columnDef = `text('${name}')`;
      break;

    case 'enum':
      const enumStr = (enumValues || []).map((v) => `'${v}'`).join(', ');
      columnDef = `text('${name}', { enum: [${enumStr}] })`;
      break;

    default:
      columnDef = `text('${name}')`;
  }

  // Add not null constraint
  if (required && !isId) {
    columnDef += '.notNull()';
  }

  // Add default value
  if (defaultValue !== undefined) {
    if (typeof defaultValue === 'string') {
      columnDef += `.default('${defaultValue}')`;
    } else {
      columnDef += `.default(${defaultValue})`;
    }
  }

  return columnDef;
}

/**
 * Map Zod type descriptions to Drizzle PostgreSQL column types
 */
function mapToPostgresType(field: FieldDefinition): string {
  const { type, name, isId, isCreatedAt, isUpdatedAt, required, enumValues, defaultValue } = field;

  let columnDef: string;

  switch (type) {
    case 'uuid':
      if (isId) {
        columnDef = `uuid('${name}').primaryKey().defaultRandom()`;
      } else {
        columnDef = `uuid('${name}')`;
      }
      break;

    case 'string':
    case 'email':
      if (isId) {
        columnDef = `text('${name}').primaryKey()`;
      } else if (enumValues && enumValues.length > 0) {
        const enumStr = enumValues.map((v) => `'${v}'`).join(', ');
        columnDef = `text('${name}', { enum: [${enumStr}] })`;
      } else {
        columnDef = `text('${name}')`;
      }
      break;

    case 'number':
      columnDef = `real('${name}')`;
      break;

    case 'boolean':
      columnDef = `boolean('${name}')`;
      break;

    case 'date':
      if (isCreatedAt) {
        columnDef = `timestamp('${name}').notNull().defaultNow()`;
        return columnDef; // Early return to avoid double notNull
      } else if (isUpdatedAt) {
        columnDef = `timestamp('${name}').notNull().defaultNow()`;
        return columnDef;
      } else {
        columnDef = `timestamp('${name}')`;
      }
      break;

    case 'json':
      columnDef = `jsonb('${name}')`;
      break;

    case 'enum':
      const enumStr = (enumValues || []).map((v) => `'${v}'`).join(', ');
      columnDef = `text('${name}', { enum: [${enumStr}] })`;
      break;

    default:
      columnDef = `text('${name}')`;
  }

  // Add not null constraint
  if (required && !isId && !isCreatedAt && !isUpdatedAt) {
    columnDef += '.notNull()';
  }

  // Add default value
  if (defaultValue !== undefined && !isCreatedAt && !isUpdatedAt) {
    if (typeof defaultValue === 'string') {
      columnDef += `.default('${defaultValue}')`;
    } else {
      columnDef += `.default(${defaultValue})`;
    }
  }

  return columnDef;
}

/**
 * Generate SQLite schema file content
 */
function generateSqliteSchema(tables: TableDefinition[]): string {
  const imports = `import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';`;

  const tableDefinitions = tables
    .map((table) => {
      const fieldDefs = table.fields.map((field) => `  ${field.name}: ${mapToSqliteType(field)},`).join('\n');

      return `export const ${table.name} = sqliteTable('${table.name}', {
${fieldDefs}
});`;
    })
    .join('\n\n');

  // Generate TypeScript types from schema
  const typeDefinitions = tables
    .map((table) => {
      const capitalizedName = table.singularName.charAt(0).toUpperCase() + table.singularName.slice(1);
      return `export type ${capitalizedName} = typeof ${table.name}.$inferSelect;
export type New${capitalizedName} = typeof ${table.name}.$inferInsert;`;
    })
    .join('\n\n');

  return `/**
 * Database Schema (SQLite with Drizzle ORM)
 * Auto-generated by ChronosOps
 */

${imports}

${tableDefinitions}

// TypeScript types derived from schema
${typeDefinitions}
`;
}

/**
 * Generate PostgreSQL schema file content
 */
function generatePostgresSchema(tables: TableDefinition[]): string {
  const imports = `import { pgTable, text, uuid, timestamp, boolean, real, jsonb } from 'drizzle-orm/pg-core';`;

  const tableDefinitions = tables
    .map((table) => {
      const fieldDefs = table.fields.map((field) => `  ${field.name}: ${mapToPostgresType(field)},`).join('\n');

      return `export const ${table.name} = pgTable('${table.name}', {
${fieldDefs}
});`;
    })
    .join('\n\n');

  // Generate TypeScript types from schema
  const typeDefinitions = tables
    .map((table) => {
      const capitalizedName = table.singularName.charAt(0).toUpperCase() + table.singularName.slice(1);
      return `export type ${capitalizedName} = typeof ${table.name}.$inferSelect;
export type New${capitalizedName} = typeof ${table.name}.$inferInsert;`;
    })
    .join('\n\n');

  return `/**
 * Database Schema (PostgreSQL with Drizzle ORM)
 * Auto-generated by ChronosOps
 */

${imports}

${tableDefinitions}

// TypeScript types derived from schema
${typeDefinitions}
`;
}

/**
 * Generate SQLite connection file content
 */
function generateSqliteConnection(tables: TableDefinition[]): string {
  const schemaImports = tables.map((t) => t.name).join(', ');

  return `/**
 * Database Connection (SQLite with Drizzle ORM)
 * Auto-generated by ChronosOps
 */

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

// Database path from environment or default
const DB_PATH = process.env.DATABASE_PATH || './data/app.db';

// Create database directory if it doesn't exist
import { mkdirSync } from 'fs';
import { dirname } from 'path';
try {
  mkdirSync(dirname(DB_PATH), { recursive: true });
} catch {
  // Directory already exists
}

// Initialize SQLite with WAL mode for better concurrency
const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');

// Create Drizzle ORM instance
// Explicit type annotation prevents TS4023 "cannot be named" error during declaration emit
export const db: BetterSQLite3Database<typeof schema> = drizzle(sqlite, { schema });

// Export schema for use in routes
export { ${schemaImports} } from './schema.js';

// Graceful shutdown handler
process.on('SIGINT', () => {
  sqlite.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  sqlite.close();
  process.exit(0);
});

/**
 * Initialize database tables
 * Creates tables if they don't exist
 */
export function initializeDatabase(): void {
  // SQLite tables are created automatically by Drizzle when first accessed
  // For explicit table creation, use drizzle-kit migrations
  console.log('Database initialized:', DB_PATH);
}

/**
 * Check database health
 */
export function checkDatabaseHealth(): { connected: boolean; path: string } {
  try {
    sqlite.prepare('SELECT 1').get();
    return { connected: true, path: DB_PATH };
  } catch {
    return { connected: false, path: DB_PATH };
  }
}
`;
}

/**
 * Generate PostgreSQL connection file content with retry logic and migrations
 */
function generatePostgresConnection(
  tables: TableDefinition[],
  host: string = 'chronosops-postgres.database.svc.cluster.local',
  port: number = 5432,
  databaseName: string = 'appdb'
): string {
  const schemaImports = tables.map((t) => t.name).join(', ');

  // Generate CREATE TABLE statements for migrations
  const migrationStatements = tables.map((table) => {
    const columns = table.fields.map((field) => {
      let columnDef = `"${field.name}" `;

      // Map type to PostgreSQL type
      switch (field.type) {
        case 'uuid':
          columnDef += field.isId ? 'UUID PRIMARY KEY DEFAULT gen_random_uuid()' : 'UUID';
          break;
        case 'string':
        case 'email':
          columnDef += 'TEXT';
          break;
        case 'number':
          columnDef += 'REAL';
          break;
        case 'boolean':
          columnDef += 'BOOLEAN';
          break;
        case 'date':
          if (field.isCreatedAt || field.isUpdatedAt) {
            columnDef += 'TIMESTAMP NOT NULL DEFAULT NOW()';
            return columnDef; // Skip additional constraints
          }
          columnDef += 'TIMESTAMP';
          break;
        case 'json':
          columnDef += 'JSONB';
          break;
        case 'enum':
          columnDef += 'TEXT';
          break;
        default:
          columnDef += 'TEXT';
      }

      if (field.required && !field.isId && !field.isCreatedAt && !field.isUpdatedAt) {
        columnDef += ' NOT NULL';
      }

      return columnDef;
    });

    return `CREATE TABLE IF NOT EXISTS "${table.name}" (\\n      ${columns.join(',\\n      ')}\\n    )`;
  });

  return `/**
 * Database Connection (PostgreSQL with Drizzle ORM)
 * Auto-generated by ChronosOps
 *
 * Features:
 * - Connection retry with exponential backoff
 * - Push-based migrations (CREATE TABLE IF NOT EXISTS)
 * - Health check support
 * - Graceful shutdown handlers
 */

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

// Database URL from environment
const DATABASE_URL = process.env.DATABASE_URL ||
  \`postgres://\${process.env.POSTGRES_USER || 'postgres'}:\${process.env.POSTGRES_PASSWORD || ''}@${host}:${port}/${databaseName}\`;

// Connection pool (initialized lazily)
let pool: pg.Pool | null = null;
// Explicit type annotation prevents TS4023 "cannot be named" error during declaration emit
let dbInstance: NodePgDatabase<typeof schema> | null = null;

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Connect to PostgreSQL with exponential backoff retry
 */
async function connectWithRetry(maxRetries: number = 5): Promise<pg.Pool> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const newPool = new pg.Pool({
        connectionString: DATABASE_URL,
        max: 10, // Maximum pool size
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      });

      // Test connection
      const client = await newPool.connect();
      await client.query('SELECT 1');
      client.release();

      console.log('PostgreSQL connected:', DATABASE_URL.replace(/:[^:@]+@/, ':***@'));
      return newPool;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        console.warn(\`PostgreSQL connection attempt \${attempt}/\${maxRetries} failed, retrying in \${delay}ms...\`);
        await sleep(delay);
      }
    }
  }

  throw lastError || new Error('Failed to connect to PostgreSQL');
}

/**
 * Get the connection pool, initializing if necessary
 */
async function getPool(): Promise<pg.Pool> {
  if (!pool) {
    pool = await connectWithRetry();

    // Handle pool errors
    pool.on('error', (err) => {
      console.error('PostgreSQL pool error:', err.message);
    });
  }
  return pool;
}

/**
 * Get the Drizzle ORM instance
 */
export async function getDb(): Promise<NodePgDatabase<typeof schema>> {
  if (!dbInstance) {
    const p = await getPool();
    dbInstance = drizzle(p, { schema });
  }
  return dbInstance;
}

// Synchronous db export for backwards compatibility (requires initializeDatabase to be called first)
// Explicit type annotation prevents TS4023 "cannot be named" error during declaration emit
export let db: NodePgDatabase<typeof schema>;

// Export schema for use in routes
export { ${schemaImports} } from './schema.js';

// Graceful shutdown handler
async function shutdown() {
  if (pool) {
    await pool.end();
    pool = null;
    dbInstance = null;
    console.log('PostgreSQL pool closed');
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

/**
 * Migration SQL statements
 */
const MIGRATIONS: string[] = [
  ${migrationStatements.map((stmt) => `\`${stmt}\``).join(',\n  ')}
];

/**
 * Initialize database
 * Connects with retry and runs migrations (CREATE TABLE IF NOT EXISTS)
 */
export async function initializeDatabase(): Promise<void> {
  const p = await getPool();
  db = drizzle(p, { schema });
  dbInstance = db;

  // Run migrations
  const client = await p.connect();
  try {
    for (const migration of MIGRATIONS) {
      await client.query(migration);
    }
    console.log('Database migrations completed');
  } finally {
    client.release();
  }
}

/**
 * Check database health
 */
export async function checkDatabaseHealth(): Promise<{ connected: boolean; host: string; latencyMs?: number }> {
  const startTime = Date.now();
  try {
    const p = await getPool();
    const client = await p.connect();
    await client.query('SELECT 1');
    client.release();
    return {
      connected: true,
      host: '${host}',
      latencyMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      connected: false,
      host: '${host}',
    };
  }
}
`;
}

/**
 * Generate database schema and connection files based on storage mode
 */
export function generateDatabaseSchema(
  tables: TableDefinition[],
  storageMode: StorageMode,
  options?: {
    postgresHost?: string;
    postgresPort?: number;
    databaseName?: string;
  }
): GeneratedDatabaseSchema {
  logger.info({ storageMode, tableCount: tables.length }, 'Generating database schema');

  if (storageMode === 'memory') {
    // No database files needed for in-memory storage
    return {
      schemaFile: '',
      connectionFile: '',
      dependencies: [],
    };
  }

  if (storageMode === 'sqlite') {
    return {
      schemaFile: generateSqliteSchema(tables),
      connectionFile: generateSqliteConnection(tables),
      dependencies: [
        { name: 'better-sqlite3', version: '^11.7.0', devOnly: false },
        { name: 'drizzle-orm', version: '^0.38.3', devOnly: false },
        { name: '@types/better-sqlite3', version: '^7.6.11', devOnly: true },
      ],
    };
  }

  if (storageMode === 'postgres') {
    return {
      schemaFile: generatePostgresSchema(tables),
      connectionFile: generatePostgresConnection(
        tables,
        options?.postgresHost,
        options?.postgresPort,
        options?.databaseName
      ),
      dependencies: [
        { name: 'pg', version: '^8.13.1', devOnly: false },
        { name: 'drizzle-orm', version: '^0.38.3', devOnly: false },
        { name: '@types/pg', version: '^8.11.10', devOnly: true },
      ],
    };
  }

  return {
    schemaFile: '',
    connectionFile: '',
    dependencies: [],
  };
}

/**
 * Extract table definitions from analyzed requirement
 * Infers table structure from requirement description
 */
export function extractTableDefinitions(
  resourceName: string,
  resourceNamePlural: string,
  fields: Array<{
    name: string;
    zodType: string;
    required: boolean;
    inCreate?: boolean;
    inUpdate?: boolean;
  }>
): TableDefinition {
  const tableFields: FieldDefinition[] = [];

  for (const field of fields) {
    const fieldDef: FieldDefinition = {
      name: field.name,
      type: inferTypeFromZod(field.zodType),
      required: field.required,
      isId: field.name === 'id',
      isCreatedAt: field.name === 'createdAt' || field.name === 'created_at',
      isUpdatedAt: field.name === 'updatedAt' || field.name === 'updated_at',
    };

    // Extract enum values if present
    const enumMatch = field.zodType.match(/z\.enum\(\[([^\]]+)\]\)/);
    if (enumMatch && enumMatch[1]) {
      fieldDef.enumValues = enumMatch[1]
        .split(',')
        .map((v) => v.trim().replace(/['"]/g, ''));
    }

    tableFields.push(fieldDef);
  }

  // Ensure we have id, createdAt, updatedAt
  if (!tableFields.some((f) => f.isId)) {
    tableFields.unshift({
      name: 'id',
      type: 'uuid',
      required: true,
      isId: true,
    });
  }

  if (!tableFields.some((f) => f.isCreatedAt)) {
    tableFields.push({
      name: 'createdAt',
      type: 'date',
      required: true,
      isCreatedAt: true,
    });
  }

  if (!tableFields.some((f) => f.isUpdatedAt)) {
    tableFields.push({
      name: 'updatedAt',
      type: 'date',
      required: true,
      isUpdatedAt: true,
    });
  }

  return {
    name: resourceNamePlural,
    singularName: resourceName,
    fields: tableFields,
  };
}

/**
 * Infer field type from Zod type string
 */
function inferTypeFromZod(zodType: string): FieldDefinition['type'] {
  if (zodType.includes('uuid')) return 'uuid';
  if (zodType.includes('email')) return 'email';
  if (zodType.includes('enum')) return 'enum';
  if (zodType.includes('boolean')) return 'boolean';
  if (zodType.includes('number') || zodType.includes('int')) return 'number';
  if (zodType.includes('date') || zodType.includes('datetime')) return 'date';
  if (zodType.includes('object') || zodType.includes('array')) return 'json';
  return 'string';
}

/**
 * Generate CRUD operations code that uses Drizzle ORM
 * Returns code snippets for list, get, create, update, delete operations
 */
export function generateDrizzleCrudOperations(
  table: TableDefinition,
  storageMode: StorageMode
): {
  listAll: string;
  getById: string;
  create: string;
  update: string;
  deleteOp: string;
} {
  const tableName = table.name;
  const singularName = table.singularName;
  const capitalizedName = singularName.charAt(0).toUpperCase() + singularName.slice(1);

  if (storageMode === 'sqlite') {
    return {
      listAll: `const all${capitalizedName}s = db.select().from(${tableName}).all();`,
      getById: `const ${singularName} = db.select().from(${tableName}).where(eq(${tableName}.id, id)).get();`,
      create: `const [created] = db.insert(${tableName}).values(data).returning().all();`,
      update: `const [updated] = db.update(${tableName}).set(data).where(eq(${tableName}.id, id)).returning().all();`,
      deleteOp: `db.delete(${tableName}).where(eq(${tableName}.id, id)).run();`,
    };
  }

  // PostgreSQL uses async operations
  return {
    listAll: `const all${capitalizedName}s = await db.select().from(${tableName});`,
    getById: `const [${singularName}] = await db.select().from(${tableName}).where(eq(${tableName}.id, id));`,
    create: `const [created] = await db.insert(${tableName}).values(data).returning();`,
    update: `const [updated] = await db.update(${tableName}).set(data).where(eq(${tableName}.id, id)).returning();`,
    deleteOp: `await db.delete(${tableName}).where(eq(${tableName}.id, id));`,
  };
}

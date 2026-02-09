/**
 * Database Schema Generator Tests
 */
import { describe, it, expect } from 'vitest';
import {
  generateDatabaseSchema,
  extractTableDefinitions,
  generateDrizzleCrudOperations,
  type TableDefinition,
} from '../database-schema-generator.js';

describe('DatabaseSchemaGenerator', () => {
  describe('extractTableDefinitions', () => {
    it('should extract table definition from fields', () => {
      const fields = [
        { name: 'email', zodType: 'z.string().email()', required: true },
        { name: 'name', zodType: 'z.string()', required: true },
        { name: 'isActive', zodType: 'z.boolean()', required: false },
      ];

      const table = extractTableDefinitions('user', 'users', fields);

      expect(table.name).toBe('users');
      expect(table.singularName).toBe('user');
      expect(table.fields.length).toBeGreaterThan(3); // Fields plus auto-added id, createdAt, updatedAt
    });

    it('should auto-add id field if missing', () => {
      const fields = [
        { name: 'title', zodType: 'z.string()', required: true },
      ];

      const table = extractTableDefinitions('task', 'tasks', fields);

      const idField = table.fields.find((f) => f.isId);
      expect(idField).toBeDefined();
      expect(idField?.name).toBe('id');
      expect(idField?.type).toBe('uuid');
    });

    it('should auto-add timestamps if missing', () => {
      const fields = [
        { name: 'title', zodType: 'z.string()', required: true },
      ];

      const table = extractTableDefinitions('task', 'tasks', fields);

      const createdAt = table.fields.find((f) => f.isCreatedAt);
      const updatedAt = table.fields.find((f) => f.isUpdatedAt);

      expect(createdAt).toBeDefined();
      expect(updatedAt).toBeDefined();
    });

    it('should extract enum values from zodType', () => {
      const fields = [
        { name: 'status', zodType: "z.enum(['pending', 'active', 'completed'])", required: true },
      ];

      const table = extractTableDefinitions('task', 'tasks', fields);

      const statusField = table.fields.find((f) => f.name === 'status');
      expect(statusField?.type).toBe('enum');
      expect(statusField?.enumValues).toEqual(['pending', 'active', 'completed']);
    });
  });

  describe('generateDatabaseSchema for memory mode', () => {
    it('should return empty schema and connection files', () => {
      const tables: TableDefinition[] = [
        {
          name: 'users',
          singularName: 'user',
          fields: [
            { name: 'id', type: 'uuid', required: true, isId: true },
            { name: 'email', type: 'email', required: true },
          ],
        },
      ];

      const result = generateDatabaseSchema(tables, 'memory');

      expect(result.schemaFile).toBe('');
      expect(result.connectionFile).toBe('');
      expect(result.dependencies).toHaveLength(0);
    });
  });

  describe('generateDatabaseSchema for SQLite mode', () => {
    const tables: TableDefinition[] = [
      {
        name: 'tasks',
        singularName: 'task',
        fields: [
          { name: 'id', type: 'uuid', required: true, isId: true },
          { name: 'title', type: 'string', required: true },
          { name: 'completed', type: 'boolean', required: true },
          { name: 'createdAt', type: 'date', required: true, isCreatedAt: true },
        ],
      },
    ];

    it('should generate SQLite schema file', () => {
      const result = generateDatabaseSchema(tables, 'sqlite');

      expect(result.schemaFile).toContain("import { sqliteTable");
      expect(result.schemaFile).toContain("export const tasks = sqliteTable('tasks'");
      expect(result.schemaFile).toContain("text('id').primaryKey()");
    });

    it('should generate SQLite connection file', () => {
      const result = generateDatabaseSchema(tables, 'sqlite');

      expect(result.connectionFile).toContain("import Database from 'better-sqlite3'");
      expect(result.connectionFile).toContain("import { drizzle } from 'drizzle-orm/better-sqlite3'");
      expect(result.connectionFile).toContain("sqlite.pragma('journal_mode = WAL')");
    });

    it('should return correct dependencies', () => {
      const result = generateDatabaseSchema(tables, 'sqlite');

      expect(result.dependencies).toContainEqual(
        expect.objectContaining({ name: 'better-sqlite3' })
      );
      expect(result.dependencies).toContainEqual(
        expect.objectContaining({ name: 'drizzle-orm' })
      );
    });
  });

  describe('generateDatabaseSchema for PostgreSQL mode', () => {
    const tables: TableDefinition[] = [
      {
        name: 'products',
        singularName: 'product',
        fields: [
          { name: 'id', type: 'uuid', required: true, isId: true },
          { name: 'name', type: 'string', required: true },
          { name: 'price', type: 'number', required: true },
          { name: 'metadata', type: 'json', required: false },
          { name: 'createdAt', type: 'date', required: true, isCreatedAt: true },
          { name: 'updatedAt', type: 'date', required: true, isUpdatedAt: true },
        ],
      },
    ];

    it('should generate PostgreSQL schema file', () => {
      const result = generateDatabaseSchema(tables, 'postgres');

      expect(result.schemaFile).toContain("import { pgTable");
      expect(result.schemaFile).toContain("uuid, timestamp, boolean, real, jsonb");
      expect(result.schemaFile).toContain("export const products = pgTable('products'");
    });

    it('should use PostgreSQL-specific types', () => {
      const result = generateDatabaseSchema(tables, 'postgres');

      expect(result.schemaFile).toContain("uuid('id').primaryKey().defaultRandom()");
      expect(result.schemaFile).toContain("real('price')");
      expect(result.schemaFile).toContain("jsonb('metadata')");
      expect(result.schemaFile).toContain("timestamp('createdAt').notNull().defaultNow()");
    });

    it('should generate PostgreSQL connection file with retry logic', () => {
      const result = generateDatabaseSchema(tables, 'postgres');

      expect(result.connectionFile).toContain("import { drizzle } from 'drizzle-orm/node-postgres'");
      expect(result.connectionFile).toContain("import pg from 'pg'");
      expect(result.connectionFile).toContain("connectWithRetry");
      expect(result.connectionFile).toContain("exponential backoff");
    });

    it('should include migration statements', () => {
      const result = generateDatabaseSchema(tables, 'postgres');

      expect(result.connectionFile).toContain("CREATE TABLE IF NOT EXISTS");
      expect(result.connectionFile).toContain("MIGRATIONS");
    });

    it('should use database namespace host', () => {
      const result = generateDatabaseSchema(tables, 'postgres');

      expect(result.connectionFile).toContain("chronosops-postgres.database.svc.cluster.local");
    });

    it('should include graceful shutdown handlers', () => {
      const result = generateDatabaseSchema(tables, 'postgres');

      expect(result.connectionFile).toContain("process.on('SIGINT', shutdown)");
      expect(result.connectionFile).toContain("process.on('SIGTERM', shutdown)");
    });

    it('should include health check function with latency', () => {
      const result = generateDatabaseSchema(tables, 'postgres');

      expect(result.connectionFile).toContain("checkDatabaseHealth");
      expect(result.connectionFile).toContain("latencyMs");
    });

    it('should return correct dependencies', () => {
      const result = generateDatabaseSchema(tables, 'postgres');

      expect(result.dependencies).toContainEqual(
        expect.objectContaining({ name: 'pg' })
      );
      expect(result.dependencies).toContainEqual(
        expect.objectContaining({ name: 'drizzle-orm' })
      );
      expect(result.dependencies).toContainEqual(
        expect.objectContaining({ name: '@types/pg', devOnly: true })
      );
    });

    it('should accept custom host and database name', () => {
      const result = generateDatabaseSchema(tables, 'postgres', {
        postgresHost: 'custom-postgres.custom-ns.svc.cluster.local',
        postgresPort: 5433,
        databaseName: 'custom_db',
      });

      expect(result.connectionFile).toContain('custom-postgres.custom-ns.svc.cluster.local');
      expect(result.connectionFile).toContain('5433');
      expect(result.connectionFile).toContain('custom_db');
    });
  });

  describe('generateDrizzleCrudOperations', () => {
    const table: TableDefinition = {
      name: 'users',
      singularName: 'user',
      fields: [
        { name: 'id', type: 'uuid', required: true, isId: true },
        { name: 'name', type: 'string', required: true },
      ],
    };

    it('should generate synchronous operations for SQLite', () => {
      const ops = generateDrizzleCrudOperations(table, 'sqlite');

      expect(ops.listAll).toContain('.all()');
      expect(ops.getById).toContain('.get()');
      expect(ops.create).toContain('.returning().all()');
      expect(ops.update).toContain('.returning().all()');
      expect(ops.deleteOp).toContain('.run()');
    });

    it('should generate async operations for PostgreSQL', () => {
      const ops = generateDrizzleCrudOperations(table, 'postgres');

      expect(ops.listAll).toContain('await');
      expect(ops.getById).toContain('await');
      expect(ops.create).toContain('await');
      expect(ops.update).toContain('await');
      expect(ops.deleteOp).toContain('await');
    });

    it('should not use .all() or .get() for PostgreSQL', () => {
      const ops = generateDrizzleCrudOperations(table, 'postgres');

      expect(ops.listAll).not.toContain('.all()');
      expect(ops.getById).not.toContain('.get()');
    });
  });
});

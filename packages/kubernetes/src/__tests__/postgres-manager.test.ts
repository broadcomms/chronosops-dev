/**
 * PostgreSQL Manager Tests
 *
 * Unit tests for synchronous methods. Integration tests requiring a real
 * PostgreSQL connection should use testcontainers.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PostgresManager, DEFAULT_POSTGRES_CONFIG } from '../postgres-manager.js';

describe('PostgresManager', () => {
  let manager: PostgresManager;

  beforeEach(() => {
    manager = new PostgresManager({
      host: 'localhost',
      port: 5432,
      user: 'testuser',
      password: 'testpass',
    });
  });

  afterEach(async () => {
    await manager.close();
  });

  describe('sanitizeDatabaseName', () => {
    it('should convert hyphens to underscores', () => {
      expect(manager.sanitizeDatabaseName('my-app-name')).toBe('my_app_name');
    });

    it('should convert to lowercase', () => {
      expect(manager.sanitizeDatabaseName('MyAppName')).toBe('myappname');
    });

    it('should remove invalid characters', () => {
      expect(manager.sanitizeDatabaseName('my-app@name#123!')).toBe('my_appname123');
    });

    it('should prepend db_ if name starts with number', () => {
      expect(manager.sanitizeDatabaseName('123-app')).toBe('db_123_app');
    });

    it('should truncate to 63 characters', () => {
      const longName = 'a'.repeat(100);
      expect(manager.sanitizeDatabaseName(longName).length).toBe(63);
    });

    it('should handle empty string', () => {
      expect(manager.sanitizeDatabaseName('')).toBe('');
    });

    it('should handle already valid names', () => {
      expect(manager.sanitizeDatabaseName('valid_name_123')).toBe('valid_name_123');
    });

    it('should handle complex app names', () => {
      expect(manager.sanitizeDatabaseName('task-management-api-v2')).toBe('task_management_api_v2');
    });

    it('should handle names with multiple hyphens', () => {
      expect(manager.sanitizeDatabaseName('my---multi---hyphen---app')).toBe('my___multi___hyphen___app');
    });

    it('should handle mixed case with hyphens', () => {
      expect(manager.sanitizeDatabaseName('My-App-Name-HERE')).toBe('my_app_name_here');
    });
  });

  describe('getConnectionUrl', () => {
    it('should return correct connection URL', () => {
      const url = manager.getConnectionUrl('my-app');
      expect(url).toBe('postgres://testuser:testpass@localhost:5432/my_app');
    });

    it('should sanitize database name in URL', () => {
      const url = manager.getConnectionUrl('My-App@Name');
      expect(url).toBe('postgres://testuser:testpass@localhost:5432/my_appname');
    });

    it('should handle simple app names', () => {
      const url = manager.getConnectionUrl('myapp');
      expect(url).toBe('postgres://testuser:testpass@localhost:5432/myapp');
    });

    it('should handle numeric-starting names', () => {
      const url = manager.getConnectionUrl('123app');
      expect(url).toBe('postgres://testuser:testpass@localhost:5432/db_123app');
    });
  });

  describe('DEFAULT_POSTGRES_CONFIG', () => {
    it('should have correct default host for local development (NodePort)', () => {
      // Default is localhost for local development when POSTGRES_HOST is not set
      expect(DEFAULT_POSTGRES_CONFIG.host).toBe('localhost');
    });

    it('should have correct default port for local development (NodePort 30432)', () => {
      // Default is 30432 (NodePort) for local development when POSTGRES_PORT is not set
      expect(DEFAULT_POSTGRES_CONFIG.port).toBe(30432);
    });

    it('should have correct default user', () => {
      expect(DEFAULT_POSTGRES_CONFIG.user).toBe('postgres');
    });

    it('should have correct default admin database', () => {
      expect(DEFAULT_POSTGRES_CONFIG.adminDatabase).toBe('postgres');
    });
  });

  describe('constructor', () => {
    it('should use default config when no options provided', () => {
      const defaultManager = new PostgresManager();
      const url = defaultManager.getConnectionUrl('test');
      // Default is localhost:30432 for local development (NodePort)
      expect(url).toContain('localhost');
      expect(url).toContain(':30432/');
    });

    it('should override default config with provided options', () => {
      const customManager = new PostgresManager({
        host: 'custom-host',
        port: 5433,
        user: 'customuser',
        password: 'custompass',
      });
      const url = customManager.getConnectionUrl('test');
      expect(url).toBe('postgres://customuser:custompass@custom-host:5433/test');
    });

    it('should allow partial config override', () => {
      const partialManager = new PostgresManager({
        host: 'other-host',
        // Keep other defaults
      });
      const url = partialManager.getConnectionUrl('test');
      expect(url).toContain('other-host');
      expect(url).toContain(':30432/'); // Default port (NodePort for local dev)
    });
  });
});

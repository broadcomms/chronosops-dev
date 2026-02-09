/**
 * Database Connection
 */

import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createChildLogger } from '@chronosops/shared';
import * as schema from './schema.js';

export type DatabaseConnection = BetterSQLite3Database<typeof schema>;

export interface DatabaseConfig {
  path: string;
  verbose?: boolean;
}

const logger = createChildLogger({ component: 'Database' });

let dbInstance: DatabaseConnection | null = null;
let sqliteInstance: Database.Database | null = null;

/**
 * Initialize database connection
 */
export function initializeDatabase(config: DatabaseConfig): DatabaseConnection {
  if (dbInstance) {
    return dbInstance;
  }

  logger.info('Initializing database', { path: config.path });

  sqliteInstance = new Database(config.path, {
    verbose: config.verbose ? (msg) => logger.debug(msg) : undefined,
  });

  // Enable WAL mode for better performance
  sqliteInstance.pragma('journal_mode = WAL');

  // Create tables if they don't exist
  createTablesIfNotExist(sqliteInstance);

  dbInstance = drizzle(sqliteInstance, { schema });

  logger.info('Database initialized successfully');

  return dbInstance;
}

/**
 * Create database tables if they don't exist
 */
function createTablesIfNotExist(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
      status TEXT NOT NULL CHECK (status IN ('active', 'investigating', 'mitigating', 'resolved', 'closed')),
      state TEXT NOT NULL CHECK (state IN ('IDLE', 'OBSERVING', 'ORIENTING', 'DECIDING', 'ACTING', 'VERIFYING', 'DONE', 'FAILED')),
      namespace TEXT NOT NULL,
      monitored_app_id TEXT,
      started_at INTEGER NOT NULL,
      resolved_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      thumbnail TEXT,
      is_investigating INTEGER DEFAULT 0,
      investigation_instance_id TEXT,
      investigation_heartbeat INTEGER,
      investigation_started_at INTEGER,
      linked_development_cycle_id TEXT,
      linked_evolution_id TEXT,
      remediation_attempts TEXT,
      phase_retries TEXT
    );

    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY,
      incident_id TEXT NOT NULL REFERENCES incidents(id),
      type TEXT NOT NULL CHECK (type IN ('video_frame', 'log', 'metric', 'k8s_event', 'user_report')),
      source TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      confidence REAL,
      metadata TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hypotheses (
      id TEXT PRIMARY KEY,
      incident_id TEXT NOT NULL REFERENCES incidents(id),
      root_cause TEXT NOT NULL,
      confidence REAL NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('proposed', 'testing', 'confirmed', 'rejected')),
      supporting_evidence TEXT NOT NULL,
      contradicting_evidence TEXT,
      suggested_actions TEXT,
      testing_steps TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS actions (
      id TEXT PRIMARY KEY,
      incident_id TEXT NOT NULL REFERENCES incidents(id),
      hypothesis_id TEXT REFERENCES hypotheses(id),
      type TEXT NOT NULL CHECK (type IN ('rollback', 'restart', 'scale', 'manual', 'code_fix')),
      target TEXT NOT NULL,
      parameters TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'executing', 'completed', 'failed', 'cancelled')),
      result TEXT,
      dry_run INTEGER NOT NULL,
      executed_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS thought_states (
      id TEXT PRIMARY KEY,
      incident_id TEXT NOT NULL REFERENCES incidents(id),
      phase TEXT NOT NULL CHECK (phase IN ('OBSERVING', 'ORIENTING', 'DECIDING', 'ACTING', 'VERIFYING')),
      signature TEXT,
      signature_hash TEXT,
      thinking_budget INTEGER NOT NULL,
      tokens_used INTEGER,
      summary TEXT,
      insights TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS postmortems (
      id TEXT PRIMARY KEY,
      incident_id TEXT NOT NULL UNIQUE REFERENCES incidents(id),
      summary TEXT NOT NULL,
      timeline TEXT NOT NULL,
      root_cause_analysis TEXT NOT NULL,
      impact_analysis TEXT NOT NULL,
      actions_taken TEXT NOT NULL,
      lessons_learned TEXT NOT NULL,
      prevention_recommendations TEXT NOT NULL,
      markdown TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_evidence_incident ON evidence(incident_id);
    CREATE INDEX IF NOT EXISTS idx_hypotheses_incident ON hypotheses(incident_id);
    CREATE INDEX IF NOT EXISTS idx_actions_incident ON actions(incident_id);
    CREATE INDEX IF NOT EXISTS idx_thought_states_incident ON thought_states(incident_id);

    CREATE TABLE IF NOT EXISTS configs (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL CHECK (category IN ('kubernetes', 'dashboard', 'safety', 'platform', 'development')),
      config TEXT NOT NULL,
      is_valid INTEGER NOT NULL DEFAULT 0,
      last_tested_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_configs_category ON configs(category);

    CREATE TABLE IF NOT EXISTS timeline_events (
      id TEXT PRIMARY KEY,
      incident_id TEXT NOT NULL REFERENCES incidents(id),
      type TEXT NOT NULL CHECK (type IN ('phase_change', 'evidence', 'hypothesis', 'action', 'verification', 'error')),
      title TEXT NOT NULL,
      description TEXT,
      phase TEXT CHECK (phase IN ('OBSERVING', 'ORIENTING', 'DECIDING', 'ACTING', 'VERIFYING', 'DONE', 'FAILED')),
      timestamp INTEGER NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_timeline_events_incident ON timeline_events(incident_id);

    CREATE TABLE IF NOT EXISTS monitored_apps (
      id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      deployment TEXT NOT NULL,
      display_name TEXT NOT NULL,
      grafana_dashboard_uid TEXT,
      grafana_dashboard_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      development_cycle_id TEXT REFERENCES development_cycles(id),
      prometheus_job TEXT,
      alert_rules_config TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(namespace, deployment)
    );

    CREATE INDEX IF NOT EXISTS idx_monitored_apps_namespace ON monitored_apps(namespace);
    CREATE INDEX IF NOT EXISTS idx_monitored_apps_active ON monitored_apps(is_active);

    -- Add columns that may be missing from monitored_apps (migration)
    -- SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we ignore errors

    -- Development / Self-Regenerating Tables
    CREATE TABLE IF NOT EXISTS development_cycles (
      id TEXT PRIMARY KEY,
      phase TEXT NOT NULL CHECK (phase IN ('IDLE', 'ANALYZING', 'DESIGNING', 'CODING', 'TESTING', 'BUILDING', 'DEPLOYING', 'VERIFYING', 'COMPLETED', 'FAILED')),
      service_type TEXT NOT NULL DEFAULT 'backend' CHECK (service_type IN ('backend', 'frontend', 'fullstack')),
      frontend_config TEXT,
      storage_mode TEXT NOT NULL DEFAULT 'memory' CHECK (storage_mode IN ('memory', 'sqlite', 'postgres')),
      requirement_source TEXT NOT NULL CHECK (requirement_source IN ('user', 'incident', 'improvement', 'pattern')),
      requirement_raw TEXT NOT NULL,
      requirement_priority TEXT NOT NULL CHECK (requirement_priority IN ('low', 'medium', 'high', 'critical')),
      analyzed_requirement TEXT,
      architecture TEXT,
      architecture_diagram_url TEXT,
      generated_code_summary TEXT,
      test_results TEXT,
      build_result TEXT,
      deployment TEXT,
      verification TEXT,
      triggered_by_incident_id TEXT REFERENCES incidents(id),
      iterations INTEGER NOT NULL DEFAULT 0,
      max_iterations INTEGER NOT NULL DEFAULT 5,
      error TEXT,
      thought_signature TEXT,
      phase_retries TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_development_cycles_phase ON development_cycles(phase);
    CREATE INDEX IF NOT EXISTS idx_development_cycles_incident ON development_cycles(triggered_by_incident_id);
    CREATE INDEX IF NOT EXISTS idx_development_cycles_service_type ON development_cycles(service_type);

    CREATE TABLE IF NOT EXISTS generated_files (
      id TEXT PRIMARY KEY,
      development_cycle_id TEXT NOT NULL REFERENCES development_cycles(id),
      path TEXT NOT NULL,
      language TEXT NOT NULL CHECK (language IN ('typescript', 'javascript', 'json', 'yaml', 'dockerfile', 'markdown', 'shell', 'css', 'html')),
      purpose TEXT NOT NULL,
      is_new INTEGER NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT,
      validation_status TEXT NOT NULL DEFAULT 'pending' CHECK (validation_status IN ('pending', 'valid', 'invalid', 'fixed')),
      validation_errors TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_generated_files_cycle ON generated_files(development_cycle_id);

    CREATE TABLE IF NOT EXISTS learned_patterns (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('detection', 'diagnostic', 'resolution', 'prevention')),
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      trigger_conditions TEXT NOT NULL,
      recommended_actions TEXT NOT NULL,
      confidence REAL NOT NULL,
      applicability TEXT NOT NULL,
      exceptions TEXT NOT NULL,
      times_matched INTEGER NOT NULL DEFAULT 0,
      times_applied INTEGER NOT NULL DEFAULT 0,
      success_rate REAL,
      source_incident_id TEXT REFERENCES incidents(id),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_learned_patterns_type ON learned_patterns(type);
    CREATE INDEX IF NOT EXISTS idx_learned_patterns_active ON learned_patterns(is_active);

    CREATE TABLE IF NOT EXISTS reconstructed_incidents (
      id TEXT PRIMARY KEY,
      incident_id TEXT REFERENCES incidents(id),
      time_range_start INTEGER NOT NULL,
      time_range_end INTEGER NOT NULL,
      timeline TEXT NOT NULL,
      causal_chain TEXT NOT NULL,
      root_cause TEXT NOT NULL,
      recommendations TEXT NOT NULL,
      narrative TEXT NOT NULL,
      data_quality TEXT NOT NULL,
      input_tokens_used INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reconstructed_incidents_incident ON reconstructed_incidents(incident_id);

    -- Service Registry (Multi-Service Architecture)
    CREATE TABLE IF NOT EXISTS service_registry (
      id TEXT PRIMARY KEY,
      development_cycle_id TEXT NOT NULL REFERENCES development_cycles(id),
      name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT,
      service_type TEXT NOT NULL CHECK (service_type IN ('backend', 'frontend', 'fullstack')),
      namespace TEXT NOT NULL,
      service_url TEXT NOT NULL,
      health_endpoint TEXT,
      api_spec TEXT,
      api_version TEXT,
      endpoints TEXT,
      depends_on_services TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'degraded', 'unavailable', 'retired')),
      last_health_check INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_service_registry_cycle ON service_registry(development_cycle_id);
    CREATE INDEX IF NOT EXISTS idx_service_registry_type ON service_registry(service_type);
    CREATE INDEX IF NOT EXISTS idx_service_registry_status ON service_registry(status);

    -- Regenerative Code Feature Tables
    CREATE TABLE IF NOT EXISTS file_versions (
      id TEXT PRIMARY KEY,
      generated_file_id TEXT NOT NULL REFERENCES generated_files(id),
      development_cycle_id TEXT NOT NULL REFERENCES development_cycles(id),
      version INTEGER NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      change_type TEXT NOT NULL CHECK(change_type IN ('create', 'edit', 'evolution', 'revert')),
      change_description TEXT,
      changed_by TEXT NOT NULL CHECK(changed_by IN ('user', 'ai', 'system')),
      evolution_id TEXT REFERENCES code_evolutions(id),
      commit_hash TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_file_versions_file ON file_versions(generated_file_id);
    CREATE INDEX IF NOT EXISTS idx_file_versions_cycle ON file_versions(development_cycle_id);

    CREATE TABLE IF NOT EXISTS edit_locks (
      id TEXT PRIMARY KEY,
      development_cycle_id TEXT NOT NULL REFERENCES development_cycles(id),
      locked_by TEXT NOT NULL,
      locked_by_name TEXT,
      lock_type TEXT NOT NULL CHECK(lock_type IN ('edit', 'evolution')),
      scope TEXT NOT NULL CHECK(scope IN ('file', 'project')),
      locked_files TEXT,
      acquired_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_heartbeat INTEGER NOT NULL,
      extension_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'expired', 'released')),
      local_backup TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_edit_locks_cycle ON edit_locks(development_cycle_id);
    CREATE INDEX IF NOT EXISTS idx_edit_locks_status ON edit_locks(status);

    CREATE TABLE IF NOT EXISTS code_evolutions (
      id TEXT PRIMARY KEY,
      development_cycle_id TEXT NOT NULL REFERENCES development_cycles(id),
      prompt TEXT NOT NULL,
      scope TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'analyzing', 'generating', 'review', 'approved', 'rejected', 'applied', 'reverted', 'failed')),
      analysis_result TEXT,
      proposed_changes TEXT,
      files_affected INTEGER,
      reviewed_by TEXT,
      reviewed_at INTEGER,
      review_notes TEXT,
      applied_at INTEGER,
      applied_commit_hash TEXT,
      reverted_at INTEGER,
      revert_reason TEXT,
      revert_commit_hash TEXT,
      error TEXT,
      triggered_by_incident_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_code_evolutions_cycle ON code_evolutions(development_cycle_id);
    CREATE INDEX IF NOT EXISTS idx_code_evolutions_status ON code_evolutions(status);

    CREATE TABLE IF NOT EXISTS git_repositories (
      id TEXT PRIMARY KEY,
      development_cycle_id TEXT NOT NULL UNIQUE REFERENCES development_cycles(id),
      local_path TEXT NOT NULL,
      current_branch TEXT NOT NULL DEFAULT 'main',
      remote_url TEXT,
      remote_name TEXT DEFAULT 'origin',
      github_repo_id INTEGER,
      github_repo_full_name TEXT,
      last_commit_hash TEXT,
      last_commit_message TEXT,
      last_commit_date INTEGER,
      last_push_date INTEGER,
      status TEXT NOT NULL DEFAULT 'initialized' CHECK(status IN ('initialized', 'active', 'synced', 'error')),
      error_message TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_git_repositories_cycle ON git_repositories(development_cycle_id);
  `);

  // Run schema migrations for existing databases
  // SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we use try-catch
  runSchemaMigrations(db);

  logger.info('Database tables created/verified');
}

/**
 * Run schema migrations for existing databases
 * Adds new columns that may be missing from existing tables
 */
function runSchemaMigrations(db: Database.Database): void {
  const migrations: Array<{ name: string; sql: string }> = [
    // Add phase_retries column to development_cycles for resilient self-healing
    {
      name: 'add_phase_retries_to_development_cycles',
      sql: 'ALTER TABLE development_cycles ADD COLUMN phase_retries TEXT',
    },
    // Add phase_retries column to incidents for resilient investigation cycles
    {
      name: 'add_phase_retries_to_incidents',
      sql: 'ALTER TABLE incidents ADD COLUMN phase_retries TEXT',
    },
    // Add architecture_diagram_url column to development_cycles for AI-generated diagrams
    {
      name: 'add_architecture_diagram_url_to_development_cycles',
      sql: 'ALTER TABLE development_cycles ADD COLUMN architecture_diagram_url TEXT',
    },
    // Recreate actions table with updated CHECK constraints (code_fix type, cancelled status)
    {
      name: 'recreate_actions_table_with_code_fix',
      sql: '__CUSTOM_MIGRATION__', // Handled specially in the migration runner
    },
  ];

  for (const migration of migrations) {
    try {
      // Custom migration: recreate actions table with updated constraints
      if (migration.name === 'recreate_actions_table_with_code_fix') {
        // Check if the actions table already has the correct CHECK constraint
        const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='actions'").get() as { sql: string } | undefined;
        if (tableInfo && tableInfo.sql.includes('code_fix')) {
          logger.debug({ migration: migration.name }, 'Migration skipped - actions table already has code_fix');
          continue;
        }
        // Need to recreate the table with updated constraints
        db.exec(`
          DROP TABLE IF EXISTS actions_new;
          CREATE TABLE actions_new (
            id TEXT PRIMARY KEY,
            incident_id TEXT NOT NULL REFERENCES incidents(id),
            hypothesis_id TEXT REFERENCES hypotheses(id),
            type TEXT NOT NULL CHECK (type IN ('rollback', 'restart', 'scale', 'manual', 'code_fix')),
            target TEXT NOT NULL,
            parameters TEXT,
            status TEXT NOT NULL CHECK (status IN ('pending', 'executing', 'completed', 'failed', 'cancelled')),
            result TEXT,
            dry_run INTEGER NOT NULL,
            executed_at INTEGER,
            completed_at INTEGER,
            created_at INTEGER NOT NULL
          );
          INSERT OR IGNORE INTO actions_new SELECT * FROM actions;
          DROP TABLE actions;
          ALTER TABLE actions_new RENAME TO actions;
          CREATE INDEX IF NOT EXISTS idx_actions_incident ON actions(incident_id);
        `);
        logger.info({ migration: migration.name }, 'Migration applied successfully');
        continue;
      }

      db.exec(migration.sql);
      logger.info({ migration: migration.name }, 'Migration applied successfully');
    } catch (error) {
      // Ignore "duplicate column" errors - column already exists
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.includes('duplicate column')) {
        logger.debug({ migration: migration.name }, 'Migration skipped - column already exists');
      } else {
        logger.warn({ migration: migration.name, error: errorMessage }, 'Migration failed');
      }
    }
  }
}

/**
 * Get database instance
 */
export function getDatabase(): DatabaseConnection {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initializeDatabase first.');
  }
  return dbInstance;
}

/**
 * Close database connection
 */
export function closeDatabase(): void {
  if (sqliteInstance) {
    sqliteInstance.close();
    sqliteInstance = null;
    dbInstance = null;
    logger.info('Database connection closed');
  }
}

/**
 * Run migrations (placeholder - will be implemented with drizzle-kit)
 */
export async function runMigrations(): Promise<void> {
  logger.info('Running database migrations');
  // Migrations will be handled by drizzle-kit
  // This is a placeholder for programmatic migration support
}

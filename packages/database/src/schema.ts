/**
 * Database Schema
 * Using Drizzle ORM with SQLite
 */

import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

/**
 * Incidents table
 */
export const incidents = sqliteTable('incidents', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  severity: text('severity', { enum: ['low', 'medium', 'high', 'critical'] }).notNull(),
  status: text('status', {
    enum: ['active', 'investigating', 'mitigating', 'resolved', 'closed'],
  }).notNull(),
  state: text('state', {
    enum: ['IDLE', 'OBSERVING', 'ORIENTING', 'DECIDING', 'ACTING', 'VERIFYING', 'DONE', 'FAILED'],
  }).notNull(),
  namespace: text('namespace').notNull(),
  // Direct link to MonitoredApp for investigation targeting (validated in API layer)
  monitoredAppId: text('monitored_app_id'),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  resolvedAt: integer('resolved_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  thumbnail: text('thumbnail'), // Base64 encoded image from first captured frame
  // Investigation tracking for scalability (H1 fix)
  isInvestigating: integer('is_investigating', { mode: 'boolean' }).default(false),
  investigationInstanceId: text('investigation_instance_id'), // Process/server instance identifier
  investigationHeartbeat: integer('investigation_heartbeat', { mode: 'timestamp' }),
  investigationStartedAt: integer('investigation_started_at', { mode: 'timestamp' }),
  // Self-healing integration - link to development cycle and code evolution
  linkedDevelopmentCycleId: text('linked_development_cycle_id'),
  linkedEvolutionId: text('linked_evolution_id'),
  // Remediation tracking - what was tried before code evolution
  remediationAttempts: text('remediation_attempts'), // JSON array of attempted actions
  // Per-phase retry tracking for resilient self-healing (JSON: { "OBSERVING": 0, "ORIENTING": 1, ... })
  phaseRetries: text('phase_retries'),
});

/**
 * Evidence table
 */
export const evidence = sqliteTable('evidence', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id')
    .notNull()
    .references(() => incidents.id),
  type: text('type', {
    enum: ['video_frame', 'log', 'metric', 'k8s_event', 'user_report'],
  }).notNull(),
  source: text('source').notNull(),
  content: text('content').notNull(), // JSON stringified
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
  confidence: real('confidence'),
  metadata: text('metadata'), // JSON stringified
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

/**
 * Hypotheses table
 */
export const hypotheses = sqliteTable('hypotheses', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id')
    .notNull()
    .references(() => incidents.id),
  rootCause: text('root_cause').notNull(),
  confidence: real('confidence').notNull(),
  status: text('status', {
    enum: ['proposed', 'testing', 'confirmed', 'rejected'],
  }).notNull(),
  supportingEvidence: text('supporting_evidence').notNull(), // JSON array of evidence IDs
  contradictingEvidence: text('contradicting_evidence'), // JSON array of evidence IDs
  suggestedActions: text('suggested_actions'), // JSON array of actions
  testingSteps: text('testing_steps'), // JSON array of steps
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

/**
 * Actions table
 */
export const actions = sqliteTable('actions', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id')
    .notNull()
    .references(() => incidents.id),
  hypothesisId: text('hypothesis_id').references(() => hypotheses.id),
  type: text('type', {
    enum: ['rollback', 'restart', 'scale', 'manual', 'code_fix'],
  }).notNull(),
  target: text('target').notNull(),
  parameters: text('parameters'), // JSON stringified
  status: text('status', {
    enum: ['pending', 'executing', 'completed', 'failed', 'cancelled'],
  }).notNull(),
  result: text('result'), // JSON stringified
  dryRun: integer('dry_run', { mode: 'boolean' }).notNull(),
  executedAt: integer('executed_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

/**
 * Thought states table (for Gemini thought signatures)
 */
export const thoughtStates = sqliteTable('thought_states', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id')
    .notNull()
    .references(() => incidents.id),
  phase: text('phase', {
    enum: ['OBSERVING', 'ORIENTING', 'DECIDING', 'ACTING', 'VERIFYING'],
  }).notNull(),
  signature: text('signature'), // Gemini thought signature
  signatureHash: text('signature_hash'),
  thinkingBudget: integer('thinking_budget').notNull(),
  tokensUsed: integer('tokens_used'),
  summary: text('summary'),
  insights: text('insights'), // JSON array
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

/**
 * Postmortems table
 */
export const postmortems = sqliteTable('postmortems', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id')
    .notNull()
    .references(() => incidents.id)
    .unique(),
  summary: text('summary').notNull(),
  timeline: text('timeline').notNull(), // JSON array
  rootCauseAnalysis: text('root_cause_analysis').notNull(),
  impactAnalysis: text('impact_analysis').notNull(),
  actionsTaken: text('actions_taken').notNull(), // JSON array
  lessonsLearned: text('lessons_learned').notNull(), // JSON array
  preventionRecommendations: text('prevention_recommendations').notNull(), // JSON array
  markdown: text('markdown').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

/**
 * Relations
 */
export const incidentsRelations = relations(incidents, ({ many, one }) => ({
  evidence: many(evidence),
  hypotheses: many(hypotheses),
  actions: many(actions),
  thoughtStates: many(thoughtStates),
  timelineEvents: many(timelineEvents),
  postmortem: one(postmortems),
}));

export const evidenceRelations = relations(evidence, ({ one }) => ({
  incident: one(incidents, {
    fields: [evidence.incidentId],
    references: [incidents.id],
  }),
}));

export const hypothesesRelations = relations(hypotheses, ({ one, many }) => ({
  incident: one(incidents, {
    fields: [hypotheses.incidentId],
    references: [incidents.id],
  }),
  actions: many(actions),
}));

export const actionsRelations = relations(actions, ({ one }) => ({
  incident: one(incidents, {
    fields: [actions.incidentId],
    references: [incidents.id],
  }),
  hypothesis: one(hypotheses, {
    fields: [actions.hypothesisId],
    references: [hypotheses.id],
  }),
}));

export const thoughtStatesRelations = relations(thoughtStates, ({ one }) => ({
  incident: one(incidents, {
    fields: [thoughtStates.incidentId],
    references: [incidents.id],
  }),
}));

export const postmortemsRelations = relations(postmortems, ({ one }) => ({
  incident: one(incidents, {
    fields: [postmortems.incidentId],
    references: [incidents.id],
  }),
}));

/**
 * Timeline events table - for investigation timeline
 */
export const timelineEvents = sqliteTable('timeline_events', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id')
    .notNull()
    .references(() => incidents.id),
  type: text('type', {
    enum: ['phase_change', 'evidence', 'hypothesis', 'action', 'verification', 'error'],
  }).notNull(),
  title: text('title').notNull(),
  description: text('description'),
  phase: text('phase', {
    enum: ['OBSERVING', 'ORIENTING', 'DECIDING', 'ACTING', 'VERIFYING', 'DONE', 'FAILED'],
  }),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
  metadata: text('metadata'), // JSON stringified
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const timelineEventsRelations = relations(timelineEvents, ({ one }) => ({
  incident: one(incidents, {
    fields: [timelineEvents.incidentId],
    references: [incidents.id],
  }),
}));

/**
 * Configs table - stores user-defined configuration settings
 */
export const configs = sqliteTable('configs', {
  id: text('id').primaryKey(), // e.g., 'kubernetes', 'dashboard', 'safety', 'development'
  category: text('category', {
    enum: ['kubernetes', 'dashboard', 'safety', 'platform', 'development'],
  }).notNull(),
  config: text('config').notNull(), // JSON stringified config object
  isValid: integer('is_valid', { mode: 'boolean' }).notNull().default(false),
  lastTestedAt: integer('last_tested_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

/**
 * Monitored Apps table - tracks which K8s applications are being monitored
 */
export const monitoredApps = sqliteTable('monitored_apps', {
  id: text('id').primaryKey(),
  namespace: text('namespace').notNull(),
  deployment: text('deployment').notNull(),
  displayName: text('display_name').notNull(),
  grafanaDashboardUid: text('grafana_dashboard_uid'),
  grafanaDashboardUrl: text('grafana_dashboard_url'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  // Link to development cycle for self-healing integration
  developmentCycleId: text('development_cycle_id')
    .references(() => developmentCycles.id),
  // Prometheus configuration for auto-discovery
  prometheusJob: text('prometheus_job'),
  alertRulesConfig: text('alert_rules_config'), // JSON - custom alert rules
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// ===========================================
// Development / Self-Regenerating Tables
// ===========================================

/**
 * Development Cycles table - tracks autonomous development cycles
 */
export const developmentCycles = sqliteTable('development_cycles', {
  id: text('id').primaryKey(),
  phase: text('phase', {
    enum: ['IDLE', 'ANALYZING', 'DESIGNING', 'CODING', 'TESTING', 'BUILDING', 'DEPLOYING', 'VERIFYING', 'COMPLETED', 'FAILED'],
  }).notNull(),
  // Service type for multi-service architecture
  serviceType: text('service_type', {
    enum: ['backend', 'frontend', 'fullstack'],
  }).notNull().default('backend'),
  // Frontend configuration (JSON) - for frontend/fullstack types
  frontendConfig: text('frontend_config'),
  // Storage mode for database persistence
  storageMode: text('storage_mode', {
    enum: ['memory', 'sqlite', 'postgres'],
  }).notNull().default('memory'),
  // Original requirement
  requirementSource: text('requirement_source', {
    enum: ['user', 'incident', 'improvement', 'pattern'],
  }).notNull(),
  requirementRaw: text('requirement_raw').notNull(),
  requirementPriority: text('requirement_priority', {
    enum: ['low', 'medium', 'high', 'critical'],
  }).notNull(),
  // Analyzed requirement (JSON)
  analyzedRequirement: text('analyzed_requirement'),
  // Architecture design (JSON)
  architecture: text('architecture'),
  // Architecture diagram image URL (generated by Gemini image model)
  architectureDiagramUrl: text('architecture_diagram_url'),
  // Generated code summary (JSON - files list with paths)
  generatedCodeSummary: text('generated_code_summary'),
  // Test results (JSON)
  testResults: text('test_results'),
  // Build result (JSON)
  buildResult: text('build_result'),
  // Deployment info (JSON)
  deployment: text('deployment'),
  // Verification result (JSON)
  verification: text('verification'),
  // Link to triggering incident
  triggeredByIncidentId: text('triggered_by_incident_id').references(() => incidents.id),
  // Progress tracking
  iterations: integer('iterations').notNull().default(0),
  maxIterations: integer('max_iterations').notNull().default(5),
  // Error info if failed (JSON)
  error: text('error'),
  // Thought signature for continuity
  thoughtSignature: text('thought_signature'),
  // Per-phase retry tracking for resilient self-healing (JSON: { "ANALYZING": 0, "DESIGNING": 1, ... })
  phaseRetries: text('phase_retries'),
  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
});

/**
 * Generated Files table - stores generated code files for audit
 */
export const generatedFiles = sqliteTable('generated_files', {
  id: text('id').primaryKey(),
  developmentCycleId: text('development_cycle_id')
    .notNull()
    .references(() => developmentCycles.id),
  // File info
  path: text('path').notNull(),
  language: text('language', {
    enum: ['typescript', 'javascript', 'json', 'yaml', 'dockerfile', 'markdown', 'shell', 'css', 'html'],
  }).notNull(),
  purpose: text('purpose').notNull(),
  isNew: integer('is_new', { mode: 'boolean' }).notNull(),
  // Content tracking
  content: text('content').notNull(),
  contentHash: text('content_hash'),
  // Validation status
  validationStatus: text('validation_status', {
    enum: ['pending', 'valid', 'invalid', 'fixed'],
  }).notNull().default('pending'),
  validationErrors: text('validation_errors'), // JSON array
  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

/**
 * Learned Patterns table - stores patterns extracted from incidents
 */
export const learnedPatterns = sqliteTable('learned_patterns', {
  id: text('id').primaryKey(),
  // Pattern info
  type: text('type', {
    enum: ['detection', 'diagnostic', 'resolution', 'prevention'],
  }).notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  // Trigger conditions (JSON array)
  triggerConditions: text('trigger_conditions').notNull(),
  // Recommended actions (JSON array)
  recommendedActions: text('recommended_actions').notNull(),
  // Pattern quality
  confidence: real('confidence').notNull(),
  applicability: text('applicability').notNull(),
  exceptions: text('exceptions').notNull(), // JSON array
  // Usage tracking
  timesMatched: integer('times_matched').notNull().default(0),
  timesApplied: integer('times_applied').notNull().default(0),
  successRate: real('success_rate'),
  // Source incident
  sourceIncidentId: text('source_incident_id').references(() => incidents.id),
  // Status
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

/**
 * Reconstructed Incidents table - stores 1M context reconstructions
 */
export const reconstructedIncidents = sqliteTable('reconstructed_incidents', {
  id: text('id').primaryKey(),
  // Can link to an incident or be standalone
  incidentId: text('incident_id').references(() => incidents.id),
  // Time range analyzed
  timeRangeStart: integer('time_range_start', { mode: 'timestamp' }).notNull(),
  timeRangeEnd: integer('time_range_end', { mode: 'timestamp' }).notNull(),
  // Reconstruction results (JSON)
  timeline: text('timeline').notNull(),
  causalChain: text('causal_chain').notNull(),
  rootCause: text('root_cause').notNull(),
  recommendations: text('recommendations').notNull(),
  narrative: text('narrative').notNull(),
  // Data quality (JSON)
  dataQuality: text('data_quality').notNull(),
  // Token usage
  inputTokensUsed: integer('input_tokens_used'),
  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// Development relations
export const developmentCyclesRelations = relations(developmentCycles, ({ one, many }) => ({
  triggeredByIncident: one(incidents, {
    fields: [developmentCycles.triggeredByIncidentId],
    references: [incidents.id],
  }),
  generatedFiles: many(generatedFiles),
  registeredService: one(serviceRegistry),
}));

export const generatedFilesRelations = relations(generatedFiles, ({ one }) => ({
  developmentCycle: one(developmentCycles, {
    fields: [generatedFiles.developmentCycleId],
    references: [developmentCycles.id],
  }),
}));

export const learnedPatternsRelations = relations(learnedPatterns, ({ one }) => ({
  sourceIncident: one(incidents, {
    fields: [learnedPatterns.sourceIncidentId],
    references: [incidents.id],
  }),
}));

export const reconstructedIncidentsRelations = relations(reconstructedIncidents, ({ one }) => ({
  incident: one(incidents, {
    fields: [reconstructedIncidents.incidentId],
    references: [incidents.id],
  }),
}));

// ===========================================
// Service Registry Tables
// ===========================================

/**
 * Service Registry table - tracks deployed services with their API endpoints
 * Enables frontend apps to discover and consume backend APIs
 */
export const serviceRegistry = sqliteTable('service_registry', {
  id: text('id').primaryKey(),
  // Link to development cycle that created this service
  developmentCycleId: text('development_cycle_id')
    .notNull()
    .references(() => developmentCycles.id),
  // Service identification
  name: text('name').notNull(),
  displayName: text('display_name').notNull(),
  description: text('description'),
  // Service type
  serviceType: text('service_type', {
    enum: ['backend', 'frontend', 'fullstack'],
  }).notNull(),
  // Deployment info (denormalized for quick access)
  namespace: text('namespace').notNull(),
  serviceUrl: text('service_url').notNull(),
  healthEndpoint: text('health_endpoint'),
  // API specification (OpenAPI JSON for backends)
  apiSpec: text('api_spec'),
  apiVersion: text('api_version'),
  // Available endpoints summary (JSON array)
  endpoints: text('endpoints'),
  // Services this service depends on (JSON array of service IDs)
  dependsOnServices: text('depends_on_services'),
  // Status
  status: text('status', {
    enum: ['active', 'degraded', 'unavailable', 'retired'],
  }).notNull().default('active'),
  lastHealthCheck: integer('last_health_check', { mode: 'timestamp' }),
  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const serviceRegistryRelations = relations(serviceRegistry, ({ one }) => ({
  developmentCycle: one(developmentCycles, {
    fields: [serviceRegistry.developmentCycleId],
    references: [developmentCycles.id],
  }),
}));

// ===========================================
// File Versioning and Edit Lock Tables
// ===========================================

/**
 * File Versions table - tracks version history for generated files
 */
export const fileVersions = sqliteTable('file_versions', {
  id: text('id').primaryKey(),
  generatedFileId: text('generated_file_id')
    .notNull()
    .references(() => generatedFiles.id),
  developmentCycleId: text('development_cycle_id')
    .notNull()
    .references(() => developmentCycles.id),
  // Version info
  version: integer('version').notNull(),
  content: text('content').notNull(),
  contentHash: text('content_hash').notNull(),
  // Change tracking
  changeType: text('change_type', {
    enum: ['create', 'edit', 'evolution', 'revert'],
  }).notNull(),
  changeDescription: text('change_description'),
  // Source of change
  changedBy: text('changed_by', {
    enum: ['user', 'ai', 'system'],
  }).notNull(),
  evolutionId: text('evolution_id').references(() => codeEvolutions.id),
  // Git info (if committed)
  commitHash: text('commit_hash'),
  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

/**
 * Edit Locks table - pessimistic locking for file editing
 */
export const editLocks = sqliteTable('edit_locks', {
  id: text('id').primaryKey(),
  developmentCycleId: text('development_cycle_id')
    .notNull()
    .references(() => developmentCycles.id),
  // Lock info
  lockedBy: text('locked_by').notNull(), // User session ID or identifier
  lockedByName: text('locked_by_name'), // Display name
  lockType: text('lock_type', {
    enum: ['edit', 'evolution'],
  }).notNull(),
  // Scope - specific files or entire project
  scope: text('scope', {
    enum: ['file', 'project'],
  }).notNull(),
  lockedFiles: text('locked_files'), // JSON array of file paths (for file scope)
  // Timing
  acquiredAt: integer('acquired_at', { mode: 'timestamp' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  lastHeartbeat: integer('last_heartbeat', { mode: 'timestamp' }).notNull(),
  extensionCount: integer('extension_count').notNull().default(0),
  // Status
  status: text('status', {
    enum: ['active', 'expired', 'released'],
  }).notNull().default('active'),
  // Backup for recovery
  localBackup: text('local_backup'), // JSON of unsaved changes at lock expiry
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

/**
 * Code Evolutions table - tracks AI-powered code evolution requests
 */
export const codeEvolutions = sqliteTable('code_evolutions', {
  id: text('id').primaryKey(),
  developmentCycleId: text('development_cycle_id')
    .notNull()
    .references(() => developmentCycles.id),
  // Evolution request
  prompt: text('prompt').notNull(),
  scope: text('scope'), // JSON array of file paths to evolve (null = AI decides)
  // Status
  status: text('status', {
    enum: ['pending', 'analyzing', 'generating', 'review', 'approved', 'rejected', 'applied', 'reverted', 'failed'],
  }).notNull().default('pending'),
  // AI analysis
  analysisResult: text('analysis_result'), // JSON: impact assessment, affected files
  // Generated changes
  proposedChanges: text('proposed_changes'), // JSON: array of file diffs
  filesAffected: integer('files_affected'),
  // User decision
  reviewedBy: text('reviewed_by'),
  reviewedAt: integer('reviewed_at', { mode: 'timestamp' }),
  reviewNotes: text('review_notes'),
  // Application
  appliedAt: integer('applied_at', { mode: 'timestamp' }),
  appliedCommitHash: text('applied_commit_hash'),
  // Revert info (if auto-reverted due to failure)
  revertedAt: integer('reverted_at', { mode: 'timestamp' }),
  revertReason: text('revert_reason'),
  revertCommitHash: text('revert_commit_hash'),
  // Error info
  error: text('error'),
  // Self-healing integration - incident that triggered this evolution
  triggeredByIncidentId: text('triggered_by_incident_id'),
  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

/**
 * Git Repositories table - tracks git repo info for development cycles
 */
export const gitRepositories = sqliteTable('git_repositories', {
  id: text('id').primaryKey(),
  developmentCycleId: text('development_cycle_id')
    .notNull()
    .references(() => developmentCycles.id)
    .unique(),
  // Local info
  localPath: text('local_path').notNull(),
  currentBranch: text('current_branch').notNull().default('main'),
  // Remote info (if GitHub connected)
  remoteUrl: text('remote_url'),
  remoteName: text('remote_name').default('origin'),
  githubRepoId: integer('github_repo_id'),
  githubRepoFullName: text('github_repo_full_name'),
  // Sync status
  lastCommitHash: text('last_commit_hash'),
  lastCommitMessage: text('last_commit_message'),
  lastCommitDate: integer('last_commit_date', { mode: 'timestamp' }),
  lastPushDate: integer('last_push_date', { mode: 'timestamp' }),
  // Status
  status: text('status', {
    enum: ['initialized', 'active', 'synced', 'error'],
  }).notNull().default('initialized'),
  errorMessage: text('error_message'),
  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// File versioning relations
export const fileVersionsRelations = relations(fileVersions, ({ one }) => ({
  generatedFile: one(generatedFiles, {
    fields: [fileVersions.generatedFileId],
    references: [generatedFiles.id],
  }),
  developmentCycle: one(developmentCycles, {
    fields: [fileVersions.developmentCycleId],
    references: [developmentCycles.id],
  }),
  evolution: one(codeEvolutions, {
    fields: [fileVersions.evolutionId],
    references: [codeEvolutions.id],
  }),
}));

export const editLocksRelations = relations(editLocks, ({ one }) => ({
  developmentCycle: one(developmentCycles, {
    fields: [editLocks.developmentCycleId],
    references: [developmentCycles.id],
  }),
}));

export const codeEvolutionsRelations = relations(codeEvolutions, ({ one, many }) => ({
  developmentCycle: one(developmentCycles, {
    fields: [codeEvolutions.developmentCycleId],
    references: [developmentCycles.id],
  }),
  fileVersions: many(fileVersions),
}));

export const gitRepositoriesRelations = relations(gitRepositories, ({ one }) => ({
  developmentCycle: one(developmentCycles, {
    fields: [gitRepositories.developmentCycleId],
    references: [developmentCycles.id],
  }),
}));


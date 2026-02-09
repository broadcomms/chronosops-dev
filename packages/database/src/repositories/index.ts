/**
 * Repository exports
 */

export { IncidentRepository, incidentRepository } from './incident-repository.js';
export type { CreateIncidentInput, UpdateIncidentInput, IncidentFilters } from './incident-repository.js';

export { EvidenceRepository, evidenceRepository } from './evidence-repository.js';
export type { CreateEvidenceInput, EvidenceFilters } from './evidence-repository.js';

export { ConfigRepository, configRepository } from './config-repository.js';
export type { ConfigRecord, UpsertConfigInput, ConfigCategory } from './config-repository.js';

export { HypothesisRepository, hypothesisRepository } from './hypothesis-repository.js';
export type { CreateHypothesisInput, UpdateHypothesisInput, HypothesisRecord } from './hypothesis-repository.js';

export { ActionRepository, actionRepository } from './action-repository.js';
export type { CreateActionInput, UpdateActionInput, ActionRecord, ActionType, ActionStatus } from './action-repository.js';

export { ThoughtStateRepository, thoughtStateRepository } from './thought-state-repository.js';
export type { CreateThoughtStateInput, ThoughtStateRecord, ThinkingPhase } from './thought-state-repository.js';

export { TimelineRepository, timelineRepository } from './timeline-repository.js';
export type { CreateTimelineEventInput, TimelineEventRecord, TimelineEventType, TimelinePhase } from './timeline-repository.js';

export { PostmortemRepository, postmortemRepository } from './postmortem-repository.js';
export type { CreatePostmortemInput, PostmortemRecord } from './postmortem-repository.js';

export { MonitoredAppRepository, monitoredAppRepository } from './monitored-app-repository.js';
export type { MonitoredApp, CreateMonitoredAppInput, UpdateMonitoredAppInput } from './monitored-app-repository.js';

// Development / Self-Regenerating repositories
export { DevelopmentCycleRepository, developmentCycleRepository } from './development-cycle-repository.js';
export type {
  CreateDevelopmentCycleInput,
  UpdateDevelopmentCycleInput,
  DevelopmentCycleFilters,
  DevelopmentCycleRecord,
  RequirementSource,
  RequirementPriority,
  StorageMode,
} from './development-cycle-repository.js';

export { GeneratedFileRepository, generatedFileRepository } from './generated-file-repository.js';
export type {
  CreateGeneratedFileInput,
  UpdateGeneratedFileInput,
  GeneratedFileFilters,
  GeneratedFileRecord,
  FileLanguage,
  ValidationStatus,
} from './generated-file-repository.js';

export { LearnedPatternRepository, learnedPatternRepository } from './learned-pattern-repository.js';
export type {
  CreateLearnedPatternInput,
  UpdateLearnedPatternInput,
  LearnedPatternFilters,
  LearnedPatternRecord,
  PatternType,
} from './learned-pattern-repository.js';

export { ReconstructedIncidentRepository, reconstructedIncidentRepository } from './reconstructed-incident-repository.js';
export type {
  CreateReconstructedIncidentInput,
  ReconstructedIncidentFilters,
  ReconstructedIncidentRecord,
} from './reconstructed-incident-repository.js';

// Service Registry (multi-service architecture)
export { ServiceRegistryRepository, serviceRegistryRepository } from './service-registry-repository.js';
export type {
  CreateServiceInput,
  UpdateServiceInput,
  ServiceRegistryFilters,
  ServiceRegistryRecord,
} from './service-registry-repository.js';

// File Versioning and Edit Locks
export { FileVersionRepository } from './file-version-repository.js';
export type {
  CreateFileVersionInput,
  FileVersionRecord,
  ChangeType,
  ChangedBy,
} from './file-version-repository.js';

export { EditLockRepository } from './edit-lock-repository.js';
export type {
  AcquireLockInput,
  UpdateLockInput,
  EditLockRecord,
  LockType,
  LockScope,
  LockStatus,
} from './edit-lock-repository.js';

export { CodeEvolutionRepository } from './code-evolution-repository.js';
export type {
  CreateEvolutionInput,
  UpdateEvolutionInput,
  CodeEvolutionRecord,
  EvolutionStatus,
  EvolutionAnalysisResult,
  ProposedChange,
} from './code-evolution-repository.js';

export { GitRepositoryRepository } from './git-repository-repository.js';
export type {
  CreateGitRepoInput,
  UpdateGitRepoInput,
  GitRepositoryRecord,
  GitRepoStatus,
} from './git-repository-repository.js';

// Timeline aggregator for unified history view
export { TimelineAggregator, timelineAggregator } from './timeline-aggregator.js';

// Singleton instances for new repositories
import { FileVersionRepository } from './file-version-repository.js';
import { EditLockRepository } from './edit-lock-repository.js';
import { CodeEvolutionRepository } from './code-evolution-repository.js';
import { GitRepositoryRepository } from './git-repository-repository.js';

export const fileVersionRepository = new FileVersionRepository();
export const editLockRepository = new EditLockRepository();
export const codeEvolutionRepository = new CodeEvolutionRepository();
export const gitRepositoryRepository = new GitRepositoryRepository();

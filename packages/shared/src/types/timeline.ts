/**
 * Unified Timeline Types for ChronosOps History View
 * Aggregates events from incidents, development cycles, evolutions, patterns, and actions
 */

/**
 * Entity types that can appear in the unified timeline
 */
export type TimelineEntityType =
  | 'incident'
  | 'development_cycle'
  | 'code_evolution'
  | 'learned_pattern'
  | 'action'
  | 'reconstruction';

/**
 * Status colors for visual distinction
 */
export type TimelineStatusColor = 'green' | 'red' | 'yellow' | 'blue' | 'purple' | 'gray' | 'cyan' | 'orange';

/**
 * Icon identifiers for different entity types
 */
export type TimelineIcon =
  | 'incident'      // 🔴 Alert/incident
  | 'development'   // ⚙️ Code/development
  | 'evolution'     // 🧬 DNA/evolution
  | 'pattern'       // 💡 Lightbulb/insight
  | 'action'        // 🔧 Wrench/action
  | 'reconstruction'; // 📊 Chart/analysis

/**
 * Unified timeline event - normalized representation of any historical event
 */
export interface UnifiedTimelineEvent {
  /** Unique identifier for the timeline event */
  id: string;

  /** Type of entity this event represents */
  entityType: TimelineEntityType;

  /** ID of the underlying entity (incident ID, cycle ID, etc.) */
  entityId: string;

  /** Primary timestamp for sorting (ISO 8601) */
  timestamp: string;

  /** Human-readable title */
  title: string;

  /** Optional description or summary */
  description?: string;

  /** Icon identifier for visual representation */
  icon: TimelineIcon;

  /** Current status text (e.g., "resolved", "completed", "applied") */
  status: string;

  /** Color for status badge */
  statusColor: TimelineStatusColor;

  /** Type-specific metadata */
  metadata: TimelineEventMetadata;

  /** Related entities for linking (e.g., incident's linked development cycle) */
  relatedEntities?: TimelineRelatedEntity[];

  /** Duration in milliseconds (for completed events) */
  durationMs?: number;
}

/**
 * Type-specific metadata attached to timeline events
 */
export interface TimelineEventMetadata {
  /** For incidents: severity level */
  severity?: 'low' | 'medium' | 'high' | 'critical';

  /** For incidents: OODA state */
  oodaState?: string;

  /** For development cycles: current phase */
  phase?: string;

  /** For development cycles: service type */
  serviceType?: 'backend' | 'frontend' | 'fullstack';

  /** For evolutions: number of files affected */
  filesAffected?: number;

  /** For patterns: confidence score (0-1) */
  confidence?: number;

  /** For patterns: success rate percentage */
  successRate?: number;

  /** For actions: action type */
  actionType?: 'rollback' | 'restart' | 'scale' | 'code_fix' | 'manual';

  /** Kubernetes namespace */
  namespace?: string;

  /** Target (deployment name, etc.) */
  target?: string;

  /** Whether action was dry-run */
  dryRun?: boolean;

  /** Count of sub-items (e.g., evidence count, hypotheses count) */
  itemCount?: number;

  /** For evolutions: lines changed */
  linesChanged?: number;

  /** For patterns: usage count */
  usageCount?: number;

  /** For actions: execution duration in ms */
  duration?: number;

  /** For reconstructions: tokens used for analysis */
  tokensUsed?: number | null;
}

/**
 * Related entity reference for cross-linking
 */
export interface TimelineRelatedEntity {
  /** Entity type */
  type: TimelineEntityType;

  /** Entity ID */
  id: string;

  /** Display label */
  label: string;
}

/**
 * Query parameters for fetching unified timeline
 */
export interface UnifiedTimelineParams {
  /** Start of date range (ISO 8601) */
  startDate?: string;

  /** End of date range (ISO 8601) */
  endDate?: string;

  /** Filter by entity types */
  entityTypes?: TimelineEntityType[];

  /** Filter by severity (for incidents) */
  severity?: ('low' | 'medium' | 'high' | 'critical')[];

  /** Filter by namespace */
  namespace?: string;

  /** Search text (matches title, description) */
  search?: string;

  /** Maximum results to return */
  limit?: number;

  /** Offset for pagination */
  offset?: number;

  /** Cursor for cursor-based pagination (timestamp) */
  cursor?: string;
}

/**
 * Response from unified timeline endpoint
 */
export interface UnifiedTimelineResponse {
  /** Timeline events */
  events: UnifiedTimelineEvent[];

  /** Total count (for pagination info) */
  totalCount: number;

  /** Next cursor for pagination (ISO timestamp of last event) */
  cursor?: string;

  /** Whether there are more events */
  hasMore: boolean;
}

/**
 * Timeline filter state for UI
 */
export interface TimelineFilterState {
  /** Date range filter */
  dateRange: {
    start: Date | null;
    end: Date | null;
  };
  /** Toggle state for each entity type (allows UI checkboxes) */
  entityTypes: Record<TimelineEntityType, boolean>;
  /** Status filter (optional) */
  status: string | null;
  /** Search query */
  searchQuery: string;
}

/**
 * Default filter state
 */
export const DEFAULT_TIMELINE_FILTERS: TimelineFilterState = {
  dateRange: {
    start: null,
    end: null,
  },
  entityTypes: {
    incident: true,
    development_cycle: true,
    code_evolution: true,
    learned_pattern: true,
    action: true,
    reconstruction: true,
  },
  status: null,
  searchQuery: '',
};

/**
 * Entity type display configuration
 */
export const TIMELINE_ENTITY_CONFIG: Record<
  TimelineEntityType,
  {
    label: string;
    icon: TimelineIcon;
    defaultColor: TimelineStatusColor;
  }
> = {
  incident: {
    label: 'Incidents',
    icon: 'incident',
    defaultColor: 'red',
  },
  development_cycle: {
    label: 'Development Cycles',
    icon: 'development',
    defaultColor: 'blue',
  },
  code_evolution: {
    label: 'Code Evolutions',
    icon: 'evolution',
    defaultColor: 'purple',
  },
  learned_pattern: {
    label: 'Learned Patterns',
    icon: 'pattern',
    defaultColor: 'yellow',
  },
  action: {
    label: 'Remediation Actions',
    icon: 'action',
    defaultColor: 'gray',
  },
  reconstruction: {
    label: 'Reconstructions',
    icon: 'reconstruction',
    defaultColor: 'cyan',
  },
};

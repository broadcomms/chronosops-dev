/**
 * Timeline Aggregator
 * Aggregates events from multiple sources into a unified timeline for the History view
 */

import { desc, and, gte, lte, or, like, inArray } from 'drizzle-orm';
import { getDatabase } from '../connection.js';
import {
  incidents,
  developmentCycles,
  codeEvolutions,
  learnedPatterns,
  actions,
  reconstructedIncidents,
} from '../schema.js';
import type {
  UnifiedTimelineEvent,
  UnifiedTimelineParams,
  UnifiedTimelineResponse,
  TimelineEntityType,
  TimelineStatusColor,
} from '@chronosops/shared';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Get status color for incidents based on status
 */
function getIncidentStatusColor(status: string): TimelineStatusColor {
  switch (status) {
    case 'resolved':
    case 'closed':
      return 'green';
    case 'active':
    case 'investigating':
      return 'red';
    case 'mitigating':
      return 'yellow';
    default:
      return 'gray';
  }
}

/**
 * Get status color for development cycles based on phase
 */
function getDevelopmentStatusColor(phase: string): TimelineStatusColor {
  switch (phase) {
    case 'COMPLETED':
      return 'green';
    case 'FAILED':
      return 'red';
    case 'IDLE':
      return 'gray';
    default:
      return 'blue';
  }
}

/**
 * Get status color for evolutions based on status
 */
function getEvolutionStatusColor(status: string): TimelineStatusColor {
  switch (status) {
    case 'applied':
      return 'green';
    case 'approved':
    case 'review':
      return 'blue';
    case 'failed':
    case 'reverted':
    case 'rejected':
      return 'red';
    case 'pending':
    case 'analyzing':
    case 'generating':
      return 'purple';
    default:
      return 'gray';
  }
}

/**
 * Get status color for actions based on status
 */
function getActionStatusColor(status: string): TimelineStatusColor {
  switch (status) {
    case 'completed':
      return 'green';
    case 'failed':
    case 'cancelled':
      return 'red';
    case 'executing':
      return 'yellow';
    case 'pending':
      return 'gray';
    default:
      return 'gray';
  }
}

export class TimelineAggregator {
  /**
   * Fetch unified timeline with aggregated events from all sources
   */
  async getUnifiedTimeline(params: UnifiedTimelineParams): Promise<UnifiedTimelineResponse> {
    const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = params.offset ?? 0;

    // Determine which entity types to fetch
    const entityTypes: TimelineEntityType[] = params.entityTypes ?? [
      'incident',
      'development_cycle',
      'code_evolution',
      'learned_pattern',
      'action',
      'reconstruction',
    ];

    // Fetch events from each source in parallel
    const eventPromises: Promise<UnifiedTimelineEvent[]>[] = [];

    if (entityTypes.includes('incident')) {
      eventPromises.push(this.fetchIncidentEvents(params));
    }
    if (entityTypes.includes('development_cycle')) {
      eventPromises.push(this.fetchDevelopmentEvents(params));
    }
    if (entityTypes.includes('code_evolution')) {
      eventPromises.push(this.fetchEvolutionEvents(params));
    }
    if (entityTypes.includes('learned_pattern')) {
      eventPromises.push(this.fetchPatternEvents(params));
    }
    if (entityTypes.includes('action')) {
      eventPromises.push(this.fetchActionEvents(params));
    }
    if (entityTypes.includes('reconstruction')) {
      eventPromises.push(this.fetchReconstructionEvents(params));
    }

    // Wait for all queries
    const results = await Promise.all(eventPromises);

    // Merge and sort all events by timestamp (descending)
    let allEvents = results.flat().sort((a, b) => {
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    // Apply cursor-based pagination if cursor provided
    if (params.cursor) {
      const cursorDate = new Date(params.cursor);
      allEvents = allEvents.filter((e) => new Date(e.timestamp) < cursorDate);
    }

    // Get total before pagination
    const totalCount = allEvents.length;

    // Apply offset/limit pagination
    const paginatedEvents = allEvents.slice(offset, offset + limit);

    // Determine next cursor
    const lastEvent = paginatedEvents[paginatedEvents.length - 1];
    const cursor = lastEvent ? lastEvent.timestamp : undefined;

    return {
      events: paginatedEvents,
      totalCount,
      cursor,
      hasMore: offset + limit < totalCount,
    };
  }

  /**
   * Fetch incident events
   */
  private async fetchIncidentEvents(params: UnifiedTimelineParams): Promise<UnifiedTimelineEvent[]> {
    const db = getDatabase();

    // Build conditions
    const conditions = [];

    if (params.startDate) {
      conditions.push(gte(incidents.createdAt, new Date(params.startDate)));
    }
    if (params.endDate) {
      conditions.push(lte(incidents.createdAt, new Date(params.endDate)));
    }
    if (params.namespace) {
      conditions.push(like(incidents.namespace, `%${params.namespace}%`));
    }
    if (params.severity && params.severity.length > 0) {
      conditions.push(inArray(incidents.severity, params.severity));
    }
    if (params.search) {
      conditions.push(
        or(
          like(incidents.title, `%${params.search}%`),
          like(incidents.description, `%${params.search}%`)
        )
      );
    }

    const query = db
      .select()
      .from(incidents)
      .orderBy(desc(incidents.createdAt))
      .limit(MAX_LIMIT);

    const results = conditions.length > 0
      ? await query.where(and(...conditions))
      : await query;

    return results.map((incident): UnifiedTimelineEvent => {
      const durationMs = incident.resolvedAt && incident.startedAt
        ? new Date(incident.resolvedAt).getTime() - new Date(incident.startedAt).getTime()
        : undefined;

      return {
        id: `incident-${incident.id}`,
        entityType: 'incident',
        entityId: incident.id,
        timestamp: incident.createdAt?.toISOString() ?? new Date().toISOString(),
        title: incident.title,
        description: incident.description ?? undefined,
        icon: 'incident',
        status: incident.status,
        statusColor: getIncidentStatusColor(incident.status),
        metadata: {
          severity: incident.severity as 'low' | 'medium' | 'high' | 'critical',
          oodaState: incident.state,
          namespace: incident.namespace,
        },
        durationMs,
        relatedEntities: incident.linkedDevelopmentCycleId
          ? [
              {
                type: 'development_cycle',
                id: incident.linkedDevelopmentCycleId,
                label: 'Linked Development Cycle',
              },
            ]
          : undefined,
      };
    });
  }

  /**
   * Fetch development cycle events
   */
  private async fetchDevelopmentEvents(params: UnifiedTimelineParams): Promise<UnifiedTimelineEvent[]> {
    const db = getDatabase();

    const conditions = [];

    if (params.startDate) {
      conditions.push(gte(developmentCycles.createdAt, new Date(params.startDate)));
    }
    if (params.endDate) {
      conditions.push(lte(developmentCycles.createdAt, new Date(params.endDate)));
    }
    if (params.search) {
      conditions.push(like(developmentCycles.requirementRaw, `%${params.search}%`));
    }

    const query = db
      .select()
      .from(developmentCycles)
      .orderBy(desc(developmentCycles.createdAt))
      .limit(MAX_LIMIT);

    const results = conditions.length > 0
      ? await query.where(and(...conditions))
      : await query;

    return results.map((cycle): UnifiedTimelineEvent => {
      const durationMs = cycle.completedAt && cycle.createdAt
        ? new Date(cycle.completedAt).getTime() - new Date(cycle.createdAt).getTime()
        : undefined;

      // Extract a title from requirement
      const title = cycle.requirementRaw.length > 80
        ? cycle.requirementRaw.substring(0, 80) + '...'
        : cycle.requirementRaw;

      return {
        id: `development-${cycle.id}`,
        entityType: 'development_cycle',
        entityId: cycle.id,
        timestamp: cycle.createdAt?.toISOString() ?? new Date().toISOString(),
        title,
        description: `${cycle.serviceType} service - ${cycle.phase}`,
        icon: 'development',
        status: cycle.phase,
        statusColor: getDevelopmentStatusColor(cycle.phase),
        metadata: {
          phase: cycle.phase,
          serviceType: cycle.serviceType as 'backend' | 'frontend' | 'fullstack',
        },
        durationMs,
        relatedEntities: cycle.triggeredByIncidentId
          ? [
              {
                type: 'incident',
                id: cycle.triggeredByIncidentId,
                label: 'Triggered by Incident',
              },
            ]
          : undefined,
      };
    });
  }

  /**
   * Fetch code evolution events
   */
  private async fetchEvolutionEvents(params: UnifiedTimelineParams): Promise<UnifiedTimelineEvent[]> {
    const db = getDatabase();

    const conditions = [];

    if (params.startDate) {
      conditions.push(gte(codeEvolutions.createdAt, new Date(params.startDate)));
    }
    if (params.endDate) {
      conditions.push(lte(codeEvolutions.createdAt, new Date(params.endDate)));
    }
    if (params.search) {
      conditions.push(like(codeEvolutions.prompt, `%${params.search}%`));
    }

    const query = db
      .select()
      .from(codeEvolutions)
      .orderBy(desc(codeEvolutions.createdAt))
      .limit(MAX_LIMIT);

    const results = conditions.length > 0
      ? await query.where(and(...conditions))
      : await query;

    return results.map((evolution): UnifiedTimelineEvent => {
      const title = evolution.prompt.length > 80
        ? evolution.prompt.substring(0, 80) + '...'
        : evolution.prompt;

      return {
        id: `evolution-${evolution.id}`,
        entityType: 'code_evolution',
        entityId: evolution.id,
        timestamp: evolution.createdAt?.toISOString() ?? new Date().toISOString(),
        title,
        description: `Status: ${evolution.status}${evolution.filesAffected ? ` - ${evolution.filesAffected} files` : ''}`,
        icon: 'evolution',
        status: evolution.status,
        statusColor: getEvolutionStatusColor(evolution.status),
        metadata: {
          filesAffected: evolution.filesAffected ?? undefined,
        },
        relatedEntities: [
          {
            type: 'development_cycle',
            id: evolution.developmentCycleId,
            label: 'Parent Development Cycle',
          },
          ...(evolution.triggeredByIncidentId
            ? [
                {
                  type: 'incident' as TimelineEntityType,
                  id: evolution.triggeredByIncidentId,
                  label: 'Triggered by Incident',
                },
              ]
            : []),
        ],
      };
    });
  }

  /**
   * Fetch learned pattern events
   */
  private async fetchPatternEvents(params: UnifiedTimelineParams): Promise<UnifiedTimelineEvent[]> {
    const db = getDatabase();

    const conditions = [];

    if (params.startDate) {
      conditions.push(gte(learnedPatterns.createdAt, new Date(params.startDate)));
    }
    if (params.endDate) {
      conditions.push(lte(learnedPatterns.createdAt, new Date(params.endDate)));
    }
    if (params.search) {
      conditions.push(
        or(
          like(learnedPatterns.name, `%${params.search}%`),
          like(learnedPatterns.description, `%${params.search}%`)
        )
      );
    }

    const query = db
      .select()
      .from(learnedPatterns)
      .orderBy(desc(learnedPatterns.createdAt))
      .limit(MAX_LIMIT);

    const results = conditions.length > 0
      ? await query.where(and(...conditions))
      : await query;

    return results.map((pattern): UnifiedTimelineEvent => {
      const statusColor: TimelineStatusColor = pattern.isActive ? 'yellow' : 'gray';

      return {
        id: `pattern-${pattern.id}`,
        entityType: 'learned_pattern',
        entityId: pattern.id,
        timestamp: pattern.createdAt?.toISOString() ?? new Date().toISOString(),
        title: pattern.name,
        description: pattern.description,
        icon: 'pattern',
        status: pattern.isActive ? 'active' : 'inactive',
        statusColor,
        metadata: {
          confidence: pattern.confidence,
          successRate: pattern.successRate ?? undefined,
        },
        relatedEntities: pattern.sourceIncidentId
          ? [
              {
                type: 'incident',
                id: pattern.sourceIncidentId,
                label: 'Source Incident',
              },
            ]
          : undefined,
      };
    });
  }

  /**
   * Fetch remediation action events
   */
  private async fetchActionEvents(params: UnifiedTimelineParams): Promise<UnifiedTimelineEvent[]> {
    const db = getDatabase();

    const conditions = [];

    if (params.startDate) {
      conditions.push(gte(actions.createdAt, new Date(params.startDate)));
    }
    if (params.endDate) {
      conditions.push(lte(actions.createdAt, new Date(params.endDate)));
    }
    if (params.search) {
      conditions.push(like(actions.target, `%${params.search}%`));
    }

    const query = db
      .select()
      .from(actions)
      .orderBy(desc(actions.createdAt))
      .limit(MAX_LIMIT);

    const results = conditions.length > 0
      ? await query.where(and(...conditions))
      : await query;

    return results.map((action): UnifiedTimelineEvent => {
      const durationMs = action.completedAt && action.executedAt
        ? new Date(action.completedAt).getTime() - new Date(action.executedAt).getTime()
        : undefined;

      return {
        id: `action-${action.id}`,
        entityType: 'action',
        entityId: action.id,
        timestamp: action.createdAt?.toISOString() ?? new Date().toISOString(),
        title: `${action.type.toUpperCase()}: ${action.target}`,
        description: action.dryRun ? 'Dry run' : `Status: ${action.status}`,
        icon: 'action',
        status: action.status,
        statusColor: getActionStatusColor(action.status),
        metadata: {
          actionType: action.type as 'rollback' | 'restart' | 'scale' | 'code_fix' | 'manual',
          target: action.target,
          dryRun: action.dryRun ? true : false,
        },
        durationMs,
        relatedEntities: [
          {
            type: 'incident',
            id: action.incidentId,
            label: 'Parent Incident',
          },
        ],
      };
    });
  }

  /**
   * Fetch reconstruction events
   */
  private async fetchReconstructionEvents(params: UnifiedTimelineParams): Promise<UnifiedTimelineEvent[]> {
    const db = getDatabase();

    const conditions = [];

    if (params.startDate) {
      conditions.push(gte(reconstructedIncidents.createdAt, new Date(params.startDate)));
    }
    if (params.endDate) {
      conditions.push(lte(reconstructedIncidents.createdAt, new Date(params.endDate)));
    }

    const query = db
      .select()
      .from(reconstructedIncidents)
      .orderBy(desc(reconstructedIncidents.createdAt))
      .limit(MAX_LIMIT);

    const results = conditions.length > 0
      ? await query.where(and(...conditions))
      : await query;

    return results.map((reconstruction): UnifiedTimelineEvent => {
      // Parse the root cause for a summary (it's stored as text in the schema)
      const incidentIdDisplay = reconstruction.incidentId 
        ? reconstruction.incidentId.substring(0, 8) 
        : 'standalone';
      
      return {
        id: `reconstruction-${reconstruction.id}`,
        entityType: 'reconstruction',
        entityId: reconstruction.id,
        timestamp: reconstruction.createdAt?.toISOString() ?? new Date().toISOString(),
        title: `Incident Reconstruction: ${incidentIdDisplay}...`,
        description: reconstruction.rootCause?.substring(0, 200) ?? 'Reconstructed from 1M token context',
        icon: 'reconstruction',
        status: 'completed',
        statusColor: 'cyan',
        metadata: {
          tokensUsed: reconstruction.inputTokensUsed,
        },
        relatedEntities: reconstruction.incidentId ? [
          {
            type: 'incident',
            id: reconstruction.incidentId,
            label: 'Reconstructed Incident',
          },
        ] : [],
      };
    });
  }

  /**
   * Get statistics about timeline events
   */
  async getTimelineStats(): Promise<{
    totalEvents: number;
    byEntityType: Record<TimelineEntityType, number>;
    recentActivity: {
      last24Hours: number;
      last7Days: number;
      last30Days: number;
    };
  }> {
    const db = getDatabase();

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Count events by type
    const [
      incidentCount,
      developmentCount,
      evolutionCount,
      patternCount,
      actionCount,
      reconstructionCount,
    ] = await Promise.all([
      db.select().from(incidents).then(r => r.length),
      db.select().from(developmentCycles).then(r => r.length),
      db.select().from(codeEvolutions).then(r => r.length),
      db.select().from(learnedPatterns).then(r => r.length),
      db.select().from(actions).then(r => r.length),
      db.select().from(reconstructedIncidents).then(r => r.length),
    ]);

    const byEntityType: Record<TimelineEntityType, number> = {
      incident: incidentCount,
      development_cycle: developmentCount,
      code_evolution: evolutionCount,
      learned_pattern: patternCount,
      action: actionCount,
      reconstruction: reconstructionCount,
    };

    const totalEvents = Object.values(byEntityType).reduce((a, b) => a + b, 0);

    // Count recent activity (simplified - using incidents as primary metric)
    const [last24, last7, last30] = await Promise.all([
      db.select().from(incidents).where(gte(incidents.createdAt, oneDayAgo)).then(r => r.length),
      db.select().from(incidents).where(gte(incidents.createdAt, sevenDaysAgo)).then(r => r.length),
      db.select().from(incidents).where(gte(incidents.createdAt, thirtyDaysAgo)).then(r => r.length),
    ]);

    return {
      totalEvents,
      byEntityType,
      recentActivity: {
        last24Hours: last24,
        last7Days: last7,
        last30Days: last30,
      },
    };
  }
}

// Singleton export
export const timelineAggregator = new TimelineAggregator();

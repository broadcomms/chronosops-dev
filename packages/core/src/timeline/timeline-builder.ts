/**
 * Timeline Builder
 * Builds and manages investigation timelines for tracking, visualization, and postmortems
 */

import { EventEmitter } from 'events';
import { createChildLogger, type Evidence, type Hypothesis } from '@chronosops/shared';
import type { OODAState } from '@chronosops/shared';
import type { ActionResult } from '../agents/executor/types.js';
import type { Correlation } from '../correlation/types.js';
import type { VerificationResult } from '../verification/types.js';
import {
  DEFAULT_TIMELINE_CONFIG,
  type Timeline,
  type TimelineEvent,
  type TimelineEventType,
  type TimelineEventSeverity,
  type TimelineSummary,
  type TimelineFilter,
  type PhaseSpan,
  type TimelineBuilderConfig,
  type CreateEventOptions,
  type PostmortemTimeline,
} from './types.js';

export class TimelineBuilder extends EventEmitter {
  private logger = createChildLogger({ component: 'TimelineBuilder' });
  private config: TimelineBuilderConfig;
  private timeline: Timeline | null = null;
  private currentPhase: OODAState = 'IDLE';
  private phaseStartTime: Date | null = null;

  constructor(config: Partial<TimelineBuilderConfig> = {}) {
    super();
    this.config = { ...DEFAULT_TIMELINE_CONFIG, ...config };
  }

  /**
   * Initialize a new timeline for an incident
   */
  initialize(incidentId: string): Timeline {
    const now = new Date();
    this.timeline = {
      id: `tl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      incidentId,
      createdAt: now,
      updatedAt: now,
      events: [],
      phases: [],
      summary: this.createEmptySummary(),
      causalChain: [],
      keyDecisions: [],
    };

    this.currentPhase = 'IDLE';
    this.phaseStartTime = now;

    // Add initial event
    this.addEvent('incident_created', {
      title: 'Incident Created',
      description: `Investigation timeline initialized for incident ${incidentId}`,
      severity: 'info',
    });

    this.logger.info({ incidentId, timelineId: this.timeline.id }, 'Timeline initialized');

    return this.timeline;
  }

  /**
   * Get the current timeline
   */
  getTimeline(): Timeline | null {
    return this.timeline;
  }

  /**
   * Add an event to the timeline
   */
  addEvent(type: TimelineEventType, options: CreateEventOptions): TimelineEvent {
    if (!this.timeline) {
      throw new Error('Timeline not initialized. Call initialize() first.');
    }

    const event: TimelineEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      type,
      title: options.title,
      description: options.description,
      severity: options.severity ?? this.inferSeverity(type),
      phase: this.currentPhase,
      incidentId: this.timeline.incidentId,
      evidenceIds: options.evidenceIds,
      hypothesisIds: options.hypothesisIds,
      actionId: options.actionId,
      correlationId: options.correlationId,
      data: options.data ?? {},
      icon: this.getEventIcon(type),
      color: this.getEventColor(options.severity ?? 'info'),
    };

    this.timeline.events.push(event);
    this.timeline.updatedAt = new Date();

    // Check for milestones
    this.checkMilestone(event);

    // Auto-summarize if threshold reached
    if (this.config.autoSummarize && this.timeline.events.length >= this.config.summarizeThreshold) {
      this.updateSummary();
    }

    // Update summary counts
    this.incrementSummaryCount(type);

    this.emit('eventAdded', event);
    this.logger.debug({ eventId: event.id, type, phase: this.currentPhase }, 'Event added to timeline');

    return event;
  }

  /**
   * Record a phase transition
   */
  transitionPhase(newPhase: OODAState, summary: string = ''): PhaseSpan | null {
    if (!this.timeline) return null;

    const now = new Date();

    // Close out current phase
    if (this.phaseStartTime) {
      const phaseSpan: PhaseSpan = {
        phase: this.currentPhase,
        startTime: this.phaseStartTime,
        endTime: now,
        durationMs: now.getTime() - this.phaseStartTime.getTime(),
        eventCount: this.timeline.events.filter(e => e.phase === this.currentPhase).length,
        summary: summary || `Completed ${this.currentPhase} phase`,
        keyFindings: this.getPhaseKeyFindings(this.currentPhase),
      };
      this.timeline.phases.push(phaseSpan);
      this.emit('phaseChanged', phaseSpan);
    }

    // Start new phase
    const previousPhase = this.currentPhase;
    this.currentPhase = newPhase;
    this.phaseStartTime = now;

    // Add phase transition event
    this.addEvent('phase_transition', {
      title: `Transitioned to ${newPhase}`,
      description: `Investigation moved from ${previousPhase} to ${newPhase}`,
      severity: 'info',
      data: { previousPhase, newPhase },
    });

    this.logger.info({ previousPhase, newPhase }, 'Phase transition recorded');

    return this.timeline.phases[this.timeline.phases.length - 1] ?? null;
  }

  /**
   * Record evidence collection
   */
  recordEvidence(evidence: Evidence): TimelineEvent {
    // Extract summary from content if available
    const content = evidence.content as Record<string, unknown>;
    const summary = typeof content.description === 'string'
      ? content.description
      : `Collected ${evidence.type} evidence from ${evidence.source}`;

    return this.addEvent('evidence_collected', {
      title: `Evidence: ${evidence.type}`,
      description: summary,
      severity: 'medium',
      evidenceIds: [evidence.id],
      data: {
        type: evidence.type,
        source: evidence.source,
        confidence: evidence.confidence,
      },
    });
  }

  /**
   * Record correlation found
   */
  recordCorrelation(correlation: Correlation): TimelineEvent {
    return this.addEvent('correlation_found', {
      title: `Correlation: ${correlation.type}`,
      description: correlation.description,
      severity: correlation.confidence > 0.8 ? 'high' : 'medium',
      correlationId: correlation.id,
      data: {
        type: correlation.type,
        confidence: correlation.confidence,
        signalCount: correlation.signals.length,
        reasoning: correlation.reasoning,
      },
    });
  }

  /**
   * Record hypothesis generation
   */
  recordHypothesis(hypothesis: Hypothesis, reasoning?: string): TimelineEvent {
    return this.addEvent('hypothesis_generated', {
      title: `Hypothesis: ${hypothesis.title}`,
      description: hypothesis.description,
      severity: hypothesis.confidence > 0.8 ? 'high' : 'medium',
      hypothesisIds: [hypothesis.id],
      data: {
        confidence: hypothesis.confidence,
        status: hypothesis.status,
        reasoning: reasoning ?? hypothesis.reasoning,
        evidence: hypothesis.evidence,
      },
    });
  }

  /**
   * Record hypothesis status update
   */
  recordHypothesisUpdate(
    hypothesisId: string,
    title: string,
    newStatus: 'proposed' | 'testing' | 'confirmed' | 'rejected',
    confidence: number,
    reason: string
  ): TimelineEvent {
    return this.addEvent('hypothesis_updated', {
      title: `Hypothesis ${newStatus}: ${title}`,
      description: reason,
      severity: newStatus === 'confirmed' ? 'high' : 'medium',
      hypothesisIds: [hypothesisId],
      data: { status: newStatus, confidence, reason },
    });
  }

  /**
   * Record action execution
   */
  recordAction(action: ActionResult): TimelineEvent {
    const actionId = `act-${action.timestamp.getTime()}`;
    return this.addEvent('action_executed', {
      title: `Action: ${action.action.type}`,
      description: action.message,
      severity: action.success ? 'medium' : 'high',
      actionId,
      data: {
        actionType: action.action.type,
        target: action.action.target,
        success: action.success,
        executionMode: action.mode,
        durationMs: action.durationMs,
      },
    });
  }

  /**
   * Record verification result
   */
  recordVerification(verification: VerificationResult): TimelineEvent {
    return this.addEvent('action_verified', {
      title: `Verification: ${verification.verdict}`,
      description: verification.summary,
      severity: verification.success ? 'medium' : 'high',
      actionId: verification.actionId,
      data: {
        verdict: verification.verdict,
        confidence: verification.confidence,
        checksPassed: verification.checks.filter(c => c.status === 'passed').length,
        totalChecks: verification.checks.length,
        shouldRetry: verification.shouldRetry,
      },
    });
  }

  /**
   * Record insight discovery
   */
  recordInsight(insight: string, context?: Record<string, unknown>): TimelineEvent {
    return this.addEvent('insight_discovered', {
      title: 'Insight Discovered',
      description: insight,
      severity: 'medium',
      data: { insight, ...context },
    });
  }

  /**
   * Record escalation
   */
  recordEscalation(reason: string, fromLevel: string, toLevel: string): TimelineEvent {
    return this.addEvent('escalation', {
      title: `Escalation: ${fromLevel} → ${toLevel}`,
      description: reason,
      severity: 'high',
      data: { fromLevel, toLevel, reason },
    });
  }

  /**
   * Record key decision
   */
  recordDecision(decision: string, reasoning: string, outcome: string): void {
    if (!this.timeline) return;

    this.timeline.keyDecisions.push({
      timestamp: new Date(),
      decision,
      reasoning,
      outcome,
    });
  }

  /**
   * Mark investigation as complete
   */
  complete(resolution: string, rootCause?: string): TimelineEvent {
    // Close out current phase
    if (this.phaseStartTime) {
      this.transitionPhase('DONE', resolution);
    }

    // Update summary
    this.updateSummary();

    return this.addEvent('investigation_completed', {
      title: 'Investigation Completed',
      description: resolution,
      severity: 'info',
      data: {
        resolution,
        rootCause,
        totalDuration: this.timeline?.summary.duration.totalMs,
      },
    });
  }

  /**
   * Filter timeline events
   */
  filter(filter: TimelineFilter): TimelineEvent[] {
    if (!this.timeline) return [];

    return this.timeline.events.filter(event => {
      if (filter.types && !filter.types.includes(event.type)) return false;
      if (filter.phases && !filter.phases.includes(event.phase)) return false;
      if (filter.severity && !filter.severity.includes(event.severity)) return false;
      if (filter.startTime && event.timestamp < filter.startTime) return false;
      if (filter.endTime && event.timestamp > filter.endTime) return false;
      if (filter.search) {
        const searchLower = filter.search.toLowerCase();
        if (!event.title.toLowerCase().includes(searchLower) &&
            !event.description.toLowerCase().includes(searchLower)) {
          return false;
        }
      }
      return true;
    });
  }

  /**
   * Get summary of timeline
   */
  getSummary(): TimelineSummary | null {
    if (!this.timeline) return null;
    this.updateSummary();
    return this.timeline.summary;
  }

  /**
   * Build postmortem timeline
   */
  buildPostmortemTimeline(): PostmortemTimeline | null {
    if (!this.timeline || this.timeline.events.length === 0) return null;

    const events = this.timeline.events;
    const incidentCreated = events.find(e => e.type === 'incident_created');
    const investigationStarted = events.find(e => e.type === 'investigation_started' || e.type === 'phase_transition');
    const investigationCompleted = events.find(e => e.type === 'investigation_completed');
    const firstAction = events.find(e => e.type === 'action_executed');

    const incidentStart = incidentCreated?.timestamp ?? events[0]?.timestamp ?? new Date();
    const detectionTime = incidentStart;
    const investigationStart = investigationStarted?.timestamp ?? incidentStart;
    const resolutionTime = investigationCompleted?.timestamp;

    // Build action timeline
    const actionEvents = events.filter(e => e.type === 'action_executed');
    const actions = actionEvents.map(e => ({
      timestamp: e.timestamp,
      action: e.title,
      result: (e.data.success ? 'success' : 'failure') as 'success' | 'failure' | 'partial',
      impact: e.description,
    }));

    // Build root cause chain from correlations and confirmed hypotheses
    const correlations = events.filter(e => e.type === 'correlation_found');
    const confirmedHypotheses = events.filter(
      e => e.type === 'hypothesis_updated' && e.data.status === 'confirmed'
    );
    const rootCauseChain = [
      ...correlations.map(e => e.description),
      ...confirmedHypotheses.map(e => e.title),
    ].slice(0, 5);

    // Extract lessons learned from insights
    const insights = events.filter(e => e.type === 'insight_discovered');
    const lessonsLearned = insights.map(e => e.description);

    // Generate recommendations
    const recommendations = this.generateRecommendations();

    return {
      incidentStart,
      detectionTime,
      investigationStart,
      rootCauseIdentified: confirmedHypotheses[0]?.timestamp,
      remediationStart: firstAction?.timestamp,
      resolutionTime,
      timeToDetect: 0, // Immediate in this system
      timeToResolve: resolutionTime
        ? resolutionTime.getTime() - incidentStart.getTime()
        : undefined,
      totalDuration: (resolutionTime ?? new Date()).getTime() - incidentStart.getTime(),
      phases: this.timeline.phases.map(p => ({
        name: p.phase,
        start: p.startTime,
        end: p.endTime ?? new Date(),
        duration: p.durationMs ?? 0,
        summary: p.summary,
      })),
      actions,
      rootCauseChain,
      lessonsLearned,
      recommendations,
    };
  }

  /**
   * Export timeline to markdown
   */
  toMarkdown(): string {
    if (!this.timeline) return '';

    const lines: string[] = [
      `# Investigation Timeline`,
      ``,
      `**Incident ID:** ${this.timeline.incidentId}`,
      `**Started:** ${this.timeline.createdAt.toISOString()}`,
      `**Duration:** ${this.timeline.summary.duration.formatted}`,
      ``,
      `## Summary`,
      `- Events: ${this.timeline.summary.totalEvents}`,
      `- Evidence Collected: ${this.timeline.summary.evidenceCollected}`,
      `- Hypotheses Generated: ${this.timeline.summary.hypothesesGenerated}`,
      `- Actions Taken: ${this.timeline.summary.actionsTaken}`,
      `- Correlations Found: ${this.timeline.summary.correlationsFound}`,
      ``,
      `## Phases`,
    ];

    for (const phase of this.timeline.phases) {
      lines.push(`### ${phase.phase}`);
      lines.push(`- Duration: ${this.formatDuration(phase.durationMs ?? 0)}`);
      lines.push(`- Events: ${phase.eventCount}`);
      lines.push(`- Summary: ${phase.summary}`);
      if (phase.keyFindings.length > 0) {
        lines.push(`- Key Findings:`);
        for (const finding of phase.keyFindings) {
          lines.push(`  - ${finding}`);
        }
      }
      lines.push('');
    }

    lines.push(`## Event Timeline`);
    lines.push('');

    for (const event of this.timeline.events) {
      lines.push(`### ${event.timestamp.toISOString()} - ${event.title}`);
      lines.push(`**Type:** ${event.type} | **Phase:** ${event.phase} | **Severity:** ${event.severity}`);
      lines.push(`${event.description}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Export timeline to JSON
   */
  toJSON(): string {
    if (!this.timeline) return '{}';
    return JSON.stringify(this.timeline, null, 2);
  }

  /**
   * Reset the timeline
   */
  reset(): void {
    this.timeline = null;
    this.currentPhase = 'IDLE';
    this.phaseStartTime = null;
  }

  // Private helper methods

  private createEmptySummary(): TimelineSummary {
    return {
      totalEvents: 0,
      duration: { totalMs: 0, formatted: '0s' },
      phases: [],
      currentPhase: 'IDLE',
      keyMilestones: [],
      actionsTaken: 0,
      hypothesesGenerated: 0,
      evidenceCollected: 0,
      correlationsFound: 0,
    };
  }

  private updateSummary(): void {
    if (!this.timeline) return;

    const events = this.timeline.events;
    const now = new Date();
    const totalMs = now.getTime() - this.timeline.createdAt.getTime();

    this.timeline.summary = {
      totalEvents: events.length,
      duration: {
        totalMs,
        formatted: this.formatDuration(totalMs),
      },
      phases: this.timeline.phases,
      currentPhase: this.currentPhase,
      keyMilestones: this.identifyMilestones(events),
      actionsTaken: events.filter(e => e.type === 'action_executed').length,
      hypothesesGenerated: events.filter(e => e.type === 'hypothesis_generated').length,
      evidenceCollected: events.filter(e => e.type === 'evidence_collected').length,
      correlationsFound: events.filter(e => e.type === 'correlation_found').length,
    };
  }

  private incrementSummaryCount(type: TimelineEventType): void {
    if (!this.timeline) return;

    this.timeline.summary.totalEvents++;

    switch (type) {
      case 'action_executed':
        this.timeline.summary.actionsTaken++;
        break;
      case 'hypothesis_generated':
        this.timeline.summary.hypothesesGenerated++;
        break;
      case 'evidence_collected':
        this.timeline.summary.evidenceCollected++;
        break;
      case 'correlation_found':
        this.timeline.summary.correlationsFound++;
        break;
    }
  }

  private identifyMilestones(events: TimelineEvent[]): Array<{ event: TimelineEvent; significance: string }> {
    const milestones: Array<{ event: TimelineEvent; significance: string }> = [];

    for (const event of events) {
      let significance: string | null = null;

      switch (event.type) {
        case 'incident_created':
          significance = 'Investigation started';
          break;
        case 'hypothesis_updated':
          if (event.data.status === 'confirmed') {
            significance = 'Root cause identified';
          }
          break;
        case 'action_executed':
          if (event.data.success) {
            significance = 'Remediation action taken';
          }
          break;
        case 'action_verified':
          if (event.data.verdict === 'confirmed_success') {
            significance = 'Fix verified successful';
          }
          break;
        case 'investigation_completed':
          significance = 'Investigation resolved';
          break;
      }

      if (significance) {
        milestones.push({ event, significance });
      }
    }

    return milestones;
  }

  private checkMilestone(event: TimelineEvent): void {
    const milestoneTypes: TimelineEventType[] = [
      'incident_created',
      'investigation_completed',
      'action_verified',
    ];

    if (milestoneTypes.includes(event.type) ||
        (event.type === 'hypothesis_updated' && event.data.status === 'confirmed')) {
      const significance = this.getMilestoneSignificance(event);
      this.emit('milestoneReached', event, significance);
    }
  }

  private getMilestoneSignificance(event: TimelineEvent): string {
    switch (event.type) {
      case 'incident_created': return 'Investigation started';
      case 'investigation_completed': return 'Investigation resolved';
      case 'action_verified': return event.data.verdict === 'confirmed_success' ? 'Fix confirmed' : 'Action verified';
      case 'hypothesis_updated': return event.data.status === 'confirmed' ? 'Root cause identified' : 'Hypothesis updated';
      default: return 'Milestone reached';
    }
  }

  private getPhaseKeyFindings(phase: OODAState): string[] {
    if (!this.timeline) return [];

    const phaseEvents = this.timeline.events.filter(e => e.phase === phase);
    const findings: string[] = [];

    // Get correlations
    const correlations = phaseEvents.filter(e => e.type === 'correlation_found');
    if (correlations.length > 0) {
      findings.push(`Found ${correlations.length} correlation(s)`);
    }

    // Get confirmed hypotheses
    const confirmed = phaseEvents.filter(
      e => e.type === 'hypothesis_updated' && e.data.status === 'confirmed'
    );
    for (const h of confirmed) {
      findings.push(`Confirmed: ${h.title}`);
    }

    // Get successful actions
    const successfulActions = phaseEvents.filter(
      e => e.type === 'action_executed' && e.data.success
    );
    for (const a of successfulActions) {
      findings.push(`Executed: ${a.title}`);
    }

    return findings.slice(0, 5);
  }

  private generateRecommendations(): string[] {
    if (!this.timeline) return [];

    const recommendations: string[] = [];
    const events = this.timeline.events;

    // Check for failed actions
    const failedActions = events.filter(e => e.type === 'action_executed' && !e.data.success);
    if (failedActions.length > 0) {
      recommendations.push('Review action safety guards and pre-conditions');
    }

    // Check for rejected hypotheses
    const rejected = events.filter(e => e.type === 'hypothesis_updated' && e.data.status === 'rejected');
    if (rejected.length > 2) {
      recommendations.push('Improve initial hypothesis quality through better evidence collection');
    }

    // Check for escalations
    const escalations = events.filter(e => e.type === 'escalation');
    if (escalations.length > 0) {
      recommendations.push('Consider increasing default thinking budget for complex incidents');
    }

    // Check investigation duration
    if (this.timeline.summary.duration.totalMs > 300000) { // > 5 minutes
      recommendations.push('Investigate ways to speed up evidence collection');
    }

    // Default recommendation
    if (recommendations.length === 0) {
      recommendations.push('Continue monitoring for similar incidents');
    }

    return recommendations;
  }

  private inferSeverity(type: TimelineEventType): TimelineEventSeverity {
    switch (type) {
      case 'incident_created':
      case 'investigation_started':
      case 'phase_transition':
        return 'info';
      case 'evidence_collected':
      case 'insight_discovered':
        return 'low';
      case 'correlation_found':
      case 'hypothesis_generated':
      case 'hypothesis_updated':
      case 'action_proposed':
        return 'medium';
      case 'action_executed':
      case 'action_verified':
      case 'escalation':
        return 'high';
      case 'investigation_completed':
      case 'postmortem_generated':
        return 'info';
      default:
        return 'info';
    }
  }

  private getEventIcon(type: TimelineEventType): string {
    const icons: Record<TimelineEventType, string> = {
      incident_created: '🚨',
      investigation_started: '🔍',
      phase_transition: '➡️',
      evidence_collected: '📋',
      correlation_found: '🔗',
      hypothesis_generated: '💡',
      hypothesis_updated: '📝',
      action_proposed: '📌',
      action_executed: '⚡',
      action_verified: '✅',
      insight_discovered: '💫',
      escalation: '⬆️',
      investigation_completed: '🏁',
      postmortem_generated: '📄',
    };
    return icons[type] ?? '•';
  }

  private getEventColor(severity: TimelineEventSeverity): string {
    const colors: Record<TimelineEventSeverity, string> = {
      info: '#3b82f6',
      low: '#22c55e',
      medium: '#eab308',
      high: '#f97316',
      critical: '#ef4444',
    };
    return colors[severity];
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
  }
}

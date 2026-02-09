/**
 * Event Stream
 * Captures and correlates deployment events and infrastructure changes
 */

import { randomUUID } from 'crypto';
import { createChildLogger } from '@chronosops/shared';
import type {
  InfraEvent,
  InfraEventType,
  GitCommit,
  Deploy,
  K8sEvent,
  EventTimeline,
  EventStreamConfig,
} from './types.js';

const DEFAULT_CONFIG: EventStreamConfig = {
  maxEventAge: 3600000,           // 1 hour
  correlationWindowMs: 300000,    // 5 minutes before incident
};

// K8s event reason to event type mapping
const K8S_REASON_MAP: Record<string, InfraEventType> = {
  // Deployment related
  ScalingReplicaSet: 'deploy',
  SuccessfulCreate: 'deploy',
  Scheduled: 'deploy',
  Pulling: 'deploy',
  Pulled: 'deploy',
  Created: 'deploy',
  Started: 'deploy',

  // Scale related
  ScaledUp: 'scale',
  ScaledDown: 'scale',

  // Restart related
  Killing: 'restart',
  Restarting: 'restart',

  // Rollback related
  RollbackInProgress: 'rollback',
  RollbackComplete: 'rollback',

  // Crash/OOM related
  BackOff: 'pod_crash',
  Failed: 'pod_crash',
  OOMKilling: 'oom_kill',
  OOMKilled: 'oom_kill',

  // Config changes
  ConfigMapUpdated: 'config_change',
  SecretUpdated: 'config_change',
};

export class EventStream {
  private config: EventStreamConfig;
  private logger = createChildLogger({ component: 'EventStream' });

  constructor(config: Partial<EventStreamConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Ingest Git events (commits, deploys) into infrastructure events
   */
  ingestGitEvents(commits: GitCommit[], deploys: Deploy[]): InfraEvent[] {
    const events: InfraEvent[] = [];

    // Convert commits to events
    for (const commit of commits) {
      events.push({
        id: randomUUID(),
        type: 'git_push',
        timestamp: commit.timestamp,
        description: `Git commit: ${commit.message.substring(0, 100)}`,
        actor: commit.author,
        target: `git:${commit.sha.substring(0, 7)}`,
        metadata: {
          sha: commit.sha,
          message: commit.message,
          files: commit.files,
        },
        severity: 'info',
      });
    }

    // Convert deploys to events
    for (const deploy of deploys) {
      const severity = deploy.status === 'failed' ? 'critical' : 'info';

      events.push({
        id: randomUUID(),
        type: 'deploy',
        timestamp: deploy.timestamp,
        description: `Deployment ${deploy.deployment} revision ${deploy.revision}: ${deploy.status}`,
        actor: deploy.triggeredBy,
        target: `${deploy.namespace}/${deploy.deployment}`,
        metadata: {
          revision: deploy.revision,
          image: deploy.image,
          status: deploy.status,
          namespace: deploy.namespace,
          deployment: deploy.deployment,
        },
        severity,
      });
    }

    this.logger.debug({
      commitCount: commits.length,
      deployCount: deploys.length,
      eventCount: events.length,
    }, 'Ingested Git events');

    return events;
  }

  /**
   * Parse Kubernetes events from kubectl get events output
   */
  parseKubernetesEvents(kubectlOutput: string): K8sEvent[] {
    const lines = kubectlOutput.split('\n');
    const events: K8sEvent[] = [];

    // Skip header line if present
    const startIndex = lines[0]?.includes('LAST SEEN') ? 1 : 0;

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i]?.trim();
      if (!line) continue;

      // Parse line - format varies by kubectl version
      // Common format: LAST SEEN   TYPE      REASON    OBJECT          MESSAGE
      const parsed = this.parseKubernetesEventLine(line);
      if (parsed) {
        events.push(parsed);
      }
    }

    this.logger.debug({
      lineCount: lines.length,
      eventCount: events.length,
    }, 'Parsed Kubernetes events');

    return events;
  }

  /**
   * Parse a single Kubernetes event line
   */
  private parseKubernetesEventLine(line: string): K8sEvent | null {
    // Try JSON format first (kubectl get events -o json)
    if (line.startsWith('{')) {
      try {
        const obj = JSON.parse(line) as {
          metadata?: { uid?: string };
          type?: string;
          reason?: string;
          message?: string;
          involvedObject?: {
            kind?: string;
            name?: string;
            namespace?: string;
          };
          firstTimestamp?: string;
          lastTimestamp?: string;
          count?: number;
          source?: { component?: string; host?: string };
        };

        return {
          uid: obj.metadata?.uid ?? randomUUID(),
          type: (obj.type as 'Normal' | 'Warning') ?? 'Normal',
          reason: obj.reason ?? '',
          message: obj.message ?? '',
          involvedObject: {
            kind: obj.involvedObject?.kind ?? 'Unknown',
            name: obj.involvedObject?.name ?? 'unknown',
            namespace: obj.involvedObject?.namespace ?? 'default',
          },
          firstTimestamp: new Date(obj.firstTimestamp ?? Date.now()),
          lastTimestamp: new Date(obj.lastTimestamp ?? Date.now()),
          count: obj.count ?? 1,
          source: {
            component: obj.source?.component ?? 'unknown',
            host: obj.source?.host,
          },
        };
      } catch {
        // Not valid JSON, try text format
      }
    }

    // Text format parsing (kubectl get events)
    // Common patterns:
    // 1. Short format: Normal  Scheduled  pod/nginx  Successfully assigned...
    // 2. Wide format: 5m  Normal  Scheduled  Pod  nginx-abc  Successfully assigned...

    const parts = line.split(/\s+/);
    if (parts.length < 4) {
      return null;
    }

    // Try to identify format by looking for event types
    const typeIndex = parts.findIndex((p) => p === 'Normal' || p === 'Warning');
    if (typeIndex < 0) {
      return null;
    }

    const type = parts[typeIndex] as 'Normal' | 'Warning';
    const reason = parts[typeIndex + 1] ?? 'Unknown';
    const objectPart = parts[typeIndex + 2] ?? '';

    // Parse object (format: kind/name or just name)
    let kind = 'Pod';
    let name = objectPart;
    if (objectPart.includes('/')) {
      [kind, name] = objectPart.split('/') as [string, string];
    }

    // Rest is the message
    const message = parts.slice(typeIndex + 3).join(' ');

    return {
      uid: randomUUID(),
      type,
      reason,
      message,
      involvedObject: {
        kind,
        name,
        namespace: 'default',
      },
      firstTimestamp: new Date(),
      lastTimestamp: new Date(),
      count: 1,
      source: {
        component: 'kubectl',
      },
    };
  }

  /**
   * Convert K8s events to infrastructure events
   */
  convertK8sEvents(k8sEvents: K8sEvent[]): InfraEvent[] {
    const events: InfraEvent[] = [];

    for (const k8sEvent of k8sEvents) {
      const eventType = this.mapK8sEventType(k8sEvent.reason);
      const severity = this.mapK8sEventSeverity(k8sEvent);

      events.push({
        id: k8sEvent.uid,
        type: eventType,
        timestamp: k8sEvent.lastTimestamp,
        description: k8sEvent.message,
        actor: k8sEvent.source.component,
        target: `${k8sEvent.involvedObject.kind}/${k8sEvent.involvedObject.name}`,
        metadata: {
          k8sReason: k8sEvent.reason,
          k8sType: k8sEvent.type,
          namespace: k8sEvent.involvedObject.namespace,
          count: k8sEvent.count,
          firstTimestamp: k8sEvent.firstTimestamp.toISOString(),
        },
        severity,
      });
    }

    return events;
  }

  /**
   * Map K8s event reason to infrastructure event type
   */
  private mapK8sEventType(reason: string): InfraEventType {
    return K8S_REASON_MAP[reason] ?? 'k8s_event';
  }

  /**
   * Map K8s event to severity
   */
  private mapK8sEventSeverity(event: K8sEvent): 'info' | 'warning' | 'critical' {
    // Critical events
    if (event.type === 'Warning') {
      const criticalReasons = ['OOMKilling', 'OOMKilled', 'Failed', 'BackOff', 'Unhealthy'];
      if (criticalReasons.includes(event.reason)) {
        return 'critical';
      }
      return 'warning';
    }

    return 'info';
  }

  /**
   * Build unified event timeline
   */
  buildEventTimeline(
    events: InfraEvent[],
    startTime: Date,
    endTime: Date
  ): EventTimeline {
    const now = Date.now();
    const maxAge = now - this.config.maxEventAge;

    // Filter and sort events
    const filteredEvents = events
      .filter((e) => {
        const eventTime = e.timestamp.getTime();
        return (
          eventTime >= startTime.getTime() &&
          eventTime <= endTime.getTime() &&
          eventTime >= maxAge
        );
      })
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // Extract deployments
    const deployments: Deploy[] = filteredEvents
      .filter((e) => e.type === 'deploy')
      .map((e) => ({
        id: e.id,
        revision: (e.metadata.revision as number) ?? 0,
        image: (e.metadata.image as string) ?? '',
        timestamp: e.timestamp,
        triggeredBy: e.actor,
        status: (e.metadata.status as Deploy['status']) ?? 'completed',
        namespace: (e.metadata.namespace as string) ?? 'default',
        deployment: (e.metadata.deployment as string) ?? e.target.split('/')[1] ?? 'unknown',
      }));

    // Calculate summary
    const summary = {
      totalEvents: filteredEvents.length,
      deployCount: deployments.length,
      warningCount: filteredEvents.filter((e) => e.severity === 'warning').length,
      criticalCount: filteredEvents.filter((e) => e.severity === 'critical').length,
    };

    return {
      events: filteredEvents,
      deployments,
      startTime,
      endTime,
      summary,
    };
  }

  /**
   * Find the most recent deployment before an incident
   */
  findPrecedingDeployment(events: InfraEvent[], incidentTime: Date): Deploy | null {
    const deployEvents = events
      .filter(
        (e) =>
          e.type === 'deploy' &&
          e.timestamp.getTime() < incidentTime.getTime()
      )
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const lastDeploy = deployEvents[0];
    if (!lastDeploy) {
      return null;
    }

    return {
      id: lastDeploy.id,
      revision: (lastDeploy.metadata.revision as number) ?? 0,
      image: (lastDeploy.metadata.image as string) ?? '',
      timestamp: lastDeploy.timestamp,
      triggeredBy: lastDeploy.actor,
      status: (lastDeploy.metadata.status as Deploy['status']) ?? 'completed',
      namespace: (lastDeploy.metadata.namespace as string) ?? 'default',
      deployment:
        (lastDeploy.metadata.deployment as string) ??
        lastDeploy.target.split('/')[1] ??
        'unknown',
    };
  }

  /**
   * Find events that correlate with an incident time
   */
  findCorrelatedEvents(
    events: InfraEvent[],
    incidentTime: Date,
    windowMs?: number
  ): InfraEvent[] {
    const window = windowMs ?? this.config.correlationWindowMs;
    const incidentMs = incidentTime.getTime();
    const windowStart = incidentMs - window;
    const windowEnd = incidentMs + (window / 4); // Slightly after incident too

    return events
      .filter((e) => {
        const eventMs = e.timestamp.getTime();
        return eventMs >= windowStart && eventMs <= windowEnd;
      })
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /**
   * Analyze events for potential incident triggers
   */
  findPotentialTriggers(
    events: InfraEvent[],
    incidentTime: Date
  ): Array<{ event: InfraEvent; triggerScore: number; reasoning: string }> {
    const correlatedEvents = this.findCorrelatedEvents(events, incidentTime);
    const triggers: Array<{
      event: InfraEvent;
      triggerScore: number;
      reasoning: string;
    }> = [];

    for (const event of correlatedEvents) {
      let score = 0;
      const reasons: string[] = [];

      // Deployments are high-likelihood triggers
      if (event.type === 'deploy') {
        score += 0.4;
        reasons.push('Recent deployment');
      }

      // Config changes
      if (event.type === 'config_change') {
        score += 0.3;
        reasons.push('Configuration change');
      }

      // Scale events
      if (event.type === 'scale') {
        score += 0.2;
        reasons.push('Scaling event');
      }

      // Pod crashes
      if (event.type === 'pod_crash' || event.type === 'oom_kill') {
        score += 0.3;
        reasons.push('Pod instability');
      }

      // Warning/Critical events
      if (event.severity === 'critical') {
        score += 0.2;
        reasons.push('Critical severity');
      } else if (event.severity === 'warning') {
        score += 0.1;
        reasons.push('Warning severity');
      }

      // Time proximity bonus (closer to incident = higher score)
      const timeDelta = Math.abs(
        event.timestamp.getTime() - incidentTime.getTime()
      );
      const proximityBonus = Math.max(0, 0.2 * (1 - timeDelta / this.config.correlationWindowMs));
      score += proximityBonus;
      if (proximityBonus > 0.1) {
        reasons.push('Very close to incident time');
      }

      if (score > 0.2) {
        triggers.push({
          event,
          triggerScore: Math.min(score, 1),
          reasoning: reasons.join('; '),
        });
      }
    }

    // Sort by score descending
    triggers.sort((a, b) => b.triggerScore - a.triggerScore);

    this.logger.debug({
      correlatedCount: correlatedEvents.length,
      triggerCount: triggers.length,
    }, 'Analyzed potential triggers');

    return triggers;
  }
}

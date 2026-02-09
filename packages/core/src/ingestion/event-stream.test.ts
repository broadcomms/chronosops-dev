/**
 * EventStream Tests
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EventStream } from './event-stream.js';
import type { GitCommit, Deploy, InfraEvent, K8sEvent } from './types.js';

describe('EventStream', () => {
  let eventStream: EventStream;

  beforeEach(() => {
    eventStream = new EventStream();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('ingestGitEvents()', () => {
    it('should convert git commits to infrastructure events', () => {
      const commits: GitCommit[] = [
        {
          sha: 'abc1234567890',
          message: 'Fix memory leak in user service',
          author: 'developer@example.com',
          timestamp: new Date('2024-01-15T11:30:00Z'),
          files: ['src/users/service.ts'],
        },
      ];

      const events = eventStream.ingestGitEvents(commits, []);

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('git_push');
      expect(events[0]!.actor).toBe('developer@example.com');
      expect(events[0]!.target).toBe('git:abc1234');
      expect(events[0]!.description).toContain('Fix memory leak');
      expect(events[0]!.severity).toBe('info');
    });

    it('should convert deployments to infrastructure events', () => {
      const deploys: Deploy[] = [
        {
          id: 'deploy-1',
          revision: 123,
          image: 'app:v1.2.3',
          timestamp: new Date('2024-01-15T11:35:00Z'),
          triggeredBy: 'ci/cd',
          status: 'completed',
          namespace: 'production',
          deployment: 'api-server',
        },
      ];

      const events = eventStream.ingestGitEvents([], deploys);

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('deploy');
      expect(events[0]!.target).toBe('production/api-server');
      expect(events[0]!.severity).toBe('info');
    });

    it('should mark failed deploys as critical', () => {
      const deploys: Deploy[] = [
        {
          id: 'deploy-1',
          revision: 123,
          image: 'app:v1.2.3',
          timestamp: new Date('2024-01-15T11:35:00Z'),
          triggeredBy: 'ci/cd',
          status: 'failed',
          namespace: 'production',
          deployment: 'api-server',
        },
      ];

      const events = eventStream.ingestGitEvents([], deploys);

      expect(events[0]!.severity).toBe('critical');
    });

    it('should handle both commits and deploys', () => {
      const commits: GitCommit[] = [
        {
          sha: 'abc123',
          message: 'Update',
          author: 'dev@example.com',
          timestamp: new Date(),
          files: [],
        },
      ];
      const deploys: Deploy[] = [
        {
          id: 'deploy-1',
          revision: 1,
          image: 'app:v1',
          timestamp: new Date(),
          triggeredBy: 'ci',
          status: 'completed',
          namespace: 'default',
          deployment: 'app',
        },
      ];

      const events = eventStream.ingestGitEvents(commits, deploys);

      expect(events).toHaveLength(2);
    });
  });

  describe('parseKubernetesEvents()', () => {
    it('should parse JSON format K8s events', () => {
      const jsonOutput = JSON.stringify({
        metadata: { uid: 'event-123' },
        type: 'Warning',
        reason: 'OOMKilled',
        message: 'Container exceeded memory limit',
        involvedObject: {
          kind: 'Pod',
          name: 'api-server-abc',
          namespace: 'production',
        },
        firstTimestamp: '2024-01-15T11:30:00Z',
        lastTimestamp: '2024-01-15T11:30:05Z',
        count: 1,
        source: { component: 'kubelet' },
      });

      const events = eventStream.parseKubernetesEvents(jsonOutput);

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('Warning');
      expect(events[0]!.reason).toBe('OOMKilled');
      expect(events[0]!.involvedObject.name).toBe('api-server-abc');
    });

    it('should parse text format K8s events', () => {
      const textOutput = `LAST SEEN   TYPE      REASON    OBJECT          MESSAGE
5m          Normal    Scheduled Pod/nginx-abc   Successfully assigned default/nginx-abc to node1
2m          Warning   BackOff   Pod/api-123     Back-off restarting failed container`;

      const events = eventStream.parseKubernetesEvents(textOutput);

      expect(events).toHaveLength(2);
      expect(events[0]!.type).toBe('Normal');
      expect(events[0]!.reason).toBe('Scheduled');
      expect(events[1]!.type).toBe('Warning');
      expect(events[1]!.reason).toBe('BackOff');
    });

    it('should skip invalid lines', () => {
      const output = `Valid Normal Scheduled Pod/nginx Test message
Invalid line without proper format
Another Normal Created Pod/api Test`;

      const events = eventStream.parseKubernetesEvents(output);

      expect(events.length).toBe(2);
    });

    it('should handle empty output', () => {
      const events = eventStream.parseKubernetesEvents('');
      expect(events).toHaveLength(0);
    });
  });

  describe('convertK8sEvents()', () => {
    it('should convert K8s events to infrastructure events', () => {
      const k8sEvents: K8sEvent[] = [
        {
          uid: 'event-1',
          type: 'Normal',
          reason: 'ScaledUp',
          message: 'Scaled up replica set',
          involvedObject: { kind: 'Deployment', name: 'api', namespace: 'prod' },
          firstTimestamp: new Date(),
          lastTimestamp: new Date(),
          count: 1,
          source: { component: 'deployment-controller' },
        },
      ];

      const events = eventStream.convertK8sEvents(k8sEvents);

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('scale');
      expect(events[0]!.severity).toBe('info');
    });

    it('should map OOMKilled to critical severity', () => {
      const k8sEvents: K8sEvent[] = [
        {
          uid: 'event-1',
          type: 'Warning',
          reason: 'OOMKilled',
          message: 'Container killed',
          involvedObject: { kind: 'Pod', name: 'api', namespace: 'prod' },
          firstTimestamp: new Date(),
          lastTimestamp: new Date(),
          count: 1,
          source: { component: 'kubelet' },
        },
      ];

      const events = eventStream.convertK8sEvents(k8sEvents);

      expect(events[0]!.type).toBe('oom_kill');
      expect(events[0]!.severity).toBe('critical');
    });

    it('should map BackOff to pod_crash type', () => {
      const k8sEvents: K8sEvent[] = [
        {
          uid: 'event-1',
          type: 'Warning',
          reason: 'BackOff',
          message: 'Back-off restarting failed container',
          involvedObject: { kind: 'Pod', name: 'api', namespace: 'prod' },
          firstTimestamp: new Date(),
          lastTimestamp: new Date(),
          count: 5,
          source: { component: 'kubelet' },
        },
      ];

      const events = eventStream.convertK8sEvents(k8sEvents);

      expect(events[0]!.type).toBe('pod_crash');
      expect(events[0]!.severity).toBe('critical');
    });

    it('should handle unknown event reasons', () => {
      const k8sEvents: K8sEvent[] = [
        {
          uid: 'event-1',
          type: 'Normal',
          reason: 'UnknownReason',
          message: 'Something happened',
          involvedObject: { kind: 'Pod', name: 'api', namespace: 'prod' },
          firstTimestamp: new Date(),
          lastTimestamp: new Date(),
          count: 1,
          source: { component: 'controller' },
        },
      ];

      const events = eventStream.convertK8sEvents(k8sEvents);

      expect(events[0]!.type).toBe('k8s_event');
    });
  });

  describe('buildEventTimeline()', () => {
    it('should build timeline from events', () => {
      const events: InfraEvent[] = [
        {
          id: '1',
          type: 'deploy',
          timestamp: new Date('2024-01-15T11:30:00Z'),
          description: 'Deploy v1',
          actor: 'ci',
          target: 'prod/api',
          metadata: { revision: 1, status: 'completed', namespace: 'prod', deployment: 'api' },
          severity: 'info',
        },
        {
          id: '2',
          type: 'scale',
          timestamp: new Date('2024-01-15T11:35:00Z'),
          description: 'Scale up',
          actor: 'hpa',
          target: 'prod/api',
          metadata: {},
          severity: 'info',
        },
      ];

      const timeline = eventStream.buildEventTimeline(
        events,
        new Date('2024-01-15T11:00:00Z'),
        new Date('2024-01-15T12:00:00Z')
      );

      expect(timeline.events).toHaveLength(2);
      expect(timeline.deployments).toHaveLength(1);
      expect(timeline.summary.totalEvents).toBe(2);
      expect(timeline.summary.deployCount).toBe(1);
    });

    it('should filter events outside time range', () => {
      const events: InfraEvent[] = [
        {
          id: '1',
          type: 'deploy',
          timestamp: new Date('2024-01-15T10:00:00Z'), // Before range
          description: 'Old deploy',
          actor: 'ci',
          target: 'prod/api',
          metadata: {},
          severity: 'info',
        },
        {
          id: '2',
          type: 'deploy',
          timestamp: new Date('2024-01-15T11:30:00Z'), // In range
          description: 'Current deploy',
          actor: 'ci',
          target: 'prod/api',
          metadata: {},
          severity: 'info',
        },
      ];

      const timeline = eventStream.buildEventTimeline(
        events,
        new Date('2024-01-15T11:00:00Z'),
        new Date('2024-01-15T12:00:00Z')
      );

      expect(timeline.events).toHaveLength(1);
    });

    it('should count warnings and critical events', () => {
      const events: InfraEvent[] = [
        { id: '1', type: 'k8s_event', timestamp: new Date('2024-01-15T11:30:00Z'), description: 'Normal', actor: 'k8s', target: 'pod', metadata: {}, severity: 'info' },
        { id: '2', type: 'k8s_event', timestamp: new Date('2024-01-15T11:31:00Z'), description: 'Warning', actor: 'k8s', target: 'pod', metadata: {}, severity: 'warning' },
        { id: '3', type: 'oom_kill', timestamp: new Date('2024-01-15T11:32:00Z'), description: 'OOM', actor: 'k8s', target: 'pod', metadata: {}, severity: 'critical' },
      ];

      const timeline = eventStream.buildEventTimeline(
        events,
        new Date('2024-01-15T11:00:00Z'),
        new Date('2024-01-15T12:00:00Z')
      );

      expect(timeline.summary.warningCount).toBe(1);
      expect(timeline.summary.criticalCount).toBe(1);
    });
  });

  describe('findPrecedingDeployment()', () => {
    it('should find the most recent deployment before incident', () => {
      const events: InfraEvent[] = [
        {
          id: '1',
          type: 'deploy',
          timestamp: new Date('2024-01-15T10:00:00Z'),
          description: 'Deploy v1',
          actor: 'ci',
          target: 'prod/api',
          metadata: { revision: 1, image: 'app:v1', status: 'completed', namespace: 'prod', deployment: 'api' },
          severity: 'info',
        },
        {
          id: '2',
          type: 'deploy',
          timestamp: new Date('2024-01-15T11:00:00Z'),
          description: 'Deploy v2',
          actor: 'ci',
          target: 'prod/api',
          metadata: { revision: 2, image: 'app:v2', status: 'completed', namespace: 'prod', deployment: 'api' },
          severity: 'info',
        },
      ];

      const incidentTime = new Date('2024-01-15T11:30:00Z');
      const deploy = eventStream.findPrecedingDeployment(events, incidentTime);

      expect(deploy).not.toBeNull();
      expect(deploy!.revision).toBe(2);
    });

    it('should return null when no preceding deployment', () => {
      const events: InfraEvent[] = [
        {
          id: '1',
          type: 'scale',
          timestamp: new Date('2024-01-15T10:00:00Z'),
          description: 'Scale',
          actor: 'hpa',
          target: 'prod/api',
          metadata: {},
          severity: 'info',
        },
      ];

      const deploy = eventStream.findPrecedingDeployment(events, new Date());

      expect(deploy).toBeNull();
    });

    it('should ignore deployments after incident time', () => {
      const events: InfraEvent[] = [
        {
          id: '1',
          type: 'deploy',
          timestamp: new Date('2024-01-15T12:30:00Z'), // After incident
          description: 'Deploy',
          actor: 'ci',
          target: 'prod/api',
          metadata: { revision: 1 },
          severity: 'info',
        },
      ];

      const incidentTime = new Date('2024-01-15T11:30:00Z');
      const deploy = eventStream.findPrecedingDeployment(events, incidentTime);

      expect(deploy).toBeNull();
    });
  });

  describe('findCorrelatedEvents()', () => {
    it('should find events within correlation window', () => {
      const events: InfraEvent[] = [
        { id: '1', type: 'deploy', timestamp: new Date('2024-01-15T11:00:00Z'), description: 'Old', actor: 'ci', target: 'api', metadata: {}, severity: 'info' },
        { id: '2', type: 'deploy', timestamp: new Date('2024-01-15T11:58:00Z'), description: 'Recent', actor: 'ci', target: 'api', metadata: {}, severity: 'info' },
        { id: '3', type: 'scale', timestamp: new Date('2024-01-15T12:00:30Z'), description: 'After', actor: 'hpa', target: 'api', metadata: {}, severity: 'info' },
        { id: '4', type: 'deploy', timestamp: new Date('2024-01-15T12:30:00Z'), description: 'Too late', actor: 'ci', target: 'api', metadata: {}, severity: 'info' },
      ];

      const incidentTime = new Date('2024-01-15T12:00:00Z');
      const correlated = eventStream.findCorrelatedEvents(events, incidentTime);

      expect(correlated).toHaveLength(2); // Recent deploy and slightly after event
      expect(correlated.some(e => e.id === '2')).toBe(true);
      expect(correlated.some(e => e.id === '3')).toBe(true);
    });

    it('should accept custom correlation window', () => {
      const events: InfraEvent[] = [
        { id: '1', type: 'deploy', timestamp: new Date('2024-01-15T11:59:00Z'), description: 'Deploy', actor: 'ci', target: 'api', metadata: {}, severity: 'info' },
      ];

      const incidentTime = new Date('2024-01-15T12:00:00Z');

      // With 30 second window, event at 11:59:00 should be out of range
      const correlated = eventStream.findCorrelatedEvents(events, incidentTime, 30000);

      expect(correlated).toHaveLength(0);
    });
  });

  describe('findPotentialTriggers()', () => {
    it('should identify deployments as high-score triggers', () => {
      const events: InfraEvent[] = [
        {
          id: '1',
          type: 'deploy',
          timestamp: new Date('2024-01-15T11:58:00Z'),
          description: 'Deploy v2',
          actor: 'ci',
          target: 'prod/api',
          metadata: {},
          severity: 'info',
        },
      ];

      const incidentTime = new Date('2024-01-15T12:00:00Z');
      const triggers = eventStream.findPotentialTriggers(events, incidentTime);

      expect(triggers).toHaveLength(1);
      expect(triggers[0]!.triggerScore).toBeGreaterThan(0.4);
      expect(triggers[0]!.reasoning).toContain('Recent deployment');
    });

    it('should identify OOM kills as triggers', () => {
      const events: InfraEvent[] = [
        {
          id: '1',
          type: 'oom_kill',
          timestamp: new Date('2024-01-15T11:59:00Z'),
          description: 'OOM Kill',
          actor: 'kubelet',
          target: 'pod/api',
          metadata: {},
          severity: 'critical',
        },
      ];

      const incidentTime = new Date('2024-01-15T12:00:00Z');
      const triggers = eventStream.findPotentialTriggers(events, incidentTime);

      expect(triggers).toHaveLength(1);
      expect(triggers[0]!.reasoning).toContain('Pod instability');
      expect(triggers[0]!.reasoning).toContain('Critical severity');
    });

    it('should give higher scores to events closer to incident time', () => {
      const events: InfraEvent[] = [
        {
          id: '1',
          type: 'config_change',
          timestamp: new Date('2024-01-15T11:55:00Z'), // 5 min before
          description: 'Config change 1',
          actor: 'admin',
          target: 'configmap',
          metadata: {},
          severity: 'info',
        },
        {
          id: '2',
          type: 'config_change',
          timestamp: new Date('2024-01-15T11:59:30Z'), // 30 sec before
          description: 'Config change 2',
          actor: 'admin',
          target: 'configmap',
          metadata: {},
          severity: 'info',
        },
      ];

      const incidentTime = new Date('2024-01-15T12:00:00Z');
      const triggers = eventStream.findPotentialTriggers(events, incidentTime);

      // Closer event should have higher score
      expect(triggers[0]!.event.id).toBe('2');
      expect(triggers[0]!.triggerScore).toBeGreaterThan(triggers[1]!.triggerScore);
    });

    it('should filter out low-score events', () => {
      const events: InfraEvent[] = [
        {
          id: '1',
          type: 'k8s_event',
          timestamp: new Date('2024-01-15T11:30:00Z'), // Far from incident
          description: 'Normal event',
          actor: 'k8s',
          target: 'pod',
          metadata: {},
          severity: 'info',
        },
      ];

      const incidentTime = new Date('2024-01-15T12:00:00Z');
      const triggers = eventStream.findPotentialTriggers(events, incidentTime);

      expect(triggers).toHaveLength(0);
    });

    it('should sort triggers by score descending', () => {
      const events: InfraEvent[] = [
        { id: '1', type: 'scale', timestamp: new Date('2024-01-15T11:58:00Z'), description: 'Scale', actor: 'hpa', target: 'api', metadata: {}, severity: 'info' },
        { id: '2', type: 'deploy', timestamp: new Date('2024-01-15T11:58:00Z'), description: 'Deploy', actor: 'ci', target: 'api', metadata: {}, severity: 'info' },
        { id: '3', type: 'oom_kill', timestamp: new Date('2024-01-15T11:59:00Z'), description: 'OOM', actor: 'kubelet', target: 'pod', metadata: {}, severity: 'critical' },
      ];

      const incidentTime = new Date('2024-01-15T12:00:00Z');
      const triggers = eventStream.findPotentialTriggers(events, incidentTime);

      // Verify sorted by score descending
      for (let i = 0; i < triggers.length - 1; i++) {
        expect(triggers[i]!.triggerScore).toBeGreaterThanOrEqual(triggers[i + 1]!.triggerScore);
      }
    });
  });
});

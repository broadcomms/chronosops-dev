/**
 * IncidentReconstructor Tests
 * Tests for incident reconstruction using 1M context window
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IncidentReconstructor } from './incident-reconstructor.js';
import type { RawIncidentData } from './types.js';

// Mock the database repository
vi.mock('@chronosops/database', () => ({
  reconstructedIncidentRepository: {
    create: vi.fn().mockImplementation((data) => Promise.resolve({
      id: `rec-${Date.now()}`,
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    getById: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
  },
}));

// Create mock GeminiClient with reconstructIncident method
// Response must match IncidentReconstructionGeminiResponse interface
const createMockGeminiClient = () => ({
  reconstructIncident: vi.fn().mockResolvedValue({
    success: true,
    data: {
      timeline: [
        {
          timestamp: new Date('2024-01-15T11:30:00Z').toISOString(),
          event: 'Deployment started',
          service: 'api',
          severity: 'info',
          evidence: 'Kubernetes deployment event',
          isKeyEvent: true,
        },
        {
          timestamp: new Date('2024-01-15T11:31:00Z').toISOString(),
          event: 'Error rate increased',
          service: 'api',
          severity: 'warning',
          evidence: 'Prometheus metrics spike',
          isKeyEvent: true,
        },
      ],
      causalChain: [
        {
          id: 'cause-1',
          event: 'New deployment triggered OOMKilled',
          causedBy: null,
          causedEvents: ['cause-2'],
          relationship: 'direct',
        },
        {
          id: 'cause-2',
          event: 'Memory exhaustion',
          causedBy: 'cause-1',
          causedEvents: [],
          relationship: 'cascading',
        },
      ],
      rootCause: {
        description: 'Memory leak in deployment',
        confidence: 0.9,
        evidence: ['Deployment event', 'OOMKilled'],
        differentFromSymptoms: 'Root cause is memory leak, not just high memory usage',
      },
      recommendations: [
        {
          priority: 'high',
          category: 'prevention',
          action: 'Set memory limits',
          rationale: 'Prevent OOM conditions',
          implementation: 'Update deployment spec with resource limits',
        },
      ],
      narrative: 'A deployment caused memory exhaustion leading to pod restarts.',
      dataQuality: {
        completeness: 0.85,
        gaps: ['Missing detailed memory metrics'],
        recommendations: ['Add memory profiling'],
      },
    },
  }),
});

describe('IncidentReconstructor', () => {
  let reconstructor: IncidentReconstructor;
  let mockGeminiClient: ReturnType<typeof createMockGeminiClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGeminiClient = createMockGeminiClient();
    reconstructor = new IncidentReconstructor(mockGeminiClient as unknown as Parameters<typeof IncidentReconstructor>[0]);
  });

  describe('reconstruct()', () => {
    it('should reconstruct incident from raw data', async () => {
      const rawData: RawIncidentData = {
        incidentId: 'incident-123',
        timeRange: {
          start: new Date('2024-01-15T11:00:00Z'),
          end: new Date('2024-01-15T12:00:00Z'),
        },
        logs: [
          {
            timestamp: new Date('2024-01-15T11:30:00Z'),
            level: 'error',
            service: 'api',
            message: 'Connection refused',
          },
        ],
      };

      const result = await reconstructor.reconstruct(rawData);

      expect(result.id).toBeDefined();
      expect(result.timeline.length).toBeGreaterThan(0);
      expect(result.causalChain.length).toBeGreaterThan(0);
      expect(result.rootCause).toBeDefined();
    });

    it('should emit reconstruction:started event', async () => {
      const startedHandler = vi.fn();
      reconstructor.on('reconstruction:started', startedHandler);

      const rawData: RawIncidentData = {
        incidentId: 'incident-456',
        timeRange: {
          start: new Date('2024-01-15T11:00:00Z'),
          end: new Date('2024-01-15T12:00:00Z'),
        },
        events: [
          {
            timestamp: new Date('2024-01-15T11:30:00Z'),
            type: 'Warning',
            reason: 'OOMKilled',
            object: 'pod/api',
            message: 'Container killed',
            namespace: 'prod',
          },
        ],
      };

      await reconstructor.reconstruct(rawData);

      expect(startedHandler).toHaveBeenCalled();
    });

    it('should emit reconstruction:completed event', async () => {
      const completedHandler = vi.fn();
      reconstructor.on('reconstruction:completed', completedHandler);

      const rawData: RawIncidentData = {
        incidentId: 'incident-789',
        timeRange: {
          start: new Date('2024-01-15T11:00:00Z'),
          end: new Date('2024-01-15T12:00:00Z'),
        },
        metrics: [
          {
            timestamp: new Date('2024-01-15T11:30:00Z'),
            metric: 'error_rate',
            value: 5.0,
            labels: { service: 'api' },
          },
        ],
      };

      await reconstructor.reconstruct(rawData);

      expect(completedHandler).toHaveBeenCalled();
    });

    it('should process logs correctly', async () => {
      const rawData: RawIncidentData = {
        incidentId: 'log-test',
        timeRange: {
          start: new Date('2024-01-15T11:00:00Z'),
          end: new Date('2024-01-15T12:00:00Z'),
        },
        logs: [
          { timestamp: new Date(), level: 'error', service: 'api', message: 'Error 1' },
          { timestamp: new Date(), level: 'warn', service: 'api', message: 'Warning' },
        ],
      };

      const result = await reconstructor.reconstruct(rawData);

      expect(result).toBeDefined();
      expect(mockGeminiClient.reconstructIncident).toHaveBeenCalled();
    });

    it('should process Kubernetes events correctly', async () => {
      const rawData: RawIncidentData = {
        incidentId: 'event-test',
        timeRange: {
          start: new Date('2024-01-15T11:00:00Z'),
          end: new Date('2024-01-15T12:00:00Z'),
        },
        events: [
          {
            timestamp: new Date(),
            type: 'Warning',
            reason: 'OOMKilled',
            object: 'pod/api-abc',
            message: 'Container killed',
            namespace: 'production',
          },
        ],
      };

      const result = await reconstructor.reconstruct(rawData);

      expect(result).toBeDefined();
    });

    it('should include additional context', async () => {
      const rawData: RawIncidentData = {
        incidentId: 'context-test',
        timeRange: {
          start: new Date('2024-01-15T11:00:00Z'),
          end: new Date('2024-01-15T12:00:00Z'),
        },
        logs: [
          { timestamp: new Date(), level: 'info', service: 'api', message: 'Test' },
        ],
        additionalContext: 'Recent deployment of version 2.3.1',
      };

      await reconstructor.reconstruct(rawData);

      // Additional context is included in the logs parameter, not as a separate field
      const callArgs = mockGeminiClient.reconstructIncident.mock.calls[0]?.[0];
      expect(callArgs?.logs).toContain('2.3.1');
    });

    it('should handle API errors gracefully', async () => {
      mockGeminiClient.reconstructIncident.mockRejectedValue(new Error('API error'));

      const rawData: RawIncidentData = {
        incidentId: 'error-test',
        timeRange: {
          start: new Date('2024-01-15T11:00:00Z'),
          end: new Date('2024-01-15T12:00:00Z'),
        },
        logs: [
          { timestamp: new Date(), level: 'error', service: 'api', message: 'Test' },
        ],
      };

      await expect(reconstructor.reconstruct(rawData)).rejects.toThrow();
    });

    it('should require at least one data source', async () => {
      const rawData: RawIncidentData = {
        incidentId: 'empty-test',
        timeRange: {
          start: new Date('2024-01-15T11:00:00Z'),
          end: new Date('2024-01-15T12:00:00Z'),
        },
        // No logs, metrics, or events
      };

      await expect(reconstructor.reconstruct(rawData)).rejects.toThrow();
    });
  });

  describe('timeline generation', () => {
    it('should include timestamps in timeline', async () => {
      const rawData: RawIncidentData = {
        incidentId: 'timeline-test',
        timeRange: {
          start: new Date('2024-01-15T11:00:00Z'),
          end: new Date('2024-01-15T12:00:00Z'),
        },
        logs: [
          { timestamp: new Date(), level: 'error', service: 'api', message: 'Test' },
        ],
      };

      const result = await reconstructor.reconstruct(rawData);

      result.timeline.forEach(entry => {
        expect(entry.timestamp).toBeDefined();
      });
    });
  });

  describe('causal chain', () => {
    it('should include confidence scores', async () => {
      const rawData: RawIncidentData = {
        incidentId: 'causal-test',
        timeRange: {
          start: new Date('2024-01-15T11:00:00Z'),
          end: new Date('2024-01-15T12:00:00Z'),
        },
        logs: [
          { timestamp: new Date(), level: 'error', service: 'api', message: 'Test' },
        ],
      };

      const result = await reconstructor.reconstruct(rawData);

      result.causalChain.forEach(link => {
        expect(link.confidence).toBeGreaterThanOrEqual(0);
        expect(link.confidence).toBeLessThanOrEqual(1);
      });
    });
  });
});

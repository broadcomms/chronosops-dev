/**
 * PatternLearner Tests
 * Tests for pattern extraction using Gemini
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PatternLearner } from './pattern-learner.js';
import type { IncidentForLearning } from './types.js';

// Create mock GeminiClient with learnPattern method
const createMockGeminiClient = () => ({
  learnPattern: vi.fn().mockResolvedValue({
    success: true,
    data: {
      patterns: [
        {
          type: 'diagnostic',
          name: 'Memory Leak Detection',
          description: 'Detects memory leaks in containers',
          triggerConditions: ['high memory usage', 'OOMKilled'],
          recommendedActions: ['restart pod', 'investigate memory'],
          confidence: 0.85,
          applicability: 'kubernetes environments',
          exceptions: ['during scheduled maintenance'],
        },
        {
          type: 'resolution',
          name: 'Restart Resolution',
          description: 'Resolves issues via restart',
          triggerConditions: ['stale connections'],
          recommendedActions: ['restart deployment'],
          confidence: 0.9,
          applicability: 'stateless services',
          exceptions: [],
        },
      ],
    },
  }),
});

describe('PatternLearner', () => {
  let patternLearner: PatternLearner;
  let mockGeminiClient: ReturnType<typeof createMockGeminiClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGeminiClient = createMockGeminiClient();
    patternLearner = new PatternLearner(mockGeminiClient as unknown as Parameters<typeof PatternLearner>[0]);
  });

  describe('extractPatterns()', () => {
    it('should extract patterns from incident data', async () => {
      const incident: IncidentForLearning = {
        id: 'incident-123',
        title: 'Memory leak in demo-app',
        severity: 'high',
        rootCause: 'Memory leak in connection handler',
        resolution: 'Restarted deployment',
      };

      const result = await patternLearner.extractPatterns(incident);

      expect(result.patterns.length).toBeGreaterThan(0);
      expect(result.metadata.incidentId).toBe('incident-123');
      expect(mockGeminiClient.learnPattern).toHaveBeenCalled();
    });

    it('should emit extraction:started event', async () => {
      const startedHandler = vi.fn();
      patternLearner.on('extraction:started', startedHandler);

      const incident: IncidentForLearning = {
        id: 'incident-456',
        title: 'Test incident',
        severity: 'medium',
      };

      await patternLearner.extractPatterns(incident);

      expect(startedHandler).toHaveBeenCalledWith({ incidentId: 'incident-456' });
    });

    it('should emit extraction:completed event with result', async () => {
      const completedHandler = vi.fn();
      patternLearner.on('extraction:completed', completedHandler);

      const incident: IncidentForLearning = {
        id: 'incident-789',
        title: 'Test incident',
        severity: 'low',
      };

      await patternLearner.extractPatterns(incident);

      expect(completedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          result: expect.objectContaining({
            metadata: expect.objectContaining({
              incidentId: 'incident-789',
            }),
          }),
        })
      );
    });

    it('should emit pattern:created events for each pattern', async () => {
      const patternHandler = vi.fn();
      patternLearner.on('pattern:created', patternHandler);

      const incident: IncidentForLearning = {
        id: 'incident-events',
        title: 'Test',
        severity: 'high',
      };

      await patternLearner.extractPatterns(incident);

      expect(patternHandler).toHaveBeenCalled();
    });

    it('should handle incidents with minimal data', async () => {
      const incident: IncidentForLearning = {
        id: 'minimal-incident',
        title: 'Simple issue',
        severity: 'low',
      };

      const result = await patternLearner.extractPatterns(incident);

      expect(result.metadata.incidentId).toBe('minimal-incident');
      expect(result.patterns).toBeDefined();
    });

    it('should include source incident ID in patterns', async () => {
      const incident: IncidentForLearning = {
        id: 'source-incident',
        title: 'Source test',
        severity: 'high',
      };

      const result = await patternLearner.extractPatterns(incident);

      result.patterns.forEach(pattern => {
        expect(pattern.sourceIncidentId).toBe('source-incident');
      });
    });

    it('should handle API errors', async () => {
      mockGeminiClient.learnPattern.mockRejectedValue(new Error('API error'));

      const incident: IncidentForLearning = {
        id: 'error-incident',
        title: 'Error test',
        severity: 'medium',
      };

      await expect(patternLearner.extractPatterns(incident)).rejects.toThrow('API error');
    });

    it('should emit extraction:failed event on error', async () => {
      const failedHandler = vi.fn();
      patternLearner.on('extraction:failed', failedHandler);

      mockGeminiClient.learnPattern.mockRejectedValue(new Error('API error'));

      const incident: IncidentForLearning = {
        id: 'failed-incident',
        title: 'Fail test',
        severity: 'high',
      };

      try {
        await patternLearner.extractPatterns(incident);
      } catch {
        // Expected
      }

      expect(failedHandler).toHaveBeenCalledWith({
        incidentId: 'failed-incident',
        error: 'API error',
      });
    });

    it('should handle empty API response', async () => {
      mockGeminiClient.learnPattern.mockResolvedValue({
        success: true,
        data: { patterns: [] },
      });

      const incident: IncidentForLearning = {
        id: 'empty-incident',
        title: 'Empty test',
        severity: 'low',
      };

      const result = await patternLearner.extractPatterns(incident);

      expect(result.patterns).toHaveLength(0);
    });

    it('should process incident with actions taken', async () => {
      const incident: IncidentForLearning = {
        id: 'actions-incident',
        title: 'Actions test',
        severity: 'high',
        actionsTaken: [
          { type: 'restart', target: 'api-service', success: true },
          { type: 'scale', target: 'worker', success: false },
        ],
      };

      const result = await patternLearner.extractPatterns(incident);

      expect(result.patterns).toBeDefined();
      expect(mockGeminiClient.learnPattern).toHaveBeenCalled();
    });
  });

  describe('extractPatternsFromBatch()', () => {
    it('should process multiple incidents', async () => {
      const incidents: IncidentForLearning[] = [
        { id: 'batch-1', title: 'Incident 1', severity: 'high' },
        { id: 'batch-2', title: 'Incident 2', severity: 'medium' },
      ];

      const results = await patternLearner.extractPatternsFromBatch(incidents);

      expect(results.length).toBe(2);
      expect(mockGeminiClient.learnPattern).toHaveBeenCalledTimes(2);
    });

    it('should continue processing if one incident fails', async () => {
      mockGeminiClient.learnPattern
        .mockRejectedValueOnce(new Error('Failed'))
        .mockResolvedValueOnce({
          success: true,
          data: { patterns: [] },
        });

      const incidents: IncidentForLearning[] = [
        { id: 'fail-batch', title: 'Fail', severity: 'high' },
        { id: 'success-batch', title: 'Success', severity: 'low' },
      ];

      const results = await patternLearner.extractPatternsFromBatch(incidents);

      // Only successful one should be in results
      expect(results.length).toBe(1);
    });
  });
});

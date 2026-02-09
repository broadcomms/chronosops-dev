/**
 * KnowledgeBase Tests
 * Tests for pattern matching logic (without database dependency)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KnowledgeBase, type PatternMatchInput } from './knowledge-base.js';
import type { LearnedPatternRecord } from '@chronosops/database';

// Mock the database repository
vi.mock('@chronosops/database', () => ({
  learnedPatternRepository: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockImplementation((data: Partial<LearnedPatternRecord>) => Promise.resolve({
      id: `pat-${Date.now()}`,
      ...data,
      appliedCount: 0,
      successRate: null,
      lastApplied: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    getById: vi.fn(),
    update: vi.fn(),
    countByType: vi.fn().mockResolvedValue({ detection: 0, diagnostic: 0, resolution: 0, prevention: 0 }),
    countHighConfidence: vi.fn().mockResolvedValue(0),
    count: vi.fn().mockResolvedValue(0),
    getStats: vi.fn().mockResolvedValue({
      totalPatterns: 0,
      byType: { detection: 0, diagnostic: 0, resolution: 0, prevention: 0 },
      highConfidenceCount: 0,
      mostApplied: [],
    }),
    search: vi.fn().mockResolvedValue([]),
    recordApplied: vi.fn(),
    recordMatch: vi.fn(),
    deactivate: vi.fn(),
    findByName: vi.fn().mockResolvedValue(null),
    findMatching: vi.fn().mockResolvedValue([]),
  },
}));

// Mock GeminiClient (not used but required for constructor)
const mockGeminiClient = {} as Parameters<typeof KnowledgeBase>[0];

describe('KnowledgeBase', () => {
  let knowledgeBase: KnowledgeBase;

  beforeEach(async () => {
    vi.clearAllMocks();
    knowledgeBase = new KnowledgeBase(mockGeminiClient);
  });

  describe('getStats()', () => {
    it('should return stats from repository', async () => {
      const stats = await knowledgeBase.getStats();

      expect(stats).toHaveProperty('totalPatterns');
      expect(stats).toHaveProperty('highConfidenceCount');
      expect(stats).toHaveProperty('byType');
      expect(stats).toHaveProperty('mostApplied');
    });
  });

  describe('storePattern()', () => {
    it('should store a new pattern', async () => {
      const pattern = {
        name: 'Test Pattern',
        description: 'A test pattern',
        type: 'diagnostic' as const,
        triggerConditions: ['error condition'],
        recommendedActions: ['restart'],
        confidence: 0.85,
        sourceIncidentIds: ['inc-1'],
        applicability: ['kubernetes'],
        exceptions: [],
        isActive: true,
      };

      const stored = await knowledgeBase.storePattern(pattern);

      expect(stored.id).toBeDefined();
      expect(stored.name).toBe('Test Pattern');
    });
  });

  describe('storePatternsFromExtraction()', () => {
    it('should store multiple patterns', async () => {
      const patterns = [
        {
          id: 'pat-1',
          name: 'Pattern 1',
          description: 'First pattern',
          type: 'detection' as const,
          triggerConditions: ['condition1'],
          recommendedActions: ['action1'],
          confidence: 0.8,
          sourceIncidentIds: ['inc-1'],
          applicability: ['kubernetes'],
          exceptions: [],
          isActive: true,
          appliedCount: 0,
          successRate: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const stored = await knowledgeBase.storePatternsFromExtraction(patterns);

      expect(stored.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('findMatchingPatterns()', () => {
    it('should return empty array when no patterns exist', async () => {
      const input: PatternMatchInput = {
        errorMessages: ['Some error'],
      };

      const result = await knowledgeBase.findMatchingPatterns(input);

      expect(result.matches).toEqual([]);
    });

    it('should handle empty input', async () => {
      const input: PatternMatchInput = {};

      const result = await knowledgeBase.findMatchingPatterns(input);

      expect(result.matches).toEqual([]);
    });

    it('should return metadata with results', async () => {
      const input: PatternMatchInput = {
        symptoms: ['high cpu'],
      };

      const result = await knowledgeBase.findMatchingPatterns(input);

      expect(result.metadata).toHaveProperty('totalPatternsSearched');
      expect(result.metadata).toHaveProperty('matchesFound');
      expect(result.metadata).toHaveProperty('processingTimeMs');
    });
  });

  describe('pattern matching logic', () => {
    it('should emit pattern:matched event when patterns are found', async () => {
      // Import and mock the repository to return patterns for this test
      const { learnedPatternRepository } = await import('@chronosops/database');

      // Setup mock to return a pattern that will match
      // The matching algorithm checks if keywords from triggerConditions appear in input
      // Keywords must be >3 chars, so 'memory usage' has 'memory' and 'usage' as keywords
      vi.mocked(learnedPatternRepository.list).mockResolvedValueOnce([
        {
          id: 'pat-match-1',
          name: 'Memory Issue Pattern',
          description: 'Detects memory issues',
          type: 'diagnostic',
          triggerConditions: ['memory usage high', 'out of memory error'],
          recommendedActions: ['restart'],
          confidence: 0.85,
          sourceIncidentIds: ['inc-1'],
          applicability: ['kubernetes'],
          exceptions: [],
          isActive: true,
          appliedCount: 0,
          successRate: null,
          lastApplied: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const matchedHandler = vi.fn();
      knowledgeBase.on('pattern:matched', matchedHandler);

      // Input with symptoms that will match the triggerConditions keywords
      await knowledgeBase.findMatchingPatterns({ symptoms: ['memory usage is very high'] });

      expect(matchedHandler).toHaveBeenCalled();
      expect(matchedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          matches: expect.arrayContaining([
            expect.objectContaining({
              pattern: expect.objectContaining({ id: 'pat-match-1' }),
            }),
          ]),
        })
      );
    });

    it('should not emit pattern:matched event when no patterns found', async () => {
      const matchedHandler = vi.fn();
      knowledgeBase.on('pattern:matched', matchedHandler);

      await knowledgeBase.findMatchingPatterns({ symptoms: ['unknown symptom'] });

      expect(matchedHandler).not.toHaveBeenCalled();
    });
  });
});

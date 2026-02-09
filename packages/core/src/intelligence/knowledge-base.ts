/**
 * Knowledge Base
 * Manages learned patterns and provides pattern matching capabilities
 */

import { EventEmitter } from 'eventemitter3';
import type { GeminiClient } from '@chronosops/gemini';
import {
  learnedPatternRepository,
  type LearnedPatternRecord,
  type PatternType,
} from '@chronosops/database';
import { createChildLogger } from '@chronosops/shared';
import type { LearnedPattern } from './pattern-learner.js';

// ===========================================
// Types
// ===========================================

export interface PatternMatchInput {
  /** Error messages observed */
  errorMessages?: string[];
  /** Log snippets */
  logs?: string[];
  /** Kubernetes events */
  events?: Array<{
    type: string;
    reason: string;
    message: string;
  }>;
  /** Metric anomalies */
  metricAnomalies?: Array<{
    metric: string;
    deviation: string;
  }>;
  /** Service/deployment affected */
  affectedService?: string;
  /** Current symptoms */
  symptoms?: string[];
}

export interface PatternMatch {
  /** Matched pattern */
  pattern: LearnedPatternRecord;
  /** Match score 0-1 */
  score: number;
  /** Explanation of why this pattern matched */
  explanation: string;
  /** Specific trigger conditions that matched */
  matchedConditions: string[];
}

export interface PatternQueryResult {
  /** Matching patterns sorted by relevance */
  matches: PatternMatch[];
  /** Query metadata */
  metadata: {
    totalPatternsSearched: number;
    matchesFound: number;
    processingTimeMs: number;
  };
}

export interface PatternStats {
  /** Total patterns in knowledge base */
  totalPatterns: number;
  /** Patterns by type */
  byType: Record<PatternType, number>;
  /** High confidence patterns (>= 0.8) */
  highConfidenceCount: number;
  /** Most applied patterns */
  mostApplied: Array<{
    patternId: string;
    name: string;
    timesApplied: number;
    successRate: number | null;
  }>;
}

export interface KnowledgeBaseEvents {
  'pattern:stored': { pattern: LearnedPatternRecord };
  'pattern:matched': { matches: PatternMatch[]; input: PatternMatchInput };
  'pattern:applied': { patternId: string; success: boolean };
  'pattern:deactivated': { patternId: string; reason: string };
}

// ===========================================
// Knowledge Base
// ===========================================

export class KnowledgeBase extends EventEmitter<KnowledgeBaseEvents> {
  private logger = createChildLogger({ component: 'KnowledgeBase' });

  // GeminiClient is reserved for future semantic matching capabilities
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_geminiClient: GeminiClient) {
    super();
  }

  /**
   * Store a learned pattern in the knowledge base
   */
  async storePattern(pattern: LearnedPattern): Promise<LearnedPatternRecord> {
    this.logger.info({ patternName: pattern.name, type: pattern.type }, 'Storing pattern');

    const record = await learnedPatternRepository.create({
      type: pattern.type,
      name: pattern.name,
      description: pattern.description,
      triggerConditions: pattern.triggerConditions,
      recommendedActions: pattern.recommendedActions,
      confidence: pattern.confidence,
      applicability: pattern.applicability,
      exceptions: pattern.exceptions,
      sourceIncidentId: pattern.sourceIncidentId,
    });

    this.emit('pattern:stored', { pattern: record });
    return record;
  }

  /**
   * Store multiple patterns
   */
  async storePatternsFromExtraction(patterns: LearnedPattern[]): Promise<LearnedPatternRecord[]> {
    const stored: LearnedPatternRecord[] = [];

    for (const pattern of patterns) {
      // Check for duplicates before storing
      const existing = await this.findSimilarPattern(pattern);
      if (existing) {
        this.logger.info(
          { patternName: pattern.name, existingId: existing.id },
          'Similar pattern already exists, skipping'
        );
        continue;
      }

      const record = await this.storePattern(pattern);
      stored.push(record);
    }

    return stored;
  }

  /**
   * Find patterns matching the given input
   */
  async findMatchingPatterns(
    input: PatternMatchInput,
    options: {
      minScore?: number;
      maxResults?: number;
      types?: PatternType[];
    } = {}
  ): Promise<PatternQueryResult> {
    const startTime = Date.now();
    const { minScore = 0.3, maxResults = 10, types } = options;

    this.logger.info({ input, options }, 'Searching for matching patterns');

    // Get active patterns
    const filters = {
      isActive: true,
      ...(types && types.length === 1 ? { type: types[0] } : {}),
    };

    const patterns = await learnedPatternRepository.list(filters, 100);

    // Filter by types if multiple specified
    const filteredPatterns = types && types.length > 1
      ? patterns.filter((p) => types.includes(p.type))
      : patterns;

    // Score each pattern against input
    const matches: PatternMatch[] = [];

    for (const pattern of filteredPatterns) {
      const matchResult = this.scorePatternMatch(pattern, input);

      if (matchResult.score >= minScore) {
        matches.push({
          pattern,
          score: matchResult.score,
          explanation: matchResult.explanation,
          matchedConditions: matchResult.matchedConditions,
        });

        // Record the match
        await learnedPatternRepository.recordMatch(pattern.id);
      }
    }

    // Sort by score descending
    matches.sort((a, b) => b.score - a.score);

    // Limit results
    const limitedMatches = matches.slice(0, maxResults);

    const result: PatternQueryResult = {
      matches: limitedMatches,
      metadata: {
        totalPatternsSearched: filteredPatterns.length,
        matchesFound: limitedMatches.length,
        processingTimeMs: Date.now() - startTime,
      },
    };

    if (limitedMatches.length > 0) {
      this.emit('pattern:matched', { matches: limitedMatches, input });
    }

    this.logger.info(
      {
        matchesFound: limitedMatches.length,
        totalSearched: filteredPatterns.length,
        duration: Date.now() - startTime,
      },
      'Pattern search completed'
    );

    return result;
  }

  /**
   * Score how well a pattern matches the input
   */
  private scorePatternMatch(
    pattern: LearnedPatternRecord,
    input: PatternMatchInput
  ): { score: number; explanation: string; matchedConditions: string[] } {
    let score = 0;
    const matchedConditions: string[] = [];
    const explanations: string[] = [];

    const conditions = pattern.triggerConditions.map((c) => c.toLowerCase());

    // Build searchable text from input
    const searchText = this.buildSearchText(input);

    // Check each trigger condition
    for (const condition of conditions) {
      // Tokenize condition into keywords
      const keywords = condition.split(/\s+/).filter((k) => k.length > 3);

      // Check if any keyword appears in search text
      const matchingKeywords = keywords.filter((k) => searchText.includes(k));

      if (matchingKeywords.length > 0) {
        const conditionScore = matchingKeywords.length / keywords.length;
        score += conditionScore * (1 / conditions.length);
        matchedConditions.push(condition);
        explanations.push(`Condition "${condition}" matched (${matchingKeywords.length}/${keywords.length} keywords)`);
      }
    }

    // Boost score based on pattern confidence
    score = score * (0.5 + pattern.confidence * 0.5);

    // Check for exception conditions (reduce score if any match)
    for (const exception of pattern.exceptions) {
      if (searchText.includes(exception.toLowerCase())) {
        score *= 0.5; // Halve the score if exception matches
        explanations.push(`Exception condition matched: "${exception}"`);
      }
    }

    return {
      score: Math.min(1, score),
      explanation: explanations.join('; ') || 'No conditions matched',
      matchedConditions,
    };
  }

  /**
   * Build searchable text from input
   */
  private buildSearchText(input: PatternMatchInput): string {
    const parts: string[] = [];

    if (input.errorMessages) {
      parts.push(...input.errorMessages);
    }
    if (input.logs) {
      parts.push(...input.logs);
    }
    if (input.events) {
      parts.push(...input.events.map((e) => `${e.type} ${e.reason} ${e.message}`));
    }
    if (input.metricAnomalies) {
      parts.push(...input.metricAnomalies.map((m) => `${m.metric} ${m.deviation}`));
    }
    if (input.affectedService) {
      parts.push(input.affectedService);
    }
    if (input.symptoms) {
      parts.push(...input.symptoms);
    }

    return parts.join(' ').toLowerCase();
  }

  /**
   * Record that a pattern was applied
   */
  async recordPatternApplication(patternId: string, success: boolean): Promise<void> {
    await learnedPatternRepository.recordApplication(patternId, success);
    this.emit('pattern:applied', { patternId, success });

    this.logger.info({ patternId, success }, 'Pattern application recorded');
  }

  /**
   * Deactivate a pattern
   */
  async deactivatePattern(patternId: string, reason: string): Promise<void> {
    await learnedPatternRepository.deactivate(patternId);
    this.emit('pattern:deactivated', { patternId, reason });

    this.logger.info({ patternId, reason }, 'Pattern deactivated');
  }

  /**
   * Get knowledge base statistics
   */
  async getStats(): Promise<PatternStats> {
    const allPatterns = await learnedPatternRepository.list({}, 1000);

    const byType: Record<PatternType, number> = {
      detection: 0,
      diagnostic: 0,
      resolution: 0,
      prevention: 0,
    };

    let highConfidenceCount = 0;

    for (const pattern of allPatterns) {
      byType[pattern.type]++;
      if (pattern.confidence >= 0.8) {
        highConfidenceCount++;
      }
    }

    // Get most applied patterns
    const applied = allPatterns
      .filter((p) => p.timesApplied > 0)
      .sort((a, b) => b.timesApplied - a.timesApplied)
      .slice(0, 10);

    return {
      totalPatterns: allPatterns.length,
      byType,
      highConfidenceCount,
      mostApplied: applied.map((p) => ({
        patternId: p.id,
        name: p.name,
        timesApplied: p.timesApplied,
        successRate: p.successRate,
      })),
    };
  }

  /**
   * Find a similar existing pattern
   */
  private async findSimilarPattern(pattern: LearnedPattern): Promise<LearnedPatternRecord | null> {
    const existing = await learnedPatternRepository.findMatching(pattern.triggerConditions);

    // Check if any existing pattern is very similar
    for (const p of existing) {
      // Check name similarity
      if (p.name.toLowerCase() === pattern.name.toLowerCase()) {
        return p;
      }

      // Check condition overlap
      const existingConditions = new Set(p.triggerConditions.map((c) => c.toLowerCase()));
      const newConditions = pattern.triggerConditions.map((c) => c.toLowerCase());

      let overlap = 0;
      for (const c of newConditions) {
        if (existingConditions.has(c)) overlap++;
      }

      const similarity = overlap / Math.max(existingConditions.size, newConditions.length);
      if (similarity > 0.7) {
        return p;
      }
    }

    return null;
  }

  /**
   * Get recommendations for an incident based on matching patterns
   */
  async getRecommendations(input: PatternMatchInput): Promise<{
    recommendations: string[];
    sourcePatterns: Array<{ id: string; name: string; confidence: number }>;
  }> {
    const queryResult = await this.findMatchingPatterns(input, {
      minScore: 0.4,
      maxResults: 5,
      types: ['diagnostic', 'resolution'],
    });

    const recommendations: Set<string> = new Set();
    const sourcePatterns: Array<{ id: string; name: string; confidence: number }> = [];

    for (const match of queryResult.matches) {
      // Add recommended actions
      for (const action of match.pattern.recommendedActions) {
        recommendations.add(action);
      }

      sourcePatterns.push({
        id: match.pattern.id,
        name: match.pattern.name,
        confidence: match.pattern.confidence,
      });
    }

    return {
      recommendations: Array.from(recommendations),
      sourcePatterns,
    };
  }

  /**
   * Search patterns by keywords
   */
  async searchPatterns(keywords: string[]): Promise<LearnedPatternRecord[]> {
    return learnedPatternRepository.findMatching(keywords);
  }

  /**
   * Get patterns by type
   */
  async getPatternsByType(type: PatternType): Promise<LearnedPatternRecord[]> {
    return learnedPatternRepository.getActiveByType(type);
  }

  /**
   * Get high confidence patterns
   */
  async getHighConfidencePatterns(): Promise<LearnedPatternRecord[]> {
    return learnedPatternRepository.getHighConfidence();
  }

  /**
   * Get pattern by ID
   */
  async getPattern(id: string): Promise<LearnedPatternRecord | null> {
    return learnedPatternRepository.getById(id);
  }

  /**
   * Update pattern
   */
  async updatePattern(
    id: string,
    updates: {
      name?: string;
      description?: string;
      triggerConditions?: string[];
      recommendedActions?: string[];
      confidence?: number;
      applicability?: string;
      exceptions?: string[];
      isActive?: boolean;
    }
  ): Promise<LearnedPatternRecord | null> {
    return learnedPatternRepository.update(id, updates);
  }

  /**
   * Delete pattern
   */
  async deletePattern(id: string): Promise<void> {
    await learnedPatternRepository.delete(id);
    this.logger.info({ patternId: id }, 'Pattern deleted');
  }
}

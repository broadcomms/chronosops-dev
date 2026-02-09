/**
 * Pattern Learner
 * Extracts patterns from completed incidents and reconstructions
 */

import { EventEmitter } from 'eventemitter3';
import type { GeminiClient } from '@chronosops/gemini';
import { createChildLogger } from '@chronosops/shared';
import type { ReconstructionResult } from './incident-reconstructor.js';

// ===========================================
// Types
// ===========================================

export interface IncidentForLearning {
  id: string;
  title: string;
  description?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  rootCause?: string;
  resolution?: string;
  /** Time to resolution in minutes */
  timeToResolution?: number;
  /** Actions taken to resolve */
  actionsTaken?: Array<{
    type: string;
    target: string;
    success: boolean;
  }>;
  /** Related reconstruction if available */
  reconstruction?: ReconstructionResult;
}

export interface LearnedPattern {
  /** Pattern type */
  type: 'detection' | 'diagnostic' | 'resolution' | 'prevention';
  /** Short, descriptive name */
  name: string;
  /** Detailed description */
  description: string;
  /** Conditions that trigger this pattern */
  triggerConditions: string[];
  /** Recommended actions when pattern matches */
  recommendedActions: string[];
  /** Confidence score 0-1 */
  confidence: number;
  /** When this pattern applies */
  applicability: string;
  /** Cases where this pattern should NOT be applied */
  exceptions: string[];
  /** Source incident ID */
  sourceIncidentId: string;
}

export interface PatternExtractionResult {
  /** Successfully extracted patterns */
  patterns: LearnedPattern[];
  /** Extraction metadata */
  metadata: {
    incidentId: string;
    patternsFound: number;
    processingTimeMs: number;
  };
}

export interface PatternLearnerEvents {
  'extraction:started': { incidentId: string };
  'extraction:completed': { result: PatternExtractionResult };
  'extraction:failed': { incidentId: string; error: string };
  'pattern:created': { pattern: LearnedPattern };
}

// ===========================================
// Pattern Learner
// ===========================================

export class PatternLearner extends EventEmitter<PatternLearnerEvents> {
  private geminiClient: GeminiClient;
  private logger = createChildLogger({ component: 'PatternLearner' });

  constructor(geminiClient: GeminiClient) {
    super();
    this.geminiClient = geminiClient;
  }

  /**
   * Extract patterns from a resolved incident
   */
  async extractPatterns(incident: IncidentForLearning): Promise<PatternExtractionResult> {
    const startTime = Date.now();

    this.logger.info(
      {
        incidentId: incident.id,
        hasReconstruction: !!incident.reconstruction,
      },
      'Starting pattern extraction'
    );

    this.emit('extraction:started', { incidentId: incident.id });

    try {
      // Build context from incident data
      const context = this.buildExtractionContext(incident);

      // Extract patterns using Gemini
      const extractedPatterns = await this.extractWithGemini(incident.id, context);

      // Validate and filter patterns
      const validPatterns = this.validatePatterns(extractedPatterns, incident);

      // Emit events for each pattern
      for (const pattern of validPatterns) {
        this.emit('pattern:created', { pattern });
      }

      const result: PatternExtractionResult = {
        patterns: validPatterns,
        metadata: {
          incidentId: incident.id,
          patternsFound: validPatterns.length,
          processingTimeMs: Date.now() - startTime,
        },
      };

      this.emit('extraction:completed', { result });

      this.logger.info(
        {
          incidentId: incident.id,
          patternsFound: validPatterns.length,
          duration: Date.now() - startTime,
        },
        'Pattern extraction completed'
      );

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error: errorMessage, incidentId: incident.id }, 'Pattern extraction failed');
      this.emit('extraction:failed', { incidentId: incident.id, error: errorMessage });
      throw error;
    }
  }

  /**
   * Extract patterns from multiple incidents (batch learning)
   */
  async extractPatternsFromBatch(incidents: IncidentForLearning[]): Promise<PatternExtractionResult[]> {
    const results: PatternExtractionResult[] = [];

    for (const incident of incidents) {
      try {
        const result = await this.extractPatterns(incident);
        results.push(result);
      } catch (error) {
        this.logger.warn(
          { incidentId: incident.id, error: error instanceof Error ? error.message : 'Unknown' },
          'Failed to extract patterns from incident, continuing with batch'
        );
      }
    }

    return results;
  }

  /**
   * Build context for pattern extraction
   */
  private buildExtractionContext(incident: IncidentForLearning): string {
    const sections: string[] = [];

    // Incident details
    sections.push(`# Incident Analysis for Pattern Extraction

## Incident Details
- ID: ${incident.id}
- Title: ${incident.title}
- Severity: ${incident.severity}
${incident.description ? `- Description: ${incident.description}` : ''}
${incident.rootCause ? `- Root Cause: ${incident.rootCause}` : ''}
${incident.resolution ? `- Resolution: ${incident.resolution}` : ''}
${incident.timeToResolution ? `- Time to Resolution: ${incident.timeToResolution} minutes` : ''}`);

    // Actions taken
    if (incident.actionsTaken?.length) {
      sections.push(`## Actions Taken
${incident.actionsTaken
  .map((a) => `- ${a.type} on ${a.target}: ${a.success ? 'Success' : 'Failed'}`)
  .join('\n')}`);
    }

    // Reconstruction data if available
    if (incident.reconstruction) {
      const r = incident.reconstruction;
      sections.push(`## Reconstructed Timeline
${r.timeline
  .slice(0, 20)
  .map((e) => `[${e.timestamp}] ${e.category}: ${e.summary}`)
  .join('\n')}

## Causal Chain
${r.causalChain
  .map((c) => `${c.from} -> ${c.to} (${c.relationship}, confidence: ${c.confidence})`)
  .join('\n')}

## Narrative
${r.narrative}`);
    }

    return sections.join('\n\n');
  }

  /**
   * Extract patterns using Gemini's learnPattern method
   */
  private async extractWithGemini(incidentId: string, context: string): Promise<LearnedPattern[]> {
    // Use the GeminiClient's learnPattern method
    const response = await this.geminiClient.learnPattern({
      incident: context,
      resolution: '', // Resolution is embedded in the context
    });

    if (!response.success || !response.data) {
      throw new Error(`Pattern extraction failed: ${response.error ?? 'Unknown error'}`);
    }

    // Transform the Gemini response to our internal format
    const patterns: LearnedPattern[] = response.data.patterns.map((p) => ({
      type: p.type,
      name: p.name,
      description: p.description,
      triggerConditions: p.triggerConditions.map((tc) => `${tc.signal}: ${tc.threshold} (${tc.source})`),
      recommendedActions: p.recommendedActions.map((ra) => `${ra.action} - ${ra.when}`),
      confidence: p.confidence,
      applicability: p.applicability,
      exceptions: p.exceptions ?? [],
      sourceIncidentId: incidentId,
    }));

    return patterns;
  }

  /**
   * Validate and filter patterns
   */
  private validatePatterns(patterns: LearnedPattern[], _incident: IncidentForLearning): LearnedPattern[] {
    return patterns.filter((pattern) => {
      // Must have a name and description
      if (!pattern.name || !pattern.description) {
        this.logger.debug({ pattern }, 'Pattern missing name or description');
        return false;
      }

      // Must have at least one trigger condition
      if (!pattern.triggerConditions?.length) {
        this.logger.debug({ pattern: pattern.name }, 'Pattern has no trigger conditions');
        return false;
      }

      // Must have at least one recommended action
      if (!pattern.recommendedActions?.length) {
        this.logger.debug({ pattern: pattern.name }, 'Pattern has no recommended actions');
        return false;
      }

      // Confidence must be reasonable (0.3 - 1.0)
      if (pattern.confidence < 0.3 || pattern.confidence > 1) {
        this.logger.debug({ pattern: pattern.name, confidence: pattern.confidence }, 'Pattern has invalid confidence');
        return false;
      }

      return true;
    });
  }

  /**
   * Compare two patterns for similarity
   */
  async comparePatternsForSimilarity(
    pattern1: LearnedPattern,
    pattern2: LearnedPattern
  ): Promise<{ similar: boolean; similarity: number }> {
    // Simple heuristic: check trigger condition overlap
    const conditions1 = new Set(pattern1.triggerConditions.map((c) => c.toLowerCase()));
    const conditions2 = new Set(pattern2.triggerConditions.map((c) => c.toLowerCase()));

    let overlap = 0;
    for (const c of conditions1) {
      if (conditions2.has(c)) overlap++;
    }

    const totalConditions = conditions1.size + conditions2.size - overlap;
    const similarity = totalConditions > 0 ? overlap / totalConditions : 0;

    return {
      similar: similarity > 0.5,
      similarity,
    };
  }

  /**
   * Merge similar patterns (consolidate)
   */
  async mergePatterns(patterns: LearnedPattern[]): Promise<LearnedPattern | null> {
    if (patterns.length === 0) return null;
    if (patterns.length === 1) return patterns[0]!;

    // Use the highest confidence pattern as base
    const sorted = [...patterns].sort((a, b) => b.confidence - a.confidence);
    const base = sorted[0]!;

    // Merge trigger conditions and actions
    const allTriggers = new Set<string>();
    const allActions = new Set<string>();
    const allExceptions = new Set<string>();

    for (const p of patterns) {
      p.triggerConditions.forEach((t) => allTriggers.add(t));
      p.recommendedActions.forEach((a) => allActions.add(a));
      p.exceptions.forEach((e) => allExceptions.add(e));
    }

    // Calculate merged confidence (weighted average)
    const avgConfidence = patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length;

    return {
      ...base,
      triggerConditions: Array.from(allTriggers),
      recommendedActions: Array.from(allActions),
      exceptions: Array.from(allExceptions),
      confidence: avgConfidence,
      description: `${base.description} (Merged from ${patterns.length} similar patterns)`,
    };
  }
}

/**
 * Requirement Analyzer
 * Parses natural language requirements into structured AnalyzedRequirement
 */

import { createChildLogger } from '@chronosops/shared';
import type { AnalyzedRequirement, RequirementPriority, RequirementType, ComplexityLevel } from '@chronosops/shared';
import type { GeminiClient, RequirementAnalysisGeminiResponse } from '@chronosops/gemini';
import type { RequirementAnalysisResult } from './types.js';

export interface RequirementAnalyzerConfig {
  /** Default priority if not specified */
  defaultPriority: RequirementPriority;
  /** Timeout for analysis in milliseconds */
  timeoutMs: number;
}

const DEFAULT_CONFIG: RequirementAnalyzerConfig = {
  defaultPriority: 'medium',
  timeoutMs: 300000, // 5 minutes - match GeminiClient and phase timeout
};

export class RequirementAnalyzer {
  private geminiClient: GeminiClient;
  private config: RequirementAnalyzerConfig;
  private logger = createChildLogger({ component: 'RequirementAnalyzer' });

  constructor(
    geminiClient: GeminiClient,
    config: Partial<RequirementAnalyzerConfig> = {}
  ) {
    this.geminiClient = geminiClient;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get the configured default priority
   */
  getDefaultPriority(): RequirementPriority {
    return this.config.defaultPriority;
  }

  /**
   * Analyze a natural language requirement and convert to structured format
   *
   * @param rawRequirement The natural language requirement text
   * @param priority Optional priority level
   * @param captureThinking When true, makes a separate API call to capture AI reasoning
   *   for display in the UI (JSON schema mode doesn't return thought content)
   */
  async analyze(
    rawRequirement: string,
    priority?: RequirementPriority,
    captureThinking = true // Default to true for better UX
  ): Promise<RequirementAnalysisResult> {
    const startTime = Date.now();
    const effectivePriority = priority ?? this.config.defaultPriority;

    this.logger.info({
      rawRequirement: rawRequirement.slice(0, 100),
      priority: effectivePriority,
      timeoutMs: this.config.timeoutMs,
      captureThinking,
    }, 'Analyzing requirement');

    try {
      // Use Gemini to analyze the requirement
      const response = await this.geminiClient.analyzeRequirement({
        requirement: rawRequirement,
        projectContext: 'TypeScript Node.js application targeting Kubernetes',
        captureThinking, // Enable separate thinking capture call
      });

      if (!response.success || !response.data) {
        this.logger.error({ error: response.error }, 'Gemini analysis failed');
        return {
          success: false,
          error: response.error ?? 'Unknown error during requirement analysis',
          rawInput: rawRequirement,
          processingTimeMs: Date.now() - startTime,
        };
      }

      // Extract and validate the analyzed requirement
      const analyzed = this.extractAnalyzedRequirement(response.data);

      this.logger.info({
        title: analyzed.title,
        type: analyzed.type,
        complexity: analyzed.estimatedComplexity,
        hasThoughtSignature: !!response.thoughtSignature,
        hasThoughtContent: !!response.thoughtContent,
        thoughtContentLength: response.thoughtContent?.length ?? 0,
      }, 'Requirement analysis complete');

      return {
        success: true,
        requirement: analyzed,
        rawInput: rawRequirement,
        processingTimeMs: Date.now() - startTime,
        thoughtSignature: response.thoughtSignature,
        thoughtContent: response.thoughtContent,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error: errorMessage }, 'Requirement analysis failed');

      return {
        success: false,
        error: errorMessage,
        rawInput: rawRequirement,
        processingTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Extract and validate analyzed requirement from Gemini response
   */
  private extractAnalyzedRequirement(
    data: RequirementAnalysisGeminiResponse
  ): AnalyzedRequirement {
    return {
      type: this.normalizeType(data.type),
      title: data.title ?? 'Untitled Requirement',
      description: data.description ?? '',
      acceptanceCriteria: data.acceptanceCriteria ?? [],
      estimatedComplexity: this.normalizeComplexity(data.estimatedComplexity),
      suggestedApproach: data.suggestedApproach ?? '',
      requiredCapabilities: data.requiredCapabilities ?? [],
      potentialRisks: data.potentialRisks ?? [],
      relatedPatterns: data.relatedPatterns ?? [],
      targetFiles: data.targetFiles,
      suggestedDependencies: data.suggestedDependencies,
    };
  }

  /**
   * Normalize requirement type
   */
  private normalizeType(type?: string): RequirementType {
    const normalized = type?.toLowerCase();
    switch (normalized) {
      case 'feature':
        return 'feature';
      case 'bugfix':
      case 'bug_fix':
      case 'fix':
        return 'bugfix';
      case 'refactor':
      case 'refactoring':
        return 'refactor';
      case 'infrastructure':
      case 'infra':
        return 'infrastructure';
      default:
        return 'feature';
    }
  }

  /**
   * Normalize complexity level
   */
  private normalizeComplexity(complexity?: string): ComplexityLevel {
    const normalized = complexity?.toLowerCase();
    switch (normalized) {
      case 'low':
      case 'simple':
      case 'trivial':
        return 'low';
      case 'medium':
      case 'moderate':
        return 'medium';
      case 'high':
      case 'complex':
      case 'very_complex':
        return 'high';
      default:
        return 'medium';
    }
  }

  /**
   * Validate that a requirement is complete enough for code generation
   */
  validateForGeneration(requirement: AnalyzedRequirement): {
    valid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    if (!requirement.title || requirement.title.length < 3) {
      issues.push('Title is too short or missing');
    }

    if (!requirement.description || requirement.description.length < 10) {
      issues.push('Description is too short or missing');
    }

    if (!requirement.acceptanceCriteria || requirement.acceptanceCriteria.length === 0) {
      issues.push('No acceptance criteria defined');
    }

    if (!requirement.suggestedApproach) {
      issues.push('No suggested approach defined');
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }
}

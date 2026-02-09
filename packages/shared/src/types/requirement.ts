/**
 * Requirement types for self-regenerating app ecosystem
 */

/**
 * Source of a requirement
 */
export type RequirementSource = 'user' | 'incident' | 'improvement' | 'pattern';

/**
 * Priority level for requirements
 */
export type RequirementPriority = 'low' | 'medium' | 'high' | 'critical';

/**
 * Type of change required
 */
export type RequirementType = 'feature' | 'bugfix' | 'refactor' | 'infrastructure';

/**
 * Complexity estimation
 */
export type ComplexityLevel = 'low' | 'medium' | 'high';

/**
 * Raw requirement input from user or incident
 */
export interface Requirement {
  /** Unique identifier */
  id?: string;

  /** Source of the requirement */
  source: RequirementSource;

  /** Raw requirement text */
  rawText: string;

  /** Associated incident ID if from incident */
  incidentId?: string;

  /** Priority level */
  priority: RequirementPriority;

  /** Project context for generation */
  projectContext?: string;

  /** Existing codebase context (patterns, conventions) */
  existingCodeContext?: string;

  /** Target namespace for deployment */
  targetNamespace?: string;

  /** Created timestamp */
  createdAt?: string;
}

/**
 * Requirement after AI analysis
 */
export interface AnalyzedRequirement {
  /** Type of change required */
  type: RequirementType;

  /** Short title for the requirement */
  title: string;

  /** Detailed description */
  description: string;

  /** Specific acceptance criteria */
  acceptanceCriteria: string[];

  /** Estimated complexity */
  estimatedComplexity: ComplexityLevel;

  /** Suggested implementation approach */
  suggestedApproach: string;

  /** Required capabilities (e.g., 'api', 'database', 'ui') */
  requiredCapabilities: string[];

  /** Potential risks or challenges */
  potentialRisks: string[];

  /** Related patterns from previous implementations */
  relatedPatterns: string[];

  /** Target files to create or modify */
  targetFiles?: string[];

  /** Dependencies that may need to be added */
  suggestedDependencies?: string[];

  /** Thought signature from analysis */
  thoughtSignature?: string;
}

/**
 * Request to analyze a requirement
 */
export interface RequirementAnalysisRequest {
  /** Raw requirement text */
  requirement: string;

  /** Project context */
  projectContext?: string;

  /** Existing code patterns */
  existingPatterns?: string;

  /** Continue from previous analysis */
  thoughtSignature?: string;
}

/**
 * Response from requirement analysis
 */
export interface RequirementAnalysisResponse {
  /** Analyzed requirement */
  analyzed: AnalyzedRequirement;

  /** Confidence in analysis */
  confidence: number;

  /** Thought signature for continuity */
  thoughtSignature?: string;
}

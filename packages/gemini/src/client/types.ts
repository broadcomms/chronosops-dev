/**
 * Gemini API client types
 */

import type { Evidence, Hypothesis, EvidenceType, HypothesisStatus, ActionType, ActionStatus, ModelAssignments, AITask, ModelTier, TemperatureAssignments } from '@chronosops/shared';

// Re-export for convenience
export type { ModelAssignments, AITask, ModelTier, TemperatureAssignments };

/**
 * Thinking budget levels for Gemini 3
 */
export const THINKING_BUDGETS = {
  LOW: 1024,
  MEDIUM: 8192,
  HIGH: 24576,
} as const;

export type ThinkingBudget = (typeof THINKING_BUDGETS)[keyof typeof THINKING_BUDGETS];

/**
 * Gemini model identifiers
 */
export const GEMINI_MODELS = {
  FLASH: 'gemini-3-flash-preview',
  PRO: 'gemini-3-pro-preview',
  FLASH_FALLBACK: 'gemini-3-flash-preview',
  /** Image generation model - supports TEXT+IMAGE input/output */
  IMAGE: 'gemini-3-pro-image-preview',
} as const;

export type GeminiModel = (typeof GEMINI_MODELS)[keyof typeof GEMINI_MODELS];

/**
 * Progressive backoff configuration for retry delays
 * Implements 1m → 2m → 3m → 4m → 5m pattern with jitter
 */
export interface ProgressiveBackoffConfig {
  /** Enable progressive backoff (default: true) */
  enabled: boolean;
  /** Initial retry delay in ms (default: 60000 = 1 minute) */
  initialDelayMs: number;
  /** Maximum retry delay cap in ms (default: 300000 = 5 minutes) */
  maxDelayMs: number;
  /** Delay increment per attempt in ms (default: 60000 = 1 minute) */
  incrementMs: number;
  /** Jitter factor 0-1 for randomization (default: 0.1 = 10%) */
  jitterFactor: number;
}

/**
 * Default progressive backoff configuration
 * 15s → 30s → 45s → 60s (capped) - reduced for faster phase retry
 */
export const DEFAULT_PROGRESSIVE_BACKOFF: ProgressiveBackoffConfig = {
  enabled: true,
  initialDelayMs: 15000,    // 15 seconds - reduced from 1 minute
  maxDelayMs: 60000,        // 1 minute cap - reduced from 5 minutes
  incrementMs: 15000,       // +15 seconds each retry
  jitterFactor: 0.1,        // 10% jitter
};

/**
 * Client configuration
 */
export interface GeminiClientConfig {
  apiKey: string;
  model?: GeminiModel;
  proModel?: GeminiModel;
  /** Model assignments for each AI task - allows fine-grained control over flash vs pro usage */
  modelAssignments?: Partial<ModelAssignments>;
  /** Temperature assignments for each AI task - allows fine-grained control over creativity vs consistency */
  temperatureAssignments?: Partial<TemperatureAssignments>;
  defaultThinkingBudget?: ThinkingBudget;
  /** Default temperature for responses (0.0-2.0, default: 0.3) */
  defaultTemperature?: number;
  maxRetries?: number;
  /** @deprecated Use progressiveBackoff instead for better retry behavior */
  retryDelayMs?: number;
  /** Request timeout in milliseconds (default: 120000 = 2 minutes) */
  requestTimeoutMs?: number;
  /** Progressive backoff configuration for retry delays */
  progressiveBackoff?: Partial<ProgressiveBackoffConfig>;
}

/**
 * JSON Schema type for Gemini responseSchema
 * Used to guarantee structured output from the API
 */
export interface JsonSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean';
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: string[];
  description?: string;
}

/**
 * Request options for content generation
 */
export interface GenerateOptions {
  model?: GeminiModel;
  thinkingBudget?: ThinkingBudget;
  systemInstruction?: string;
  responseFormat?: 'json' | 'text';
  /**
   * Temperature for response generation (0.0-2.0).
   * Lower values (0.1-0.3) produce more consistent, deterministic outputs.
   * Higher values (0.7-1.0) produce more creative, varied outputs.
   * Default: 0.3 for incident response consistency.
   */
  temperature?: number;
  /**
   * JSON Schema for structured output validation.
   * When provided, Gemini guarantees the response matches this schema.
   * @see https://ai.google.dev/gemini-api/docs/structured-output
   */
  responseSchema?: JsonSchema;
  thoughtSignature?: string;
  /**
   * Maximum number of tokens to generate.
   * Important for code generation where full files are required.
   */
  maxOutputTokens?: number;
}

/**
 * Gemini API content types for multimodal requests
 */
export interface TextPart {
  text: string;
}

export interface InlineDataPart {
  inlineData: {
    mimeType: string;
    data: string; // base64 encoded
  };
}

export type ContentPart = TextPart | InlineDataPart;

/**
 * Content input for Gemini API
 * Can be a simple string or an array of multimodal parts
 */
export type GeminiContents = string | ContentPart[];

/**
 * Frame analysis request
 */
export interface FrameAnalysisRequest {
  frames: FrameInput[];
  incidentId: string;
  context?: string;
}

export interface FrameInput {
  data: Buffer | string; // Base64 or buffer
  timestamp: Date;
  mimeType?: string;
}

/**
 * Frame analysis response
 *
 * For multi-frame analysis, includes temporalAnalysis with:
 * - Anomaly onset detection (when issues first appeared)
 * - Trend direction (improving/deteriorating)
 * - Changes between frames
 * - Correlated metric changes
 */
export interface FrameAnalysisResponse {
  anomalies: AnomalyDetection[];
  metrics: ExtractedMetric[];
  dashboardState: DashboardState;
  /** Temporal analysis for multi-frame requests */
  temporalAnalysis?: TemporalAnalysis;
  thoughtSignature?: string;
  thinkingTokensUsed?: number;
}

export interface AnomalyDetection {
  type: 'error_spike' | 'latency_increase' | 'resource_exhaustion' | 'deployment_event' | 'traffic_anomaly';
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  description: string;
  location?: string;
  timestamp: Date;
  /** Frame number where this anomaly first appeared (1-indexed) */
  firstSeenInFrame?: number;
}

export interface ExtractedMetric {
  name: string;
  value: number;
  unit: string;
  trend: 'increasing' | 'decreasing' | 'stable' | 'volatile';
  timestamp: Date;
  /** Percentage change from the first (baseline) frame */
  changeFromBaseline?: number;
}

/**
 * Temporal analysis for multi-frame dashboard analysis
 * Leverages Gemini 3's spatial-temporal video understanding
 */
export interface TemporalAnalysis {
  /** Number of frames analyzed */
  framesAnalyzed: number;
  /** Total time span covered in seconds */
  timeSpanSeconds: number;
  /** When the anomaly first appeared */
  anomalyOnset?: {
    frameNumber: number;
    timestamp: string;
    description: string;
  };
  /** Overall direction of the situation */
  trendDirection: 'improving' | 'deteriorating' | 'stable' | 'fluctuating';
  /** Summary of significant changes between frames */
  changesSummary: Array<{
    fromFrame: number;
    toFrame: number;
    change: string;
    significance: 'low' | 'medium' | 'high';
  }>;
  /** Metrics that changed together, suggesting correlation */
  correlatedChanges: string[];
}

export interface DashboardState {
  healthy: boolean;
  panelStates: PanelState[];
  overallSeverity: 'healthy' | 'warning' | 'critical';
}

export interface PanelState {
  name: string;
  status: 'normal' | 'warning' | 'error' | 'unknown';
  description?: string;
}

/**
 * Log analysis request
 */
export interface LogAnalysisRequest {
  logs: string[];
  incidentId: string;
  timeRange: {
    start: Date;
    end: Date;
  };
  context?: string;
}

/**
 * Log analysis response
 */
export interface LogAnalysisResponse {
  patterns: LogPattern[];
  errorSpikes: ErrorSpike[];
  timeline: TimelineEvent[];
  thoughtSignature?: string;
}

export interface LogPattern {
  pattern: string;
  count: number;
  severity: 'info' | 'warning' | 'error';
  samples: string[];
}

export interface ErrorSpike {
  errorType: string;
  count: number;
  startTime: Date;
  endTime: Date;
  affectedServices: string[];
}

export interface TimelineEvent {
  timestamp: Date;
  event: string;
  type: 'error' | 'warning' | 'info' | 'deployment' | 'config_change';
  source: string;
}

/**
 * Hypothesis generation request
 */
export interface HypothesisGenerationRequest {
  evidence: Evidence[];
  incidentId: string;
  previousHypotheses?: Hypothesis[];
  thoughtSignature?: string;
  /**
   * Namespace where the incident is occurring.
   * Used to guide action targets.
   */
  namespace: string;
  /**
   * Target deployment name for remediation actions.
   * This tells Gemini exactly which deployment to target.
   */
  targetDeployment?: string;
  /**
   * Allowed remediation actions based on Kubernetes configuration.
   * Gemini will ONLY suggest actions from this list.
   * If not provided, all actions (rollback, restart, scale, code_fix) are allowed.
   */
  allowedActions?: ('rollback' | 'restart' | 'scale' | 'code_fix')[];
  /**
   * Dynamic thinking budget based on evidence confidence.
   * When evidence confidence is low, use higher budgets for deeper analysis.
   * If not provided, defaults to HIGH for thorough hypothesis generation.
   */
  thinkingBudget?: ThinkingBudget;
}

/**
 * Hypothesis generation response
 */
export interface HypothesisGenerationResponse {
  hypotheses: GeneratedHypothesis[];
  reasoning: string;
  thoughtSignature?: string;
  thinkingTokensUsed?: number;
}

export interface GeneratedHypothesis {
  rootCause: string;
  confidence: number;
  supportingEvidence: string[];
  contradictingEvidence: string[];
  suggestedActions: SuggestedAction[];
  testingSteps: string[];
}

export interface SuggestedAction {
  type: 'rollback' | 'restart' | 'scale' | 'code_fix';
  target: string;
  parameters: Record<string, unknown>;
  riskLevel: 'low' | 'medium' | 'high';
  /** For code_fix: Component/file that needs modification */
  affectedComponent?: string;
  /** For code_fix: Detailed description of what code change is needed */
  fixDescription?: string;
  /** For code_fix: Why operational fixes won't resolve this issue */
  codeFixReason?: string;
}

/**
 * Simplified evidence for postmortem input
 */
export interface PostmortemEvidence {
  id: string;
  type: EvidenceType;
  source: string;
  content: string;
  timestamp: Date;
  confidence?: number;
}

/**
 * Simplified hypothesis for postmortem input
 */
export interface PostmortemHypothesis {
  id: string;
  description: string;
  confidence: number;
  status: HypothesisStatus;
  supportingEvidence: string[];
  contradictingEvidence: string[];
}

/**
 * Simplified action for postmortem input
 */
export interface PostmortemAction {
  id: string;
  type: ActionType;
  target: string;
  status: ActionStatus;
  result?: string;
}

/**
 * Postmortem generation request
 */
export interface PostmortemRequest {
  incidentId: string;
  title: string;
  evidence: PostmortemEvidence[];
  hypotheses: PostmortemHypothesis[];
  actions: PostmortemAction[];
  duration: number;
  thoughtSignature?: string;
}

/**
 * Postmortem generation response
 */
export interface PostmortemResponse {
  summary: string;
  timeline: TimelineEntry[];
  rootCauseAnalysis: string;
  impactAnalysis: string;
  actionsTaken: ActionSummary[];
  lessonsLearned: string[];
  preventionRecommendations: string[];
  markdown: string;
}

export interface TimelineEntry {
  timestamp: Date;
  event: string;
  phase: string;
}

export interface ActionSummary {
  action: string;
  result: string;
  duration: number;
}

/**
 * Gemini API response wrapper
 */
export interface GeminiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    thinkingTokens?: number;
    totalTokens: number;
  };
  /** Compact signature for thought state continuity */
  thoughtSignature?: string;
  /** Full thinking content for UI display (captured via separate call) */
  thoughtContent?: string;
}

// ===========================================
// Full Context Analysis (1M Token Window)
// ===========================================

/**
 * Historical incident summary for context enrichment
 */
export interface HistoricalIncident {
  id: string;
  title: string;
  severity: string;
  rootCause: string;
  resolution: string;
  duration: number;
  occurredAt: Date;
  similarity?: number; // 0.0-1.0 similarity score to current incident
}

/**
 * Kubernetes resource context
 */
export interface KubernetesContext {
  deployments?: string;      // YAML manifests
  recentEvents?: string;     // kubectl get events output
  podStatuses?: string;      // Pod status summaries
  resourceUsage?: string;    // CPU/memory metrics
}

/**
 * Full context analysis request - leverages Gemini's 1M token context window
 *
 * This enables loading complete incident context without chunking or RAG:
 * - Full logs (not samples)
 * - Historical similar incidents
 * - Complete Kubernetes state
 * - All collected evidence
 */
export interface FullContextAnalysisRequest {
  incidentId: string;
  incidentTitle: string;
  incidentDescription?: string;
  severity: string;
  namespace: string;

  /** All evidence collected during investigation */
  evidence: Evidence[];

  /** Complete log dump (can be megabytes) */
  fullLogs?: string;

  /** Similar past incidents for pattern matching */
  historicalIncidents?: HistoricalIncident[];

  /** Kubernetes cluster context */
  kubernetesContext?: KubernetesContext;

  /** Previous thought signature for reasoning continuity */
  thoughtSignature?: string;

  /** Optional thinking budget override */
  thinkingBudget?: ThinkingBudget;
}

/**
 * Correlation found between signals
 */
export interface SignalCorrelation {
  signals: string[];
  relationship: 'causal' | 'temporal' | 'symptomatic';
  confidence: number;
  description: string;
}

/**
 * Pattern match from historical incidents
 */
export interface HistoricalPattern {
  incidentId: string;
  similarity: number;
  matchedSignals: string[];
  previousRootCause: string;
  previousResolution: string;
  applicability: 'high' | 'medium' | 'low';
}

/**
 * Full context analysis response
 */
export interface FullContextAnalysisResponse {
  /** Unified timeline of all events */
  timeline: Array<{
    timestamp: string;
    event: string;
    source: 'logs' | 'metrics' | 'k8s' | 'evidence' | 'historical';
    significance: 'low' | 'medium' | 'high' | 'critical';
  }>;

  /** Correlations found between different signals */
  correlations: SignalCorrelation[];

  /** Patterns matched from historical incidents */
  historicalPatterns: HistoricalPattern[];

  /** Most likely trigger event */
  triggerEvent: {
    timestamp: string;
    description: string;
    confidence: number;
    evidence: string[];
  };

  /** Key insights from the full context analysis */
  insights: string[];

  /** Recommended focus areas for hypothesis generation */
  focusAreas: string[];

  /** Token usage for this analysis */
  contextStats: {
    estimatedInputTokens: number;
    evidenceItems: number;
    logLines: number;
    historicalIncidents: number;
  };

  /** Overall confidence in the analysis */
  confidence: number;

  /** Reasoning chain summary */
  reasoning: string;
}

// ===========================================
// Function Calling / Tool Use
// ===========================================

/**
 * Kubernetes tool types for function calling
 */
export type KubernetesResource = 'pods' | 'deployments' | 'services' | 'events' | 'logs' | 'configmaps' | 'secrets' | 'nodes';

/**
 * Tool definition for Gemini function calling
 */
export interface GeminiTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
    }>;
    required: string[];
  };
}

/**
 * Function call from Gemini
 */
export interface GeminiFunctionCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Function call response to send back to Gemini
 */
export interface GeminiFunctionResponse {
  name: string;
  response: unknown;
}

/**
 * Tool executor function type
 * Implementations should execute the tool and return the result
 */
export type ToolExecutor = (
  toolName: string,
  args: Record<string, unknown>
) => Promise<unknown>;

/**
 * Kubernetes query parameters (for kubectl_get tool)
 */
export interface KubectlGetParams {
  resource: KubernetesResource;
  namespace: string;
  selector?: string;
  name?: string;
  outputFormat?: 'json' | 'yaml' | 'wide';
}

/**
 * Kubernetes logs parameters (for kubectl_logs tool)
 */
export interface KubectlLogsParams {
  podName: string;
  namespace: string;
  container?: string;
  tailLines?: number;
  sinceSeconds?: number;
}

/**
 * Kubernetes describe parameters
 */
export interface KubectlDescribeParams {
  resource: KubernetesResource;
  name: string;
  namespace: string;
}

/**
 * Analysis request with tool use enabled
 */
export interface AnalysisWithToolsRequest {
  incidentId: string;
  prompt: string;
  namespace: string;
  /** Tool executor callback - called when Gemini requests tool execution */
  toolExecutor: ToolExecutor;
  /** Maximum number of tool call rounds (default: 5) */
  maxToolRounds?: number;
  /** Thinking budget for analysis */
  thinkingBudget?: ThinkingBudget;
  /** Previous thought signature for context continuity */
  thoughtSignature?: string;
}

/**
 * Analysis response with tool use
 */
export interface AnalysisWithToolsResponse {
  analysis: string;
  toolCallsExecuted: Array<{
    tool: string;
    args: Record<string, unknown>;
    result: unknown;
  }>;
  totalToolCalls: number;
}

// ===========================================
// Development / Self-Regenerating Types
// ===========================================

/**
 * Request to analyze a requirement
 */
export interface RequirementAnalysisGeminiRequest {
  /** Raw requirement text */
  requirement: string;
  /** Project context */
  projectContext?: string;
  /** Existing code patterns to follow */
  existingPatterns?: string;
  /** Continue from previous analysis */
  thoughtSignature?: string;
  /**
   * Capture thinking content via separate call (without JSON schema).
   * When true, makes an extra API call to capture AI reasoning for UI display.
   * Required because JSON schema mode doesn't return thought content in response.
   */
  captureThinking?: boolean;
}

/**
 * Response from requirement analysis
 */
export interface RequirementAnalysisGeminiResponse {
  type: 'feature' | 'bugfix' | 'refactor' | 'infrastructure';
  title: string;
  description: string;
  acceptanceCriteria: string[];
  estimatedComplexity: 'low' | 'medium' | 'high';
  suggestedApproach: string;
  requiredCapabilities: string[];
  potentialRisks: string[];
  relatedPatterns: string[];
  targetFiles?: string[];
  suggestedDependencies?: string[];
}

/**
 * Request to design architecture
 */
export interface ArchitectureDesignGeminiRequest {
  /** Analyzed requirement (JSON stringified) */
  requirement: string;
  /** Acceptance criteria - specific endpoints, features, constraints that MUST be implemented */
  acceptanceCriteria?: string[];
  /** Existing architecture description */
  existingArchitecture?: string;
  /** Codebase context (patterns, conventions) */
  codebaseContext?: string;
  /** Continue from previous design */
  thoughtSignature?: string;
  /**
   * Capture thinking content via separate call (without JSON schema).
   * When true, makes an extra API call to capture AI reasoning for UI display.
   * Required because JSON schema mode doesn't return thought content in response.
   */
  captureThinking?: boolean;
}

/**
 * Response from architecture design
 */
export interface ArchitectureDesignGeminiResponse {
  overview: string;
  components: Array<{
    name: string;
    type: 'service' | 'repository' | 'controller' | 'middleware' | 'route' | 'model' | 'util';
    purpose: string;
    suggestedPath: string;
    interface: Array<{
      name: string;
      description: string;
      parameters: Array<{
        name: string;
        type: string;
        optional: boolean;
        description: string;
      }>;
      returnType: string;
      async: boolean;
    }>;
    internalState?: string[];
    errorHandling: string;
    dependsOn?: string[];
    testRequirements?: string[];
  }>;
  dependencies: Array<{
    from: string;
    to: string;
    type: 'uses' | 'extends' | 'implements';
  }>;
  externalDependencies: Array<{
    name: string;
    version: string;
    purpose: string;
    devOnly: boolean;
  }>;
  dataFlow: string;
  securityConsiderations: string[];
  performanceConsiderations: string[];
  testingStrategy?: string;
}

/**
 * Request to generate code
 */
export interface CodeGenerationGeminiRequest {
  /** Unique identifier for tracking */
  requirementId: string;
  /** Requirement or component description */
  requirement: string;
  /** Component specification (JSON stringified) */
  component?: string;
  /** Architecture context (JSON stringified) */
  architecture?: string;
  /** Project context */
  context: string;
  /** Existing code patterns to follow */
  existingCode?: string;
  /** Target language */
  targetLanguage: 'typescript' | 'javascript' | 'json' | 'yaml';
  /** Constraints for generation */
  constraints?: string[];
  /** Continue from previous generation */
  thoughtSignature?: string;
}

/**
 * Response from code generation
 */
export interface CodeGenerationGeminiResponse {
  files: Array<{
    path: string;
    content: string;
    language: 'typescript' | 'javascript' | 'json' | 'yaml' | 'dockerfile' | 'markdown';
    purpose: string;
    isNew: boolean;
  }>;
  dependencies: Array<{
    name: string;
    version: string;
    purpose: string;
    devOnly: boolean;
  }>;
  explanation: string;
  integrationNotes?: string;
}

/**
 * Request to fix code
 */
export interface CodeFixGeminiRequest {
  /** Original code */
  code: string;
  /** Errors to fix */
  errors: string;
  /** File language */
  language: 'typescript' | 'javascript';
  /** Context about the code */
  context?: string;
  /** Previous fix attempts */
  previousAttempts?: number;
  /** Continue from previous reasoning */
  thoughtSignature?: string;
}

/**
 * Response from code fix
 */
export interface CodeFixGeminiResponse {
  fixedCode: string;
  explanation: string;
  allErrorsFixed: boolean;
  remainingErrors?: string[];
}

/**
 * Request to generate tests
 */
export interface TestGenerationGeminiRequest {
  /** Component specification (JSON stringified) */
  component: string;
  /** Generated code to test (JSON stringified) */
  code: string;
  /** Test framework */
  framework: 'vitest' | 'jest';
  /** Coverage target percentage */
  coverageTarget?: number;
  /** Thought signature from previous AI reasoning for continuity */
  thoughtSignature?: string;
}

/**
 * Response from test generation
 */
export interface TestGenerationGeminiResponse {
  files: Array<{
    path: string;
    content: string;
    language: 'typescript';
    purpose: string;
    isNew: boolean;
    covers: string[];
    framework: 'vitest' | 'jest';
    testCount: number;
    testTypes: ('unit' | 'integration' | 'e2e')[];
  }>;
  testCount: number;
  explanation: string;
}

/**
 * Request to generate ALL tests in a single call
 * Uses 1M context window for comprehensive test generation
 */
export interface AllTestsGenerationGeminiRequest {
  /** All components specification (JSON stringified) */
  allComponents: string;
  /** All generated code files (JSON stringified) */
  allCode: string;
  /** Test framework */
  framework: 'vitest' | 'jest';
  /** Coverage target percentage */
  coverageTarget?: number;
  /** Thought signature from previous AI reasoning for continuity */
  thoughtSignature?: string;
  /** V2: Schema context with field metadata for accurate test data (JSON stringified) */
  schemaContext?: string;
}

/**
 * Request to reconstruct incident from raw data
 */
export interface IncidentReconstructionGeminiRequest {
  /** Raw logs */
  logs?: string;
  /** Metrics data (JSON stringified) */
  metrics?: string;
  /** Screenshot descriptions or base64 data */
  screenshots?: string;
  /** Kubernetes events (JSON stringified) */
  events?: string;
  /** Deployment history (JSON stringified) */
  deployments?: string;
  /** Time range for reconstruction */
  timeRange: {
    start: string;
    end: string;
  };
  /** Previous thought signature for continuity */
  thoughtSignature?: string;
}

/**
 * Response from incident reconstruction
 */
export interface IncidentReconstructionGeminiResponse {
  timeline: Array<{
    timestamp: string;
    event: string;
    service: string;
    severity: 'info' | 'warning' | 'error' | 'critical';
    evidence: string;
    isKeyEvent?: boolean;
  }>;
  causalChain: Array<{
    id: string;
    event: string;
    causedBy: string | null;
    causedEvents: string[];
    relationship: 'direct' | 'cascading' | 'contributing';
  }>;
  rootCause: {
    description: string;
    confidence: number;
    evidence: string[];
    differentFromSymptoms: string;
  };
  recommendations: Array<{
    priority: 'high' | 'medium' | 'low';
    category: 'prevention' | 'detection' | 'response' | 'architecture';
    action: string;
    rationale: string;
    implementation: string;
  }>;
  narrative: string;
  dataQuality: {
    completeness: number;
    gaps: string[];
    recommendations: string[];
  };
}

/**
 * Request to learn pattern from incident
 */
export interface PatternLearningGeminiRequest {
  /** Incident details (JSON stringified) */
  incident: string;
  /** Resolution details (JSON stringified) */
  resolution: string;
  /** Existing patterns to avoid duplicating (JSON stringified) */
  existingPatterns?: string;
}

/**
 * Response from pattern learning
 */
export interface PatternLearningGeminiResponse {
  patterns: Array<{
    type: 'detection' | 'diagnostic' | 'resolution' | 'prevention';
    name: string;
    description: string;
    triggerConditions: Array<{
      signal: string;
      threshold: string;
      source: 'logs' | 'metrics' | 'events' | 'visual';
    }>;
    recommendedActions: Array<{
      action: string;
      when: string;
      expectedOutcome: string;
    }>;
    confidence: number;
    applicability: string;
    exceptions: string[];
  }>;
  insights: string[];
  improvementSuggestions: string[];
}

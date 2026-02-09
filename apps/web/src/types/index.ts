/**
 * Core type definitions for ChronosOps frontend
 */

// OODA States
export type OODAState =
  | 'IDLE'
  | 'OBSERVING'
  | 'ORIENTING'
  | 'DECIDING'
  | 'ACTING'
  | 'VERIFYING'
  | 'DONE'
  | 'FAILED';

// Incident types
export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'active' | 'investigating' | 'mitigating' | 'resolved' | 'closed';

export interface Incident {
  id: string;
  title: string;
  description: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  state: OODAState;
  namespace: string;
  monitoredAppId: string | null; // Direct link to MonitoredApp for investigation targeting
  startedAt: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  thumbnail: string | null;
}

export interface CreateIncidentRequest {
  title: string;
  description?: string;
  severity: IncidentSeverity;
  namespace: string;
  monitoredAppId?: string; // Link to specific monitored application
}

// Evidence types
export type EvidenceType = 'video_frame' | 'log' | 'metric' | 'k8s_event' | 'user_report';

export interface Evidence {
  id: string;
  incidentId: string;
  type: EvidenceType;
  source: string;
  content: Record<string, unknown>;
  timestamp: string;
  confidence: number | null;
  metadata: EvidenceMetadata | null;
  createdAt: string;
}

// Evidence metadata types for different evidence types
export interface EvidenceMetadata {
  frameImage?: string; // Base64 encoded frame image
  frameMimeType?: string;
  frameTimestamp?: string;
  analysisText?: string;
  firstSeenInFrame?: number;
  panelStates?: PanelState[];
  temporalAnalysis?: TemporalAnalysis;
  changeFromBaseline?: number;
}

export interface PanelState {
  name: string;
  status: 'normal' | 'warning' | 'error' | 'unknown';
  description?: string;
}

export interface TemporalAnalysis {
  framesAnalyzed: number;
  timeSpanSeconds: number;
  anomalyOnset?: {
    frameNumber: number;
    timestamp: string;
    description: string;
  };
  trendDirection: 'improving' | 'deteriorating' | 'stable' | 'fluctuating';
  changesSummary: Array<{
    fromFrame: number;
    toFrame: number;
    change: string;
    significance: 'low' | 'medium' | 'high';
  }>;
  correlatedChanges: string[];
}

// Hypothesis types
export type HypothesisStatus = 'proposed' | 'testing' | 'confirmed' | 'rejected';

export interface Hypothesis {
  id: string;
  incidentId: string;
  rootCause: string;
  confidence: number;
  status: HypothesisStatus;
  supportingEvidence: string[];
  contradictingEvidence: string[];
  suggestedActions: string[];
  testingSteps: string[];
  createdAt: string;
  updatedAt: string;
}

// Action types
export type ActionType = 'rollback' | 'restart' | 'scale' | 'code_fix' | 'manual';
export type ActionStatus = 'pending' | 'executing' | 'completed' | 'failed';

export interface Action {
  id: string;
  incidentId: string;
  hypothesisId: string;
  type: ActionType;
  target: string;
  parameters: Record<string, unknown>;
  status: ActionStatus;
  result: string | null;
  dryRun: boolean;
  executedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

// Investigation types
export interface Investigation {
  incidentId: string;
  startedAt: string;
  phase: OODAState;
  durationMs?: number;
}

// Timeline types
export interface TimelineEvent {
  id: string;
  timestamp: string;
  type: 'evidence' | 'hypothesis' | 'action' | 'phase_change' | 'verification';
  phase: OODAState;
  title: string;
  description?: string | null;
  confidence?: number;
  details?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

// Thought state types
export interface ThoughtState {
  id: string;
  incidentId: string;
  phase: OODAState;
  signature: string | null;
  signatureHash: string | null;
  thinkingBudget: number;
  tokensUsed: number | null;
  summary: string | null;
  insights: string[] | null;
  createdAt: string;
}

// Postmortem types
export interface Postmortem {
  id: string;
  incidentId: string;
  summary: string;
  timeline: string[];
  rootCauseAnalysis: string;
  impactAnalysis: string;
  actionsTaken: string[];
  lessonsLearned: string[];
  preventionRecommendations: string[];
  markdown: string;
  createdAt: string;
}

// Frame types
export interface FrameData {
  imageData: string; // base64
  timestamp: Date;
  frameNumber: number;
}

export interface FrameAnnotation {
  id: string;
  type: 'anomaly' | 'highlight' | 'marker';
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  confidence?: number;
}

export interface AnomalyDetection {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  confidence: number;
  location?: { x: number; y: number };
}

// Connection status types
export type ConnectionState = 'connected' | 'disconnected' | 'reconnecting' | 'error';

// Alias for component usage
export type ServiceStatus = ConnectionState;

export interface ConnectionStatus {
  api: ServiceStatus;
  websocket: ServiceStatus;
  vision: ServiceStatus;
  kubernetes: ServiceStatus;
}

// API response types
export interface ApiResponse<T> {
  data: T;
}

export interface ApiError {
  error: string;
  message?: string;
  details?: Record<string, unknown>;
}

// Development Phase types
export type DevelopmentPhase =
  | 'IDLE'
  | 'ANALYZING'
  | 'DESIGNING'
  | 'CODING'
  | 'TESTING'
  | 'BUILDING'
  | 'DEPLOYING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'FAILED';

export type DevelopmentCycleStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface DevelopmentCycle {
  id: string;
  phase: DevelopmentPhase;
  requirementSource: 'user' | 'incident' | 'improvement' | 'pattern';
  requirementRaw: string;
  requirementPriority: 'low' | 'medium' | 'high' | 'critical';
  analyzedRequirement: AnalyzedRequirement | null;
  architecture: ArchitectureDesign | null;
  architectureDiagramUrl: string | null;
  generatedCodeSummary: GeneratedCodeSummary | null;
  testResults: TestResults | null;
  buildResult: BuildResult | null;
  deployment: DeploymentResult | null;
  verification: VerificationResult | null;
  triggeredByIncidentId: string | null;
  iterations: number;
  maxIterations: number;
  error: DevelopmentError | null;
  thoughtSignature: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  // Computed by API
  isRunning?: boolean;
  runStatus?: { startedAt: string; phase: string } | null;
  files?: GeneratedFile[];
}

export interface GeneratedCodeSummary {
  totalFiles: number;
  byLanguage: Record<string, number>;
  components: string[];
  entryPoint: string;
  description: string;
}

export interface DevelopmentError {
  phase: DevelopmentPhase;
  message: string;
  details?: string;
  stack?: string;
}

export interface AnalyzedRequirement {
  // Core fields from Gemini analysis
  type?: string;
  title?: string;
  description: string;
  acceptanceCriteria?: string[];
  estimatedComplexity?: 'low' | 'moderate' | 'high' | 'simple' | 'complex';
  suggestedApproach?: string;
  requiredCapabilities?: string[];
  potentialRisks?: string[];
  relatedPatterns?: string[];
  targetFiles?: string[];
  // Legacy fields for backward compatibility
  functionalRequirements?: string[];
  nonFunctionalRequirements?: string[];
  constraints?: string[];
  suggestedComponents?: string[];
  priority?: 'low' | 'medium' | 'high' | 'critical';
  complexity?: 'simple' | 'moderate' | 'complex' | 'low' | 'high';
  estimatedEffort?: string;
}

export interface ArchitectureDesign {
  overview: string;
  components?: ComponentSpec[];
  // dataFlow can be string (from API) or array (legacy)
  dataFlow?: DataFlowStep[] | string;
  dependencies?: Dependency[];
  externalDependencies?: ExternalDependency[];
  deploymentStrategy?: string;
  scalingConsiderations?: string[];
  securityConsiderations?: string[];
  performanceConsiderations?: string[];
  testingStrategy?: string;
}

export interface ExternalDependency {
  name: string;
  version: string;
  purpose: string;
  devOnly?: boolean;
}

export interface ComponentSpec {
  name: string;
  type: 'service' | 'library' | 'api' | 'worker' | 'database' | 'config';
  description?: string;
  purpose?: string;
  suggestedPath?: string;
  errorHandling?: string;
  // New API fields
  interface?: ComponentInterface[];
  dependsOn?: string[];
  internalState?: string[];
  testRequirements?: string[];
  // Legacy fields
  responsibilities?: string[];
  interfaces?: InterfaceSpec[];
  dependencies?: string[];
}

export interface ComponentInterface {
  name: string;
  description?: string;
  parameters?: { name: string; type: string; optional?: boolean; description?: string }[];
  returnType?: string;
  async?: boolean;
}

export interface InterfaceSpec {
  name: string;
  type: 'function' | 'class' | 'api' | 'event';
  description: string;
  signature?: string;
}

export interface DataFlowStep {
  from: string;
  to: string;
  description: string;
  dataType: string;
}

export interface Dependency {
  name: string;
  version: string;
  purpose: string;
}

export interface BuildResult {
  success: boolean;
  stages: BuildStage[];
  testResults: TestResults | null;
  imageTag: string | null;
  logs: string[];
  duration: number;
}

export interface BuildStage {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt: string | null;
  completedAt: string | null;
  logs: string[];
}

export interface TestResults {
  passed: number;
  failed: number;
  skipped: number;
  coverage: number;
  duration: number;
  failures: TestFailure[];
}

export interface TestFailure {
  testName: string;
  error: string;
  stack?: string;
}

export interface DeploymentResult {
  success: boolean;
  namespace: string;
  deployment?: string;       // Legacy field name
  deploymentName?: string;   // Actual API field name
  serviceName?: string;
  serviceUrl?: string;  // Live accessible URL
  servicePort?: number;
  imageTag?: string;
  image?: string;       // Actual API field name for image
  replicas: number;
  availableReplicas: number;
  podStatus?: string;
  status?: string;      // Actual API field name for status
  healthCheck?: {
    passed: boolean;
    endpoint: string;
    response?: string;
    statusCode?: number;
  };
  logs?: string[];
  deployedAt?: string;
}

export interface VerificationResult {
  success: boolean;
  checks: VerificationCheck[];
  summary: string;
  duration: number;
}

export interface VerificationCheck {
  name: string;
  type: string; // 'pod_status' | 'health_check' | 'api_endpoint' | 'frontend_static' | 'frontend_api_proxy'
  passed: boolean;
  confidence?: number;
  duration?: number;
  details?: Record<string, unknown>;
  // Legacy fields (optional)
  expected?: string;
  actual?: string;
}

export interface GeneratedFile {
  id: string;
  developmentCycleId: string;
  path: string;
  content: string;
  language: string;
  purpose: string;
  isNew: boolean;
  isTest: boolean;
  createdAt: string;
  updatedAt: string;
}

// Service types for multi-service architecture
export type ServiceType = 'backend' | 'frontend' | 'fullstack';

// Storage mode for database persistence
export type StorageMode = 'memory' | 'sqlite' | 'postgres';

export interface FrontendConfig {
  framework: 'react' | 'vue';
  bundler: 'vite' | 'webpack';
  consumesServices: string[];
  styling: 'tailwind' | 'css-modules' | 'styled-components';
  stateManagement: 'tanstack-query' | 'zustand' | 'redux';
}

export interface CreateDevelopmentCycleRequest {
  requirement: string;
  sourceIncidentId?: string;
  triggeredByHypothesisId?: string;
  serviceType?: ServiceType;
  frontendConfig?: FrontendConfig;
  storageMode?: StorageMode;
}

// Service registry types
export interface ServiceSummary {
  id: string;
  name: string;
  displayName: string;
  serviceType: ServiceType;
  serviceUrl: string;
  status: 'active' | 'degraded' | 'unavailable' | 'retired';
  endpointCount: number;
  endpointPreviews: string[];
}

// Intelligence types
export type PatternType = 'detection' | 'diagnostic' | 'resolution' | 'prevention';

export interface LearnedPattern {
  id: string;
  type: PatternType;
  name: string;
  description: string;
  triggerConditions: string[];
  recommendedActions: string[];
  confidence: number;
  applicability: string;
  exceptions: string[];
  sourceIncidentId: string | null;
  timesMatched: number;
  timesApplied: number;
  successRate: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReconstructedIncident {
  id: string;
  incidentId: string | null;
  timeRangeStart: string;
  timeRangeEnd: string;
  timeline: ReconstructionTimelineEntry[];
  causalChain: CausalLink[];
  rootCause: string;
  recommendations: string[];
  narrative: string;
  dataQuality: DataQualityInfo;
  inputTokensUsed: number;
  createdAt: string;
}

export interface ReconstructionTimelineEntry {
  timestamp: string;
  category: string;
  summary: string;
  details: string;
  significance: 'low' | 'medium' | 'high' | 'critical';
  relatedEntities: string[];
}

export interface CausalLink {
  from: string;
  to: string;
  relationship: string;
  confidence: number;
  evidence: string[];
}

export interface DataQualityInfo {
  // Backend fields (actual data from API)
  logsAvailable?: boolean;
  metricsAvailable?: boolean;
  eventsAvailable?: boolean;
  screenshotsAvailable?: boolean;
  confidenceScore?: number;
  // Legacy fields (for backwards compatibility)
  completeness?: number;
  consistency?: number;
  // Common fields
  gaps: string[];
  recommendations?: string[];
}

export interface PatternMatch {
  pattern: LearnedPattern;
  score: number;
  explanation: string;
  matchedConditions: string[];
}

export interface KnowledgeBaseStats {
  totalPatterns: number;
  byType: Record<PatternType, number>;
  highConfidenceCount: number;
  mostApplied: Array<{
    patternId: string;
    name: string;
    timesApplied: number;
    successRate: number | null;
  }>;
}

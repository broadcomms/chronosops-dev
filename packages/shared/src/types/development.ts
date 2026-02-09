/**
 * Development cycle types for self-regenerating app ecosystem
 */

// ===========================================
// Model Assignment Types
// ===========================================

/**
 * AI tasks that can be assigned to different models
 * This enables fine-grained control over model usage for cost/quality optimization
 */
export const AI_TASKS = {
  // ANALYZING phase
  REQUIREMENT_ANALYSIS: 'requirementAnalysis',
  
  // DESIGNING phase
  ARCHITECTURE_DESIGN: 'architectureDesign',
  
  // CODING phase
  CODE_GENERATION: 'codeGeneration',
  CODE_FIX: 'codeFix',
  TEST_GENERATION: 'testGeneration',
  
  // VERIFYING phase
  ANOMALY_DETECTION: 'anomalyDetection',
  
  // Investigation OODA
  FRAME_ANALYSIS: 'frameAnalysis',
  LOG_ANALYSIS: 'logAnalysis',
  HYPOTHESIS_GENERATION: 'hypothesisGeneration',
  INCIDENT_RECONSTRUCTION: 'incidentReconstruction',
  PATTERN_LEARNING: 'patternLearning',
  POSTMORTEM_GENERATION: 'postmortemGeneration',
} as const;

export type AITask = (typeof AI_TASKS)[keyof typeof AI_TASKS];

/**
 * Model tier selection for each AI task
 * - 'flash': Use the faster/cheaper flash model (GEMINI_MODEL)
 * - 'pro': Use the more capable pro model (GEMINI_PRO_MODEL)
 */
export type ModelTier = 'flash' | 'pro';

/**
 * Model assignment configuration mapping each AI task to a model tier
 * This is configurable per-task for fine-tuning cost vs quality
 */
export type ModelAssignments = Record<AITask, ModelTier>;

/**
 * Default model assignments optimized for production use:
 * - Pro model for complex tasks (analysis, architecture, code generation)
 * - Flash model for simpler/faster tasks (log analysis, pattern learning)
 */
export const DEFAULT_MODEL_ASSIGNMENTS: ModelAssignments = {
  // Complex tasks → Pro model
  requirementAnalysis: 'flash',
  architectureDesign: 'flash',
  codeGeneration: 'flash',
  codeFix: 'pro',
  testGeneration: 'flash',
  hypothesisGeneration: 'flash',
  incidentReconstruction: 'pro',
  postmortemGeneration: 'flash',

  // Faster tasks → Flash model
  frameAnalysis: 'flash',
  logAnalysis: 'flash',
  anomalyDetection: 'flash',
  patternLearning: 'flash',
};

// ===========================================
// Temperature Assignment Types
// ===========================================

/**
 * Temperature assignments per AI task (0.0-2.0)
 * Lower temperatures = more deterministic/consistent output
 * Higher temperatures = more creative/varied output
 */
export type TemperatureAssignments = Record<AITask, number>;

/**
 * Default temperature assignments optimized for each task type:
 * - Lower temps (0.1-0.2): Precise tasks needing consistency (code generation, fixes)
 * - Medium temps (0.3-0.4): Balanced tasks (analysis, testing, pattern learning)
 * - Higher temps (0.5-0.6): Creative tasks (architecture design, hypothesis generation)
 */
export const DEFAULT_TEMPERATURE_ASSIGNMENTS: TemperatureAssignments = {
  // ANALYZING phase - moderate for interpretation flexibility
  requirementAnalysis: 0.3,

  // DESIGNING phase - higher for creative architecture decisions
  architectureDesign: 0.6,

  // CODING phase - lower for consistent, correct code
  codeGeneration: 0.2,
  codeFix: 0.1, // Lowest - precise deterministic fixes
  testGeneration: 0.3, // Moderate for diverse test coverage

  // Investigation OODA
  frameAnalysis: 0.3, // Moderate for visual analysis
  logAnalysis: 0.2, // Lower for accurate pattern matching
  hypothesisGeneration: 0.5, // Higher for creative root cause analysis
  incidentReconstruction: 0.4, // Moderate - balanced
  patternLearning: 0.4, // Moderate
  postmortemGeneration: 0.5, // Higher for varied documentation

  // VERIFYING phase
  anomalyDetection: 0.3, // Lower for consistent thresholds
};

// Development Phases (OODA loop for development)
export const DEVELOPMENT_PHASES = {
  IDLE: 'IDLE',
  ANALYZING: 'ANALYZING',
  DESIGNING: 'DESIGNING',
  CODING: 'CODING',
  TESTING: 'TESTING',
  BUILDING: 'BUILDING',
  DEPLOYING: 'DEPLOYING',
  VERIFYING: 'VERIFYING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

export type DevelopmentPhase = (typeof DEVELOPMENT_PHASES)[keyof typeof DEVELOPMENT_PHASES];

// ===========================================
// Per-Phase Retry Configuration Types
// ===========================================

/**
 * Per-phase retry state tracking
 * Maps each phase to the number of retries attempted
 */
export type PhaseRetryState = Partial<Record<DevelopmentPhase, number>>;

/**
 * Configuration for per-phase retry limits
 * Allows fine-grained control over retry behavior per phase
 */
export interface PhaseRetryConfig {
  /** Default retry limit for all phases */
  defaultRetries: number;
  /** Override retry limits for specific phases */
  perPhase?: Partial<Record<DevelopmentPhase, number>>;
}

/**
 * Default phase retry configuration
 * - Early phases (ANALYZING, DESIGNING): Higher retries since Gemini timeouts are recoverable
 * - Middle phases (CODING, TESTING, BUILDING): Standard retries
 * - Late phases (DEPLOYING, VERIFYING): Lower retries since they're more deterministic
 */
export const DEFAULT_PHASE_RETRY_CONFIG: PhaseRetryConfig = {
  defaultRetries: 3,
  perPhase: {
    ANALYZING: 3,   // Gemini API calls can timeout
    DESIGNING: 3,   // Gemini API calls can timeout
    CODING: 4,      // Code generation may need multiple attempts
    TESTING: 2,     // Tests are more deterministic
    BUILDING: 2,    // Build failures usually need code fixes
    DEPLOYING: 2,   // K8s operations are usually deterministic
    VERIFYING: 1,   // Verification failures usually need real fixes
  },
};

// ===========================================
// Multi-Service Architecture Types
// ===========================================

/**
 * Service Types for multi-service architecture
 * - backend: REST API / GraphQL backend service
 * - frontend: React/Vue frontend application
 * - fullstack: Backend + Frontend bundled together
 */
export const SERVICE_TYPES = {
  BACKEND: 'backend',
  FRONTEND: 'frontend',
  FULLSTACK: 'fullstack',
} as const;

export type ServiceType = (typeof SERVICE_TYPES)[keyof typeof SERVICE_TYPES];

/**
 * Frontend framework options
 */
export const FRONTEND_FRAMEWORKS = {
  REACT: 'react',
  VUE: 'vue',
} as const;

export type FrontendFramework = (typeof FRONTEND_FRAMEWORKS)[keyof typeof FRONTEND_FRAMEWORKS];

/**
 * Frontend styling options
 */
export const FRONTEND_STYLING = {
  TAILWIND: 'tailwind',
  CSS_MODULES: 'css-modules',
  STYLED_COMPONENTS: 'styled-components',
} as const;

export type FrontendStyling = (typeof FRONTEND_STYLING)[keyof typeof FRONTEND_STYLING];

/**
 * State management options for frontend
 */
export const STATE_MANAGEMENT = {
  TANSTACK_QUERY: 'tanstack-query',
  ZUSTAND: 'zustand',
  REDUX: 'redux',
} as const;

export type StateManagement = (typeof STATE_MANAGEMENT)[keyof typeof STATE_MANAGEMENT];

/**
 * Frontend configuration for frontend/fullstack service types
 */
export interface FrontendConfig {
  /** Frontend framework to use */
  framework: FrontendFramework;
  /** Module bundler */
  bundler: 'vite' | 'webpack';
  /** Backend services this frontend consumes (service IDs) */
  consumesServices: string[];
  /** Styling approach */
  styling: FrontendStyling;
  /** State management library */
  stateManagement: StateManagement;
}

/**
 * Represents a complete development cycle from requirement to deployment
 */
export interface DevelopmentCycle {
  /** Unique identifier for the development cycle */
  id: string;

  /** Current phase of the development cycle */
  phase: DevelopmentPhase;

  /** Service type: backend, frontend, or fullstack */
  serviceType: ServiceType;

  /** Frontend configuration (for frontend/fullstack types) */
  frontendConfig?: FrontendConfig;

  /** Storage mode for database persistence: memory, sqlite, or postgres */
  storageMode?: 'memory' | 'sqlite' | 'postgres';

  /** Original requirement that triggered this cycle */
  requirement: Requirement;

  /** Analyzed and structured requirement */
  analyzedRequirement?: AnalyzedRequirement;

  /** Architecture design for this feature */
  architecture?: ArchitectureDesign;

  /** Generated Zod schema (contract-first, V2 pipeline) */
  generatedSchema?: GeneratedSchema;

  /** Generated code artifacts */
  generatedCode?: GeneratedCode;

  /** Test results from running generated tests */
  testResults?: TestResults;

  /** Build artifacts and results */
  buildResult?: BuildResult;

  /** Deployment information */
  deployment?: DeploymentInfo;

  /** Verification results after deployment */
  verification?: VerificationResult;

  /** Link to incident that triggered this cycle (if any) */
  triggeredByIncidentId?: string;

  /** Number of retry iterations (legacy global counter) */
  iterations: number;

  /** Maximum allowed iterations (legacy global limit) */
  maxIterations: number;

  /** Per-phase retry state for resilient self-healing */
  phaseRetries?: PhaseRetryState;

  /** Timestamps for tracking */
  createdAt: string;
  updatedAt: string;
  completedAt?: string;

  /** Error information if cycle failed */
  error?: DevelopmentError;

  /** Thought signature for reasoning continuity */
  thoughtSignature?: string;
}

export interface DevelopmentError {
  phase: DevelopmentPhase;
  message: string;
  details?: unknown;
  recoverable: boolean;
}

// Import types from other modules (forward declarations)
import type { Requirement, AnalyzedRequirement } from './requirement.js';
import type { ArchitectureDesign } from './architecture.js';
import type { GeneratedCode } from './generated-code.js';
import type { TestResults, BuildResult, DeploymentInfo, VerificationResult } from './build.js';
import type { GeneratedSchema } from './generated-schema.js';

// Re-export for convenience
export type {
  Requirement,
  AnalyzedRequirement,
  ArchitectureDesign,
  GeneratedCode,
  GeneratedSchema,
  TestResults,
  BuildResult,
  DeploymentInfo,
  VerificationResult,
};

/**
 * Configuration for development orchestrator
 */
export interface DevelopmentConfig {
  /** Enable development orchestrator */
  enabled: boolean;

  /** Maximum concurrent development cycles */
  maxConcurrentCycles: number;

  /** Maximum iterations per cycle */
  maxIterations: number;

  /** Timeout for each phase in milliseconds */
  phaseTimeouts: {
    analyzing: number;
    designing: number;
    coding: number;
    testing: number;
    building: number;
    deploying: number;
    verifying: number;
  };

  /** Code generation settings */
  codeGeneration: {
    /** Maximum retries for code fix */
    maxFixRetries: number;
    /** Required test coverage percentage */
    requiredCoverage: number;
    /** Test framework to use */
    testFramework: 'vitest' | 'jest';
    /** Enable fault injection endpoints (/bugs/*) in generated apps for testing */
    enableFaultInjection: boolean;
    /** Enable prompt injection testing - bypass 500 errors when requirement contains key phrase */
    enablePromptInjectionTesting: boolean;
  };

  /** Build settings */
  build: {
    /** Docker registry for images */
    registry: string;
    /** Base image for Dockerfiles */
    baseImage: string;
    /** Enable layer caching */
    enableCache: boolean;
    /** Build mode: 'docker' for local Docker, 'kaniko' for in-cluster builds */
    buildMode?: 'docker' | 'kaniko';
    /** Kaniko configuration (required when buildMode is 'kaniko') */
    kaniko?: {
      /** Namespace to run Kaniko jobs in */
      namespace: string;
      /** Service account for Kaniko jobs */
      serviceAccount?: string;
      /** Kaniko executor image version */
      executorImage?: string;
      /** Job timeout in seconds */
      jobTimeoutSeconds?: number;
    };
  };

  /** Deployment settings */
  deployment: {
    /** Target namespace */
    namespace: string;
    /** Default replica count */
    defaultReplicas: number;
    /** Resource limits */
    resources: {
      cpu: string;
      memory: string;
    };
    /** Health check settings */
    healthCheck: {
      path: string;
      initialDelaySeconds: number;
      periodSeconds: number;
    };
  };

  /** Per-phase retry configuration for resilient self-healing */
  phaseRetries: PhaseRetryConfig;
}

export const DEFAULT_DEVELOPMENT_CONFIG: DevelopmentConfig = {
  enabled: true,
  maxConcurrentCycles: 3,
  maxIterations: 5,
  phaseTimeouts: {
    analyzing: 600000, // 10 minutes - Gemini 3 models can be slower
    designing: 600000, // 10 minutes - architecture design can be complex
    coding: 900000,    // 15 minutes - includes code gen + validation + fixing + Gemini retries with backoff
    testing: 180000,
    building: 300000,
    deploying: 180000,
    verifying: 60000,
  },
  codeGeneration: {
    maxFixRetries: 3,
    requiredCoverage: 80,
    testFramework: 'vitest',
    enableFaultInjection: false,
    enablePromptInjectionTesting: false,
  },
  build: {
    registry: 'localhost:5000',
    baseImage: 'node:20-alpine',
    enableCache: true,
  },
  deployment: {
    namespace: 'development',
    defaultReplicas: 1,
    resources: {
      cpu: '500m',
      memory: '512Mi',
    },
    healthCheck: {
      path: '/health',
      initialDelaySeconds: 10,
      periodSeconds: 5,
    },
  },
  phaseRetries: DEFAULT_PHASE_RETRY_CONFIG,
};

/**
 * Verification Layer Types
 * Types for action verification and success/failure confirmation
 */

import type { Metric } from '../ingestion/types.js';

// ===========================================
// Verification Strategy Types
// ===========================================

export type VerificationStrategy =
  | 'metric_comparison'
  | 'log_analysis'
  | 'visual_confirmation'
  | 'health_check'
  | 'synthetic_probe'
  | 'multi_modal';

export interface VerificationConfig {
  strategy: VerificationStrategy;
  timeoutMs: number;
  retryAttempts: number;
  retryDelayMs: number;
  successThreshold: number;  // 0.0 - 1.0, confidence required to declare success
  cooldownMs: number;        // Wait time after action before verifying
  enableVisualVerification: boolean;
  enableMetricVerification: boolean;
  enableLogVerification: boolean;
}

export const DEFAULT_VERIFICATION_CONFIG: VerificationConfig = {
  strategy: 'multi_modal',
  timeoutMs: 120000,      // 2 minutes
  retryAttempts: 3,
  retryDelayMs: 10000,    // 10 seconds
  successThreshold: 0.7,
  cooldownMs: 15000,      // 15 seconds
  enableVisualVerification: true,
  enableMetricVerification: true,
  enableLogVerification: true,
};

// ===========================================
// Verification Check Types
// ===========================================

export type CheckStatus = 'pending' | 'running' | 'passed' | 'failed' | 'inconclusive';

export interface VerificationCheck {
  id: string;
  name: string;
  description: string;
  strategy: VerificationStrategy;
  status: CheckStatus;
  startedAt?: Date;
  completedAt?: Date;
  result?: {
    passed: boolean;
    confidence: number;
    details: string;
    evidence: string[];
  };
  error?: string;
}

// ===========================================
// Metric Verification Types
// ===========================================

export interface MetricVerificationInput {
  metricName: string;
  preActionValue: number;
  expectedImprovement: 'increase' | 'decrease' | 'stabilize';
  thresholdPercent?: number;  // How much change to consider successful
  absoluteThreshold?: number; // Alternative: absolute value threshold
}

export interface MetricVerificationResult {
  metricName: string;
  preActionValue: number;
  postActionValue: number;
  changePercent: number;
  expectedImprovement: string;
  met: boolean;
  confidence: number;
  details: string;
}

// ===========================================
// Log Verification Types
// ===========================================

export interface LogVerificationInput {
  successPatterns: string[];   // Patterns indicating success
  failurePatterns: string[];   // Patterns indicating failure
  source?: string;             // Log source to filter
  timeWindowMs: number;        // How far back to look
}

export interface LogVerificationResult {
  successPatternsFound: string[];
  failurePatternsFound: string[];
  totalLogsAnalyzed: number;
  successIndicators: number;
  failureIndicators: number;
  verdict: 'success' | 'failure' | 'inconclusive';
  confidence: number;
  sampleLogs: string[];
}

// ===========================================
// Visual Verification Types
// ===========================================

export interface VisualVerificationInput {
  preActionFrameId?: string;
  expectedChanges: string[];   // Natural language descriptions
  dashboardUrl?: string;
}

export interface VisualVerificationResult {
  changesObserved: string[];
  expectedChangesMet: Array<{
    expected: string;
    observed: boolean;
    confidence: number;
    details: string;
  }>;
  overallHealth: 'healthy' | 'degraded' | 'critical';
  previousHealth?: 'healthy' | 'degraded' | 'critical';
  improvement: boolean;
  confidence: number;
  frameId?: string;
}

// ===========================================
// Health Check Types
// ===========================================

export interface HealthCheckInput {
  endpoint?: string;
  expectedStatusCodes?: number[];
  expectedResponsePattern?: string;
  podSelector?: {
    namespace: string;
    labels?: Record<string, string>;
    name?: string;
  };
}

export interface HealthCheckResult {
  healthy: boolean;
  podsChecked: number;
  healthyPods: number;
  unhealthyPods: Array<{
    name: string;
    reason: string;
    status: string;
  }>;
  httpCheck?: {
    statusCode: number;
    responseTime: number;
    healthy: boolean;
  };
  confidence: number;
  details: string;
}

// ===========================================
// Comprehensive Verification Result
// ===========================================

export interface VerificationResult {
  id: string;
  actionId: string;
  incidentId: string;
  timestamp: Date;

  // Overall result
  success: boolean;
  confidence: number;
  verdict: 'confirmed_success' | 'confirmed_failure' | 'partial_success' | 'inconclusive';

  // Individual check results
  checks: VerificationCheck[];
  metricVerification?: MetricVerificationResult[];
  logVerification?: LogVerificationResult;
  visualVerification?: VisualVerificationResult;
  healthCheck?: HealthCheckResult;

  // Timing
  verificationStartedAt: Date;
  verificationCompletedAt: Date;
  durationMs: number;

  // Analysis
  summary: string;
  recommendations: string[];
  shouldRetry: boolean;
  retryReason?: string;

  // Next steps
  suggestedNextAction?: {
    type: string;
    target: string;
    reasoning: string;
  };
}

// ===========================================
// Verification Service Config
// ===========================================

export interface VerificationServiceConfig {
  defaultConfig: VerificationConfig;
  metricsSource?: string;       // Prometheus/metrics endpoint
  logSource?: string;           // Log aggregator endpoint
  dashboardCapture?: string;    // Screen capture service URL
  kubernetesEnabled: boolean;
  geminiEnabled: boolean;
}

// ===========================================
// Gemini Verification Types
// ===========================================

export interface GeminiVerificationRequest {
  incidentId: string;
  action: {
    type: string;
    target: string;
    description: string;
  };
  preActionState: {
    metrics?: Metric[];
    logSamples?: string[];
    dashboardFrame?: string;  // Base64 encoded image
  };
  postActionState: {
    metrics?: Metric[];
    logSamples?: string[];
    dashboardFrame?: string;
  };
  expectedOutcome: string;
  thoughtSignature?: string;
}

export interface GeminiVerificationResponse {
  success: boolean;
  confidence: number;
  verdict: string;
  analysis: {
    metricChanges: string;
    logAnalysis: string;
    visualChanges: string;
  };
  improvements: string[];
  regressions: string[];
  recommendations: string[];
  shouldRetry: boolean;
  retryReason?: string;
  thoughtSignature?: string;
}

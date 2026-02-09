/**
 * Rollback Manager Types
 * Types for managing automated and manual rollback operations
 */

import type { VerificationResult } from '../verification/types.js';

// ===========================================
// Rollback Decision Types
// ===========================================

export type RollbackTrigger =
  | 'verification_failure'
  | 'metric_regression'
  | 'error_spike'
  | 'health_check_failure'
  | 'manual_request'
  | 'timeout'
  | 'cascade_protection';

export type RollbackStatus =
  | 'pending'
  | 'approved'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface RollbackDecision {
  id: string;
  timestamp: Date;
  trigger: RollbackTrigger;
  confidence: number;
  reasoning: string;
  shouldRollback: boolean;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  affectedResources: RollbackTarget[];
  estimatedImpact: string;
  alternativeActions?: string[];
}

// ===========================================
// Rollback Target Types
// ===========================================

export interface RollbackTarget {
  type: 'deployment' | 'configmap' | 'service' | 'ingress';
  name: string;
  namespace: string;
  currentRevision?: number;
  targetRevision?: number;
  currentImage?: string;
  targetImage?: string;
}

// ===========================================
// Rollback Request Types
// ===========================================

export interface RollbackRequest {
  id: string;
  incidentId: string;
  timestamp: Date;
  status: RollbackStatus;
  trigger: RollbackTrigger;
  targets: RollbackTarget[];
  reason: string;
  requestedBy: 'system' | 'user';
  approvedAt?: Date;
  approvedBy?: string;
  completedAt?: Date;
  result?: RollbackResult;
}

export interface RollbackResult {
  success: boolean;
  targets: Array<{
    target: RollbackTarget;
    success: boolean;
    message: string;
    previousRevision?: number;
    newRevision?: number;
    dryRun: boolean;
  }>;
  summary: string;
  duration: number;
  verificationRequired: boolean;
}

// ===========================================
// State Snapshot Types
// ===========================================

export interface DeploymentSnapshot {
  id: string;
  timestamp: Date;
  incidentId: string;
  deployments: Array<{
    name: string;
    namespace: string;
    revision: number;
    replicas: number;
    image: string;
    labels: Record<string, string>;
    annotations: Record<string, string>;
    containerSpecs: Array<{
      name: string;
      image: string;
      resources?: {
        limits?: Record<string, string>;
        requests?: Record<string, string>;
      };
      env?: Record<string, string>;
    }>;
  }>;
}

// ===========================================
// Rollback Policy Types
// ===========================================

export interface RollbackPolicy {
  autoRollbackEnabled: boolean;
  requireApproval: boolean;
  maxAutoRollbacksPerIncident: number;
  cooldownBetweenRollbacksMs: number;
  verificationTimeoutMs: number;
  rollbackTriggers: {
    onVerificationFailure: boolean;
    onMetricRegression: boolean;
    onErrorSpike: boolean;
    onHealthCheckFailure: boolean;
    onTimeout: boolean;
  };
  escalationThreshold: number; // Number of failed rollbacks before escalating
  protectedNamespaces: string[]; // Namespaces that require manual approval
  protectedDeployments: string[]; // Deployments that require manual approval
}

export const DEFAULT_ROLLBACK_POLICY: RollbackPolicy = {
  autoRollbackEnabled: true,
  requireApproval: false,
  maxAutoRollbacksPerIncident: 3,
  cooldownBetweenRollbacksMs: 120000, // 2 minutes
  verificationTimeoutMs: 300000, // 5 minutes
  rollbackTriggers: {
    onVerificationFailure: true,
    onMetricRegression: true,
    onErrorSpike: true,
    onHealthCheckFailure: true,
    onTimeout: false,
  },
  escalationThreshold: 2,
  protectedNamespaces: ['production', 'prod'],
  protectedDeployments: [],
};

// ===========================================
// Rollback Manager Config
// ===========================================

export interface RollbackManagerConfig {
  policy: RollbackPolicy;
  snapshotRetention: number; // Number of snapshots to keep per incident
  dryRunMode: boolean;
  enableCascadeProtection: boolean; // Prevent cascade failures
  notifyOnRollback: boolean;
}

export const DEFAULT_ROLLBACK_CONFIG: RollbackManagerConfig = {
  policy: DEFAULT_ROLLBACK_POLICY,
  snapshotRetention: 10,
  dryRunMode: true,
  enableCascadeProtection: true,
  notifyOnRollback: true,
};

// ===========================================
// Rollback History Types
// ===========================================

export interface RollbackHistoryEntry {
  request: RollbackRequest;
  result?: RollbackResult;
  preRollbackSnapshot?: DeploymentSnapshot;
  postRollbackSnapshot?: DeploymentSnapshot;
  verificationResult?: VerificationResult;
}

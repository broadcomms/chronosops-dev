/**
 * Rollback Manager
 * Manages automated and manual rollback operations with safety guards
 */

import { EventEmitter } from 'events';
import { createChildLogger } from '@chronosops/shared';
import type { ActionResult } from '../agents/executor/types.js';
import type { VerificationResult } from '../verification/types.js';
import {
  DEFAULT_ROLLBACK_CONFIG,
  DEFAULT_ROLLBACK_POLICY,
  type RollbackManagerConfig,
  type RollbackRequest,
  type RollbackResult,
  type RollbackDecision,
  type RollbackTarget,
  type RollbackTrigger,
  type RollbackHistoryEntry,
  type DeploymentSnapshot,
} from './types.js';

export class RollbackManager extends EventEmitter {
  private logger = createChildLogger({ component: 'RollbackManager' });
  private config: RollbackManagerConfig;
  private history: Map<string, RollbackHistoryEntry[]> = new Map();
  private snapshots: Map<string, DeploymentSnapshot[]> = new Map();
  private pendingApprovals: Map<string, RollbackRequest> = new Map();
  private rollbackCounts: Map<string, number> = new Map(); // incidentId -> count
  private lastRollbackTime: Map<string, Date> = new Map();

  // K8s client injection point
  private k8sClient?: {
    rollback: (request: {
      deployment: string;
      namespace: string;
      revision?: number;
      reason?: string;
    }) => Promise<{
      success: boolean;
      deployment: string;
      namespace: string;
      fromRevision: number;
      toRevision: number;
      dryRun: boolean;
      error?: string;
    }>;
    getDeployment: (name: string, namespace: string) => Promise<{
      name: string;
      namespace: string;
      replicas: number;
      revision: number;
      image: string;
    }>;
    listDeployments: (namespace: string) => Promise<Array<{
      name: string;
      namespace: string;
      replicas: number;
      revision: number;
      image: string;
    }>>;
  };

  constructor(config: Partial<RollbackManagerConfig> = {}) {
    super();
    this.config = {
      ...DEFAULT_ROLLBACK_CONFIG,
      ...config,
      policy: { ...DEFAULT_ROLLBACK_POLICY, ...config.policy },
    };
  }

  /**
   * Inject Kubernetes client for rollback operations
   */
  setK8sClient(client: typeof this.k8sClient): void {
    this.k8sClient = client;
  }

  /**
   * Evaluate whether a rollback is needed based on verification result
   */
  evaluateRollbackNeed(
    action: ActionResult,
    verification: VerificationResult,
    incidentId: string
  ): RollbackDecision {
    const decision: RollbackDecision = {
      id: `rbd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      trigger: this.determineTrigger(verification),
      confidence: 0,
      reasoning: '',
      shouldRollback: false,
      urgency: 'medium',
      affectedResources: [],
      estimatedImpact: '',
    };

    // Check if rollback triggers are enabled for this type
    const policy = this.config.policy;
    const trigger = decision.trigger;

    if (!this.isTriggerEnabled(trigger)) {
      decision.shouldRollback = false;
      decision.reasoning = `Rollback trigger '${trigger}' is disabled in policy`;
      this.emit('decisionMade', decision);
      return decision;
    }

    // Check rollback limits
    const rollbackCount = this.rollbackCounts.get(incidentId) ?? 0;
    if (rollbackCount >= policy.maxAutoRollbacksPerIncident) {
      decision.shouldRollback = false;
      decision.reasoning = `Maximum rollback limit reached (${rollbackCount}/${policy.maxAutoRollbacksPerIncident})`;
      decision.urgency = 'critical';
      this.emit('decisionMade', decision);
      return decision;
    }

    // Check cooldown
    const lastRollback = this.lastRollbackTime.get(incidentId);
    if (lastRollback) {
      const cooldownRemaining = policy.cooldownBetweenRollbacksMs - (Date.now() - lastRollback.getTime());
      if (cooldownRemaining > 0) {
        decision.shouldRollback = false;
        decision.reasoning = `Rollback cooldown active (${Math.ceil(cooldownRemaining / 1000)}s remaining)`;
        this.emit('decisionMade', decision);
        return decision;
      }
    }

    // Analyze verification result to make rollback decision
    const analysisResult = this.analyzeVerificationForRollback(verification, action);
    decision.shouldRollback = analysisResult.shouldRollback;
    decision.confidence = analysisResult.confidence;
    decision.reasoning = analysisResult.reasoning;
    decision.urgency = analysisResult.urgency;
    decision.estimatedImpact = analysisResult.estimatedImpact;

    // Build affected resources list
    if (action.action.target) {
      decision.affectedResources.push({
        type: 'deployment',
        name: action.action.target.deployment ?? 'unknown',
        namespace: action.action.target.namespace ?? 'default',
      });
    }

    // Suggest alternatives if not rolling back
    if (!decision.shouldRollback) {
      decision.alternativeActions = this.suggestAlternatives(verification, action);
    }

    this.logger.info(
      {
        decisionId: decision.id,
        shouldRollback: decision.shouldRollback,
        trigger: decision.trigger,
        confidence: decision.confidence
      },
      'Rollback decision made'
    );

    this.emit('decisionMade', decision);
    return decision;
  }

  /**
   * Request a rollback operation
   */
  async requestRollback(
    incidentId: string,
    targets: RollbackTarget[],
    trigger: RollbackTrigger,
    reason: string,
    requestedBy: 'system' | 'user' = 'system'
  ): Promise<RollbackRequest> {
    const request: RollbackRequest = {
      id: `rbr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      incidentId,
      timestamp: new Date(),
      status: 'pending',
      trigger,
      targets,
      reason,
      requestedBy,
    };

    this.emit('rollbackRequested', request);

    // Check if approval is required
    const requiresApproval = this.requiresApproval(request);

    if (requiresApproval) {
      request.status = 'pending';
      this.pendingApprovals.set(request.id, request);

      this.logger.info(
        { requestId: request.id, incidentId, reason: 'requires_approval' },
        'Rollback pending approval'
      );

      this.emit('approvalRequired', request);
      return request;
    }

    // Auto-approve and execute
    return this.approveAndExecute(request);
  }

  /**
   * Approve a pending rollback request
   */
  async approveRollback(requestId: string, approvedBy: string): Promise<RollbackRequest | null> {
    const request = this.pendingApprovals.get(requestId);
    if (!request) {
      this.logger.warn({ requestId }, 'Rollback request not found for approval');
      return null;
    }

    request.status = 'approved';
    request.approvedAt = new Date();
    request.approvedBy = approvedBy;
    this.pendingApprovals.delete(requestId);

    this.emit('rollbackApproved', request);

    return this.approveAndExecute(request);
  }

  /**
   * Cancel a pending rollback request
   */
  cancelRollback(requestId: string, reason: string): boolean {
    const request = this.pendingApprovals.get(requestId);
    if (!request) {
      return false;
    }

    request.status = 'cancelled';
    this.pendingApprovals.delete(requestId);

    this.logger.info({ requestId, reason }, 'Rollback cancelled');
    return true;
  }

  /**
   * Take a snapshot of current deployment states
   */
  async takeSnapshot(incidentId: string, namespace: string): Promise<DeploymentSnapshot | null> {
    if (!this.k8sClient) {
      this.logger.warn('K8s client not available for snapshot');
      return null;
    }

    try {
      const deployments = await this.k8sClient.listDeployments(namespace);

      const snapshot: DeploymentSnapshot = {
        id: `snap-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        incidentId,
        deployments: deployments.map(d => ({
          name: d.name,
          namespace: d.namespace,
          revision: d.revision,
          replicas: d.replicas,
          image: d.image,
          labels: {},
          annotations: {},
          containerSpecs: [],
        })),
      };

      // Store snapshot
      const incidentSnapshots = this.snapshots.get(incidentId) ?? [];
      incidentSnapshots.push(snapshot);

      // Trim to retention limit
      while (incidentSnapshots.length > this.config.snapshotRetention) {
        incidentSnapshots.shift();
      }

      this.snapshots.set(incidentId, incidentSnapshots);

      this.logger.info(
        { snapshotId: snapshot.id, incidentId, deploymentCount: snapshot.deployments.length },
        'Deployment snapshot taken'
      );

      return snapshot;
    } catch (error) {
      this.logger.error({ error, incidentId }, 'Failed to take snapshot');
      return null;
    }
  }

  /**
   * Get latest snapshot for an incident
   */
  getLatestSnapshot(incidentId: string): DeploymentSnapshot | null {
    const snapshots = this.snapshots.get(incidentId);
    if (!snapshots || snapshots.length === 0) return null;
    return snapshots[snapshots.length - 1] ?? null;
  }

  /**
   * Get rollback history for an incident
   */
  getHistory(incidentId: string): RollbackHistoryEntry[] {
    return this.history.get(incidentId) ?? [];
  }

  /**
   * Get pending approval requests
   */
  getPendingApprovals(): RollbackRequest[] {
    return Array.from(this.pendingApprovals.values());
  }

  /**
   * Get rollback count for an incident
   */
  getRollbackCount(incidentId: string): number {
    return this.rollbackCounts.get(incidentId) ?? 0;
  }

  /**
   * Reset rollback count (e.g., when incident is resolved)
   */
  resetRollbackCount(incidentId: string): void {
    this.rollbackCounts.delete(incidentId);
    this.lastRollbackTime.delete(incidentId);
  }

  /**
   * Check if cascade protection should be triggered
   */
  checkCascadeProtection(incidentId: string, _targets: RollbackTarget[]): boolean {
    if (!this.config.enableCascadeProtection) return false;

    const rollbackCount = this.rollbackCounts.get(incidentId) ?? 0;
    const history = this.history.get(incidentId) ?? [];

    // Check for repeated failures
    const recentFailures = history
      .filter(h => h.result && !h.result.success)
      .filter(h => h.request.timestamp.getTime() > Date.now() - 300000); // Last 5 minutes

    if (recentFailures.length >= 2) {
      this.logger.warn(
        { incidentId, failureCount: recentFailures.length },
        'Cascade protection triggered - too many recent failures'
      );
      return true;
    }

    // Check rollback escalation threshold
    if (rollbackCount >= this.config.policy.escalationThreshold) {
      this.logger.warn(
        { incidentId, rollbackCount, threshold: this.config.policy.escalationThreshold },
        'Cascade protection triggered - escalation threshold reached'
      );
      return true;
    }

    return false;
  }

  // Private helper methods

  private async approveAndExecute(request: RollbackRequest): Promise<RollbackRequest> {
    // Check cascade protection
    if (this.checkCascadeProtection(request.incidentId, request.targets)) {
      request.status = 'cancelled';
      this.emit('cascadeProtection', request, 'Too many recent failures or escalation threshold reached');
      return request;
    }

    request.status = 'executing';
    this.emit('rollbackStarted', request);

    try {
      const result = await this.executeRollback(request);
      request.status = result.success ? 'completed' : 'failed';
      request.completedAt = new Date();
      request.result = result;

      // Update counts and history
      if (result.success) {
        this.incrementRollbackCount(request.incidentId);
      }
      this.addToHistory(request);

      this.emit('rollbackCompleted', request, result);
      return request;
    } catch (error) {
      request.status = 'failed';
      request.completedAt = new Date();

      this.emit('rollbackFailed', request, error instanceof Error ? error : new Error(String(error)));
      this.addToHistory(request);

      return request;
    }
  }

  private async executeRollback(request: RollbackRequest): Promise<RollbackResult> {
    const startTime = Date.now();
    const results: RollbackResult['targets'] = [];

    if (!this.k8sClient) {
      return {
        success: false,
        targets: request.targets.map(t => ({
          target: t,
          success: false,
          message: 'K8s client not available',
          dryRun: this.config.dryRunMode,
        })),
        summary: 'Rollback failed: K8s client not available',
        duration: Date.now() - startTime,
        verificationRequired: false,
      };
    }

    for (const target of request.targets) {
      if (target.type !== 'deployment') {
        results.push({
          target,
          success: false,
          message: `Rollback for type '${target.type}' not yet implemented`,
          dryRun: this.config.dryRunMode,
        });
        continue;
      }

      try {
        const rollbackResult = await this.k8sClient.rollback({
          deployment: target.name,
          namespace: target.namespace,
          revision: target.targetRevision,
          reason: request.reason,
        });

        results.push({
          target,
          success: rollbackResult.success,
          message: rollbackResult.success
            ? `Rolled back from revision ${rollbackResult.fromRevision} to ${rollbackResult.toRevision}`
            : rollbackResult.error ?? 'Unknown error',
          previousRevision: rollbackResult.fromRevision,
          newRevision: rollbackResult.toRevision,
          dryRun: rollbackResult.dryRun,
        });
      } catch (error) {
        results.push({
          target,
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error',
          dryRun: this.config.dryRunMode,
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const success = successCount === results.length;

    return {
      success,
      targets: results,
      summary: success
        ? `Successfully rolled back ${successCount}/${results.length} targets`
        : `Rollback partially failed: ${successCount}/${results.length} succeeded`,
      duration: Date.now() - startTime,
      verificationRequired: success && !this.config.dryRunMode,
    };
  }

  private determineTrigger(verification: VerificationResult): RollbackTrigger {
    if (!verification.success) {
      if (verification.healthCheck && !verification.healthCheck.healthy) {
        return 'health_check_failure';
      }
      if (verification.metricVerification?.some(m => !m.met && m.expectedImprovement === 'decrease')) {
        return 'metric_regression';
      }
      if (verification.logVerification?.failureIndicators && verification.logVerification.failureIndicators > 0) {
        return 'error_spike';
      }
      return 'verification_failure';
    }
    return 'verification_failure';
  }

  private isTriggerEnabled(trigger: RollbackTrigger): boolean {
    const triggers = this.config.policy.rollbackTriggers;
    switch (trigger) {
      case 'verification_failure': return triggers.onVerificationFailure;
      case 'metric_regression': return triggers.onMetricRegression;
      case 'error_spike': return triggers.onErrorSpike;
      case 'health_check_failure': return triggers.onHealthCheckFailure;
      case 'timeout': return triggers.onTimeout;
      case 'manual_request': return true;
      case 'cascade_protection': return this.config.enableCascadeProtection;
      default: return false;
    }
  }

  private analyzeVerificationForRollback(
    verification: VerificationResult,
    action: ActionResult
  ): {
    shouldRollback: boolean;
    confidence: number;
    reasoning: string;
    urgency: RollbackDecision['urgency'];
    estimatedImpact: string;
  } {
    // If verification was successful, no rollback needed
    if (verification.success) {
      return {
        shouldRollback: false,
        confidence: verification.confidence,
        reasoning: 'Action verification succeeded',
        urgency: 'low',
        estimatedImpact: 'None - action was successful',
      };
    }

    // Analyze the failure severity
    let urgency: RollbackDecision['urgency'] = 'medium';
    let confidence = 0.5;
    const reasons: string[] = [];

    // Check health failure
    if (verification.healthCheck && !verification.healthCheck.healthy) {
      urgency = 'critical';
      confidence += 0.2;
      reasons.push(`Health check failed: ${verification.healthCheck.unhealthyPods.length} unhealthy pods`);
    }

    // Check metric regression
    if (verification.metricVerification) {
      const regressions = verification.metricVerification.filter(m => !m.met);
      if (regressions.length > 0) {
        urgency = regressions.length > 2 ? 'high' : 'medium';
        confidence += 0.1 * regressions.length;
        reasons.push(`${regressions.length} metric(s) regressed`);
      }
    }

    // Check log failures
    if (verification.logVerification?.verdict === 'failure') {
      confidence += 0.15;
      reasons.push(`Error patterns detected in logs`);
    }

    // Cap confidence at 0.95
    confidence = Math.min(0.95, confidence);

    // Determine if rollback is warranted
    const shouldRollback = confidence >= 0.6 || urgency === 'critical';

    return {
      shouldRollback,
      confidence,
      reasoning: reasons.length > 0 ? reasons.join('; ') : 'Verification failed with no specific indicators',
      urgency,
      estimatedImpact: shouldRollback
        ? `Rolling back ${action.action.type} on ${action.action.target.deployment ?? 'target'}`
        : 'Monitoring continued; no immediate action',
    };
  }

  private suggestAlternatives(
    verification: VerificationResult,
    action: ActionResult
  ): string[] {
    const alternatives: string[] = [];

    if (verification.shouldRetry) {
      alternatives.push('Retry the action with longer timeout');
    }

    if (action.action.type === 'restart') {
      alternatives.push('Check for memory leaks before restarting again');
      alternatives.push('Scale up replicas to maintain availability');
    }

    if (action.action.type === 'scale') {
      alternatives.push('Check for resource constraints in the cluster');
      alternatives.push('Analyze traffic patterns for auto-scaling configuration');
    }

    alternatives.push('Collect more evidence before taking action');
    alternatives.push('Escalate to on-call engineer for manual review');

    return alternatives.slice(0, 3);
  }

  private requiresApproval(request: RollbackRequest): boolean {
    const policy = this.config.policy;

    // Check global approval requirement
    if (policy.requireApproval) {
      return true;
    }

    // Check protected namespaces
    for (const target of request.targets) {
      if (policy.protectedNamespaces.includes(target.namespace)) {
        return true;
      }
      if (policy.protectedDeployments.includes(target.name)) {
        return true;
      }
    }

    // System-initiated rollbacks might need approval in certain conditions
    if (request.requestedBy === 'system' && this.getRollbackCount(request.incidentId) > 0) {
      return true; // Require approval for subsequent auto-rollbacks
    }

    return false;
  }

  private incrementRollbackCount(incidentId: string): void {
    const current = this.rollbackCounts.get(incidentId) ?? 0;
    this.rollbackCounts.set(incidentId, current + 1);
    this.lastRollbackTime.set(incidentId, new Date());
  }

  private addToHistory(request: RollbackRequest): void {
    const incidentHistory = this.history.get(request.incidentId) ?? [];
    incidentHistory.push({
      request,
      result: request.result,
    });
    this.history.set(request.incidentId, incidentHistory);
  }
}

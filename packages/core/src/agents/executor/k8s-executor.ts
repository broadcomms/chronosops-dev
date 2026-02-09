/**
 * Kubernetes Action Executor
 * Executes remediation actions using kubectl
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type {
  ActionExecutor,
  ActionRequest,
  ActionResult,
  ActionType,
  ExecutionMode,
} from './types.js';
import { EXECUTION_MODES, ACTION_TYPES } from './types.js';
import { createChildLogger } from '@chronosops/shared';

const logger = createChildLogger({ component: 'K8sExecutor' });

const execAsync = promisify(exec);

export interface K8sExecutorConfig {
  kubeconfigPath?: string;
  context?: string;
  allowedNamespaces: string[];
  allowedActions: ActionType[];
  dryRunDefault: boolean;
  timeoutMs?: number;
}

// NOTE: allowedNamespaces should be passed from ConfigService via ExecutorFactory
// Empty default means no actions allowed until properly configured
const DEFAULT_CONFIG: K8sExecutorConfig = {
  allowedNamespaces: [], // Will be populated from ConfigService
  allowedActions: [ACTION_TYPES.ROLLBACK, ACTION_TYPES.RESTART, ACTION_TYPES.SCALE],
  dryRunDefault: false,
  timeoutMs: 30000,
};

// Kubernetes resource name validation pattern
// Must be lowercase alphanumeric, can contain dashes, max 253 chars
// See: https://kubernetes.io/docs/concepts/overview/working-with-objects/names/
const K8S_RESOURCE_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,251}[a-z0-9])?$/;

export class KubernetesExecutor implements ActionExecutor {
  readonly name = 'KubernetesExecutor';
  readonly mode: ExecutionMode = EXECUTION_MODES.KUBERNETES;

  private config: K8sExecutorConfig;

  constructor(config: Partial<K8sExecutorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Validate a Kubernetes resource name to prevent command injection
   */
  private isValidK8sResourceName(name: string): boolean {
    if (!name || name.length > 253) {
      return false;
    }
    return K8S_RESOURCE_NAME_PATTERN.test(name);
  }

  /**
   * Check if kubectl is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('kubectl version --client -o json', {
        timeout: 5000,
      });
      return stdout.includes('clientVersion');
    } catch {
      return false;
    }
  }

  /**
   * Validate action before execution
   */
  async validate(request: ActionRequest): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // SECURITY: Validate resource names to prevent command injection
    if (!this.isValidK8sResourceName(request.target.namespace)) {
      errors.push(
        `Invalid namespace name '${request.target.namespace}': must be lowercase alphanumeric with dashes, max 253 chars`
      );
    }

    if (!this.isValidK8sResourceName(request.target.deployment)) {
      errors.push(
        `Invalid deployment name '${request.target.deployment}': must be lowercase alphanumeric with dashes, max 253 chars`
      );
    }

    // Validate context name if provided (same rules apply)
    if (this.config.context && !this.isValidK8sResourceName(this.config.context)) {
      errors.push(
        `Invalid context name '${this.config.context}': must be lowercase alphanumeric with dashes, max 253 chars`
      );
    }

    // Check namespace is allowed
    if (!this.config.allowedNamespaces.includes(request.target.namespace)) {
      errors.push(
        `Namespace '${request.target.namespace}' is not in allowed list: ${this.config.allowedNamespaces.join(', ')}`
      );
    }

    // Check action type is allowed
    if (!this.config.allowedActions.includes(request.type)) {
      errors.push(
        `Action type '${request.type}' is not in allowed list: ${this.config.allowedActions.join(', ')}`
      );
    }

    // Validate action-specific parameters
    switch (request.type) {
      case ACTION_TYPES.SCALE:
        if (request.parameters?.replicas === undefined) {
          errors.push('Scale action requires replicas parameter');
        } else if (request.parameters.replicas < 0 || request.parameters.replicas > 10) {
          errors.push('Replicas must be between 0 and 10');
        }
        break;

      case ACTION_TYPES.ROLLBACK:
        if (request.parameters?.revision !== undefined && request.parameters.revision < 0) {
          errors.push('Revision must be a positive number');
        }
        break;
    }

    // Warnings
    if (request.dryRun === false) {
      warnings.push('Dry run is disabled - changes will be applied to the cluster');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Execute remediation action
   */
  async execute(request: ActionRequest): Promise<ActionResult> {
    const startTime = Date.now();

    // Validate first
    const validation = await this.validate(request);
    if (!validation.valid) {
      return {
        success: false,
        mode: this.mode,
        action: request,
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
        message: `Validation failed: ${validation.errors.join('; ')}`,
        details: {
          error: validation.errors.join('\n'),
        },
      };
    }

    // Build kubectl command
    const dryRun = request.dryRun ?? this.config.dryRunDefault;
    const command = this.buildCommand(request, dryRun);

    logger.info({ command, target: request.target }, 'Executing kubectl command');

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: this.config.timeoutMs,
        env: {
          ...process.env,
          ...(this.config.kubeconfigPath && { KUBECONFIG: this.config.kubeconfigPath }),
        },
      });

      return {
        success: true,
        mode: this.mode,
        action: request,
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
        message: dryRun
          ? `[DRY RUN] ${request.type} would be applied to ${request.target.deployment}`
          : `Successfully executed ${request.type} on ${request.target.deployment}`,
        details: {
          command,
          output: stdout || stderr,
        },
      };
    } catch (error) {
      const err = error as { message?: string; stderr?: string };
      return {
        success: false,
        mode: this.mode,
        action: request,
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
        message: `Failed to execute ${request.type}: ${err.message ?? 'Unknown error'}`,
        details: {
          command,
          error: err.stderr ?? err.message ?? 'Unknown error',
        },
      };
    }
  }

  /**
   * Minimum age (in seconds) for a deployment before rollback is considered useful.
   * For fresh deployments, rollback typically returns to the same or similar broken state.
   * Default: 300 seconds (5 minutes)
   */
  static readonly ROLLBACK_MIN_AGE_SECONDS = 300;

  /**
   * Get deployment revision information including age
   * Used to determine if rollback is possible AND appropriate
   *
   * @param namespace - Kubernetes namespace
   * @param deployment - Deployment name
   * @returns Revision info with age - canRollback is false for first deployment OR recent deployments
   */
  async getDeploymentRevisionCount(
    namespace: string,
    deployment: string
  ): Promise<{
    revisionCount: number;
    currentRevision: number;
    canRollback: boolean;
    currentRevisionAgeSeconds: number;
    isRecentDeployment: boolean;
    rollbackSkipReason?: string;
  }> {
    const defaultResult = {
      revisionCount: 0,
      currentRevision: 0,
      canRollback: false,
      currentRevisionAgeSeconds: 0,
      isRecentDeployment: true,
      rollbackSkipReason: 'Unable to determine deployment state',
    };

    // Validate inputs to prevent command injection
    if (!this.isValidK8sResourceName(namespace)) {
      logger.warn({ namespace }, 'Invalid namespace name for revision check');
      return defaultResult;
    }
    if (!this.isValidK8sResourceName(deployment)) {
      logger.warn({ deployment }, 'Invalid deployment name for revision check');
      return defaultResult;
    }

    try {
      const contextFlag = this.config.context ? ` --context=${this.config.context}` : '';
      const kubeconfigEnv = this.config.kubeconfigPath ? { KUBECONFIG: this.config.kubeconfigPath } : {};

      // Get rollout history to count revisions
      const { stdout: historyOutput } = await execAsync(
        `kubectl rollout history deployment/${deployment} -n ${namespace}${contextFlag}`,
        {
          timeout: 10000,
          env: { ...process.env, ...kubeconfigEnv },
        }
      );

      // Parse the revision count from output
      // Output format:
      // deployment.apps/app-name
      // REVISION  CHANGE-CAUSE
      // 1         <none>
      // 2         <none>
      const lines = historyOutput.trim().split('\n');
      const revisionLines = lines.filter((line) => /^\d+\s+/.test(line.trim()));
      const revisionCount = revisionLines.length;

      // Get current revision number (highest number)
      const currentRevision = revisionLines.length > 0
        ? Math.max(...revisionLines.map((line) => parseInt(line.trim().split(/\s+/)[0] ?? '0', 10)))
        : 0;

      // Get deployment creation timestamp and current ReplicaSet age
      let currentRevisionAgeSeconds = 0;
      try {
        // Get the current ReplicaSet for this deployment (the one with the current revision annotation)
        const { stdout: rsOutput } = await execAsync(
          `kubectl get replicaset -n ${namespace} -l app=${deployment} ` +
          `-o jsonpath='{.items[?(@.metadata.annotations.deployment\\.kubernetes\\.io/revision=="${currentRevision}")].metadata.creationTimestamp}'${contextFlag}`,
          {
            timeout: 10000,
            env: { ...process.env, ...kubeconfigEnv },
          }
        );

        const creationTimestamp = rsOutput.replace(/'/g, '').trim();
        if (creationTimestamp) {
          const creationDate = new Date(creationTimestamp);
          currentRevisionAgeSeconds = Math.floor((Date.now() - creationDate.getTime()) / 1000);
        }
      } catch {
        // Fallback: Get deployment's own creation timestamp
        try {
          const { stdout: depOutput } = await execAsync(
            `kubectl get deployment/${deployment} -n ${namespace} -o jsonpath='{.metadata.creationTimestamp}'${contextFlag}`,
            {
              timeout: 10000,
              env: { ...process.env, ...kubeconfigEnv },
            }
          );
          const creationTimestamp = depOutput.replace(/'/g, '').trim();
          if (creationTimestamp) {
            const creationDate = new Date(creationTimestamp);
            currentRevisionAgeSeconds = Math.floor((Date.now() - creationDate.getTime()) / 1000);
          }
        } catch {
          logger.debug('Could not determine deployment age, using default');
        }
      }

      // Determine if this is a recent deployment
      const isRecentDeployment = currentRevisionAgeSeconds < KubernetesExecutor.ROLLBACK_MIN_AGE_SECONDS;

      // Determine canRollback based on both revision count AND deployment age
      let canRollback = revisionCount > 1;
      let rollbackSkipReason: string | undefined;

      if (revisionCount <= 1) {
        canRollback = false;
        rollbackSkipReason = 'First deployment - no previous revision to rollback to';
      } else if (isRecentDeployment) {
        canRollback = false;
        rollbackSkipReason = `Recent deployment (${currentRevisionAgeSeconds}s old, < ${KubernetesExecutor.ROLLBACK_MIN_AGE_SECONDS}s threshold) - rollback unlikely to help`;
      }

      logger.info({
        namespace,
        deployment,
        revisionCount,
        currentRevision,
        currentRevisionAgeSeconds,
        isRecentDeployment,
        canRollback,
        rollbackSkipReason,
      }, 'Deployment revision check complete');

      return {
        revisionCount,
        currentRevision,
        canRollback,
        currentRevisionAgeSeconds,
        isRecentDeployment,
        rollbackSkipReason,
      };
    } catch (error) {
      const err = error as Error;
      logger.warn({
        namespace,
        deployment,
        error: err.message,
      }, 'Failed to get deployment revision count');

      return defaultResult;
    }
  }

  /**
   * Build kubectl command based on action type
   */
  private buildCommand(request: ActionRequest, dryRun: boolean): string {
    const { namespace, deployment } = request.target;
    const dryRunFlag = dryRun ? ' --dry-run=server' : '';
    const contextFlag = this.config.context ? ` --context=${this.config.context}` : '';

    switch (request.type) {
      case ACTION_TYPES.ROLLBACK: {
        const revision = request.parameters?.revision;
        const toRevision = revision ? ` --to-revision=${revision}` : '';
        return `kubectl rollout undo deployment/${deployment} -n ${namespace}${toRevision}${dryRunFlag}${contextFlag}`;
      }

      case ACTION_TYPES.RESTART:
        return `kubectl rollout restart deployment/${deployment} -n ${namespace}${dryRunFlag}${contextFlag}`;

      case ACTION_TYPES.SCALE: {
        const replicas = request.parameters?.replicas ?? 1;
        return `kubectl scale deployment/${deployment} --replicas=${replicas} -n ${namespace}${dryRunFlag}${contextFlag}`;
      }

      default:
        throw new Error(`Unknown action type: ${request.type}`);
    }
  }

  /**
   * Wait for a deployment to be ready (all replicas available)
   * Polls deployment status until ready or timeout
   */
  async waitForDeploymentReady(
    namespace: string,
    deployment: string,
    timeoutMs: number = 120000
  ): Promise<boolean> {
    // SECURITY: Validate inputs
    if (!this.isValidK8sResourceName(namespace) || !this.isValidK8sResourceName(deployment)) {
      logger.warn({ namespace, deployment }, 'Invalid resource names for rollout status check');
      return false;
    }

    const contextFlag = this.config.context ? ` --context=${this.config.context}` : '';
    const command = `kubectl rollout status deployment/${deployment} -n ${namespace}${contextFlag} --timeout=${Math.floor(timeoutMs / 1000)}s`;

    logger.info({
      namespace,
      deployment,
      timeoutMs,
      command,
    }, 'Waiting for deployment rollout to complete');

    try {
      const { stdout } = await execAsync(command, {
        timeout: timeoutMs + 5000, // Add buffer for process overhead
      });

      logger.info({
        namespace,
        deployment,
        output: stdout.substring(0, 200),
      }, 'Deployment rollout completed successfully');

      return true;
    } catch (error) {
      const err = error as Error & { killed?: boolean; code?: number };

      if (err.killed) {
        logger.warn({
          namespace,
          deployment,
          timeoutMs,
        }, 'Deployment rollout wait timed out');
      } else {
        logger.warn({
          namespace,
          deployment,
          error: err.message,
        }, 'Error waiting for deployment rollout');
      }

      return false;
    }
  }
}

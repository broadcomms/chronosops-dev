/**
 * Action Executor Factory
 * Creates and manages action executors based on execution mode
 *
 * IMPORTANT: No silent fallback to SimulatedExecutor
 * - AUTO mode requires K8s to be available
 * - Use EXECUTION_MODE=simulated explicitly for demo mode
 */

import type {
  ActionExecutor,
  ActionRequest,
  ActionResult,
  ExecutorFactoryConfig,
} from './types.js';
import { EXECUTION_MODES } from './types.js';
import { KubernetesExecutor } from './k8s-executor.js';
import { SimulatedExecutor } from './simulated-executor.js';
import { CooldownManager, type CooldownConfig } from './cooldown-manager.js';
import { createChildLogger } from '@chronosops/shared';
import { configService } from '../../services/config-service.js';

const logger = createChildLogger({ component: 'ExecutorFactory' });

// NOTE: allowedNamespaces should be loaded from ConfigService dynamically
// This default is only used as a fallback during initialization
const DEFAULT_K8S_CONFIG: { allowedNamespaces: string[]; allowedActions: ('rollback' | 'restart' | 'scale')[]; dryRunDefault: boolean } = {
  allowedNamespaces: [], // Empty by default - will be loaded from ConfigService
  allowedActions: ['rollback', 'restart', 'scale'],
  dryRunDefault: false,
};

const DEFAULT_SIMULATED_CONFIG = {
  demoAppUrl: 'http://localhost:8080',
  simulateLatencyMs: 500,
  simulateFailureRate: 0,
};

const DEFAULT_CONFIG: ExecutorFactoryConfig = {
  mode: EXECUTION_MODES.AUTO,
  kubernetes: DEFAULT_K8S_CONFIG,
  simulated: DEFAULT_SIMULATED_CONFIG,
};

/**
 * Extended factory config with cooldown settings
 */
export interface ExtendedFactoryConfig extends Partial<ExecutorFactoryConfig> {
  cooldown?: Partial<CooldownConfig>;
  enforceCooldowns?: boolean;
}

/**
 * Factory for creating action executors
 */
export class ExecutorFactory {
  private config: ExecutorFactoryConfig;
  private k8sExecutor: KubernetesExecutor;
  private simulatedExecutor: SimulatedExecutor;
  private cooldownManager: CooldownManager;
  private enforceCooldowns: boolean;

  constructor(config: ExtendedFactoryConfig = {}) {
    const k8sConfig = { ...DEFAULT_K8S_CONFIG, ...config.kubernetes };
    const simulatedConfig = { ...DEFAULT_SIMULATED_CONFIG, ...config.simulated };

    this.config = {
      mode: config.mode ?? DEFAULT_CONFIG.mode,
      kubernetes: k8sConfig,
      simulated: simulatedConfig,
    };

    this.k8sExecutor = new KubernetesExecutor({
      kubeconfigPath: k8sConfig.kubeconfigPath,
      context: k8sConfig.context,
      allowedNamespaces: k8sConfig.allowedNamespaces,
      allowedActions: k8sConfig.allowedActions as ('rollback' | 'restart' | 'scale')[],
      dryRunDefault: k8sConfig.dryRunDefault,
    });
    this.simulatedExecutor = new SimulatedExecutor({
      demoAppUrl: simulatedConfig.demoAppUrl,
      simulateLatencyMs: simulatedConfig.simulateLatencyMs,
      simulateFailureRate: simulatedConfig.simulateFailureRate,
    });

    // Initialize cooldown manager
    this.cooldownManager = new CooldownManager(config.cooldown);
    this.enforceCooldowns = config.enforceCooldowns ?? true; // Enforce by default
  }

  /**
   * Refresh configuration from ConfigService (database)
   * Updates allowed namespaces and allowed actions from database
   */
  async refreshConfig(): Promise<void> {
    try {
      const k8sConfig = await configService.getKubernetesConfig();

      // Update both allowedNamespaces and allowedActions from database
      this.config.kubernetes = {
        ...this.config.kubernetes,
        allowedNamespaces: k8sConfig.allowedNamespaces,
        allowedActions: k8sConfig.allowedActions,
      };

      // Recreate K8s executor with updated config including allowedActions
      this.k8sExecutor = new KubernetesExecutor({
        kubeconfigPath: this.config.kubernetes.kubeconfigPath,
        context: this.config.kubernetes.context,
        allowedNamespaces: k8sConfig.allowedNamespaces,
        allowedActions: k8sConfig.allowedActions,
        dryRunDefault: this.config.kubernetes.dryRunDefault ?? false,
      });

      logger.info(
        {
          allowedNamespaces: k8sConfig.allowedNamespaces,
          allowedActions: k8sConfig.allowedActions,
        },
        'Refreshed executor config from ConfigService'
      );
    } catch (error) {
      logger.error({ error }, 'Failed to refresh config from ConfigService');
    }
  }

  /**
   * Get the appropriate executor based on mode
   * NOTE: AUTO mode now requires K8s to be available - no silent fallback
   */
  async getExecutor(): Promise<ActionExecutor> {
    // Refresh config from database before selecting executor
    await this.refreshConfig();

    switch (this.config.mode) {
      case EXECUTION_MODES.KUBERNETES:
        return this.k8sExecutor;

      case EXECUTION_MODES.SIMULATED:
        return this.simulatedExecutor;

      case EXECUTION_MODES.AUTO:
      default:
        // Try Kubernetes - throw error if not available (no silent fallback)
        const k8sAvailable = await this.k8sExecutor.isAvailable();
        if (k8sAvailable) {
          logger.info('Using Kubernetes executor');
          return this.k8sExecutor;
        }

        // No silent fallback - require explicit EXECUTION_MODE=simulated for demo
        logger.error('Kubernetes not available and EXECUTION_MODE is not set to "simulated"');
        throw new Error(
          'Kubernetes cluster not available. Set EXECUTION_MODE=simulated for demo mode, ' +
          'or configure your Kubernetes cluster connection.'
        );
    }
  }

  /**
   * Check if action is allowed (not on cooldown)
   */
  checkCooldown(request: ActionRequest): { allowed: boolean; reason?: string; retryAfterMs?: number } {
    if (!this.enforceCooldowns) {
      return { allowed: true };
    }

    return this.cooldownManager.canExecute(
      request.target.namespace,
      request.target.deployment,
      request.type
    );
  }

  /**
   * Execute action with cooldown enforcement
   */
  async execute(request: ActionRequest): Promise<ActionResult> {
    // Check cooldown first
    const cooldownCheck = this.checkCooldown(request);
    if (!cooldownCheck.allowed) {
      logger.warn(
        { target: request.target, actionType: request.type, reason: cooldownCheck.reason },
        'Action blocked by cooldown'
      );
      return {
        success: false,
        mode: EXECUTION_MODES.AUTO,
        action: request,
        timestamp: new Date(),
        durationMs: 0,
        message: `Action blocked: ${cooldownCheck.reason}`,
        details: {
          error: cooldownCheck.reason,
        },
      };
    }

    const result = await this.executeWithFallback(request);

    // Record the action for cooldown tracking (only on successful execution)
    if (result.success) {
      this.cooldownManager.recordAction(
        request.target.namespace,
        request.target.deployment,
        request.type
      );
    }

    return result;
  }

  /**
   * Execute action directly (no fallback)
   * NOTE: This bypasses cooldown checks - use execute() for cooldown enforcement
   */
  async executeWithFallback(request: ActionRequest): Promise<ActionResult> {
    const executor = await this.getExecutor();

    // Direct execution - no fallback to simulated
    const result = await executor.execute(request);

    // Log errors clearly without fallback
    if (!result.success) {
      logger.error(
        { target: request.target, error: result.message },
        'Action execution failed'
      );
    }

    return result;
  }

  /**
   * Check availability of all executors
   */
  async checkAvailability(): Promise<{
    kubernetes: boolean;
    simulated: boolean;
    currentMode: string;
    activeExecutor: string;
  }> {
    const k8sAvailable = await this.k8sExecutor.isAvailable();
    const simulatedAvailable = await this.simulatedExecutor.isAvailable();
    const activeExecutor = await this.getExecutor();

    return {
      kubernetes: k8sAvailable,
      simulated: simulatedAvailable,
      currentMode: this.config.mode,
      activeExecutor: activeExecutor.name,
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): ExecutorFactoryConfig {
    return { ...this.config };
  }

  /**
   * Clear cooldown for a specific target
   */
  clearCooldown(namespace: string, deployment: string): void {
    this.cooldownManager.clearCooldown(namespace, deployment);
  }

  /**
   * Get cooldown stats for monitoring
   */
  getCooldownStats(): ReturnType<CooldownManager['getStats']> {
    return this.cooldownManager.getStats();
  }

  /**
   * Get remaining cooldown time for a target
   */
  getRemainingCooldown(namespace: string, deployment: string, actionType: 'rollback' | 'restart' | 'scale'): number {
    return this.cooldownManager.getRemainingCooldown(namespace, deployment, actionType);
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<ExecutorFactoryConfig>): void {
    const k8sConfig = { ...this.config.kubernetes, ...newConfig.kubernetes };
    const simulatedConfig = { ...this.config.simulated, ...newConfig.simulated };

    this.config = {
      mode: newConfig.mode ?? this.config.mode,
      kubernetes: k8sConfig,
      simulated: simulatedConfig,
    };

    // Recreate executors with new config
    if (newConfig.kubernetes) {
      this.k8sExecutor = new KubernetesExecutor({
        kubeconfigPath: k8sConfig.kubeconfigPath,
        context: k8sConfig.context,
        allowedNamespaces: k8sConfig.allowedNamespaces ?? DEFAULT_K8S_CONFIG.allowedNamespaces,
        allowedActions: (k8sConfig.allowedActions ?? DEFAULT_K8S_CONFIG.allowedActions) as ('rollback' | 'restart' | 'scale')[],
        dryRunDefault: k8sConfig.dryRunDefault ?? DEFAULT_K8S_CONFIG.dryRunDefault,
      });
    }
    if (newConfig.simulated) {
      this.simulatedExecutor = new SimulatedExecutor({
        demoAppUrl: simulatedConfig.demoAppUrl ?? DEFAULT_SIMULATED_CONFIG.demoAppUrl,
        simulateLatencyMs: simulatedConfig.simulateLatencyMs,
        simulateFailureRate: simulatedConfig.simulateFailureRate,
      });
    }
  }
}

/**
 * Create executor factory from environment variables
 */
export function createExecutorFromEnv(): ExecutorFactory {
  const mode =
    (process.env.EXECUTION_MODE as keyof typeof EXECUTION_MODES) ?? EXECUTION_MODES.AUTO;

  return new ExecutorFactory({
    mode: EXECUTION_MODES[mode] ?? EXECUTION_MODES.AUTO,
    kubernetes: {
      kubeconfigPath: process.env.KUBECONFIG,
      context: process.env.K8S_CONTEXT,
      allowedNamespaces: (process.env.K8S_ALLOWED_NAMESPACES ?? 'demo,staging').split(','),
      allowedActions: (process.env.K8S_ALLOWED_ACTIONS ?? 'rollback,restart,scale').split(
        ','
      ) as ('rollback' | 'restart' | 'scale')[],
      dryRunDefault: process.env.K8S_DRY_RUN === 'true',
    },
    simulated: {
      demoAppUrl: process.env.DEMO_APP_URL ?? 'http://localhost:8080',
      simulateLatencyMs: parseInt(process.env.SIMULATE_LATENCY_MS ?? '500', 10),
      simulateFailureRate: parseFloat(process.env.SIMULATE_FAILURE_RATE ?? '0'),
    },
    // Cooldown configuration
    enforceCooldowns: process.env.ENFORCE_COOLDOWNS !== 'false',
    cooldown: {
      defaultCooldownMs: parseInt(process.env.ACTION_COOLDOWN_MS ?? '60000', 10),
      maxActionsPerWindow: parseInt(process.env.MAX_ACTIONS_PER_WINDOW ?? '5', 10),
      windowMs: parseInt(process.env.ACTION_WINDOW_MS ?? '300000', 10),
    },
  });
}

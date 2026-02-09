/**
 * Action Executor Module
 * Provides action execution capabilities for remediation
 */

// Types
export type {
  ActionType,
  ExecutionMode,
  ActionRequest,
  ActionResult,
  ActionExecutor,
  ExecutorFactoryConfig,
} from './types.js';

export { ACTION_TYPES, EXECUTION_MODES } from './types.js';

// Executors
export { KubernetesExecutor, type K8sExecutorConfig } from './k8s-executor.js';
export { SimulatedExecutor, type SimulatedExecutorConfig } from './simulated-executor.js';

// Factory
export { ExecutorFactory, createExecutorFromEnv, type ExtendedFactoryConfig } from './executor-factory.js';

// Cooldown Manager
export {
  CooldownManager,
  getCooldownManager,
  resetCooldownManager,
  type CooldownConfig,
} from './cooldown-manager.js';

// Action Registry (pluggable action system)
export {
  ActionRegistry,
  getActionRegistry,
  resetActionRegistry,
  type ActionDefinition,
} from './action-registry.js';

/**
 * Action Registry
 * Enables pluggable action system for extensible remediation capabilities
 *
 * Currently supports:
 * - rollback: Kubernetes deployment rollback
 * - restart: Kubernetes deployment restart
 *
 * Future extensibility:
 * - scale: Kubernetes deployment scaling
 * - runbook: Execute runbook automation
 * - custom: User-defined actions via plugins
 */

import type { ActionType, ActionExecutor, ActionRequest, ActionResult, ExecutionMode } from './types.js';
import { ACTION_TYPES, EXECUTION_MODES } from './types.js';
import { createChildLogger } from '@chronosops/shared';

const logger = createChildLogger({ component: 'ActionRegistry' });

/**
 * Action definition for the registry
 */
export interface ActionDefinition {
  /** Unique action type identifier */
  type: ActionType;

  /** Human-readable name */
  name: string;

  /** Description of what this action does */
  description: string;

  /** Required parameters for this action */
  requiredParams: string[];

  /** Optional parameters for this action */
  optionalParams: string[];

  /** Whether this action requires confirmation */
  requiresConfirmation: boolean;

  /** Risk level of this action */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';

  /** Available execution modes for this action */
  supportedModes: ExecutionMode[];

  /** Cooldown in milliseconds before this action can be repeated */
  cooldownMs: number;

  /** Whether this action is currently enabled */
  enabled: boolean;
}

/**
 * Default action definitions for built-in actions
 */
const DEFAULT_ACTION_DEFINITIONS: ActionDefinition[] = [
  {
    type: ACTION_TYPES.ROLLBACK,
    name: 'Deployment Rollback',
    description: 'Roll back a Kubernetes deployment to a previous revision',
    requiredParams: ['namespace', 'deployment'],
    optionalParams: ['revision'],
    requiresConfirmation: true,
    riskLevel: 'high',
    supportedModes: [EXECUTION_MODES.KUBERNETES, EXECUTION_MODES.SIMULATED],
    cooldownMs: 60000,
    enabled: true,
  },
  {
    type: ACTION_TYPES.RESTART,
    name: 'Deployment Restart',
    description: 'Restart all pods in a Kubernetes deployment',
    requiredParams: ['namespace', 'deployment'],
    optionalParams: [],
    requiresConfirmation: true,
    riskLevel: 'medium',
    supportedModes: [EXECUTION_MODES.KUBERNETES, EXECUTION_MODES.SIMULATED],
    cooldownMs: 60000,
    enabled: true,
  },
  {
    type: ACTION_TYPES.SCALE,
    name: 'Deployment Scale',
    description: 'Scale a Kubernetes deployment to a specified number of replicas',
    requiredParams: ['namespace', 'deployment', 'replicas'],
    optionalParams: [],
    requiresConfirmation: true,
    riskLevel: 'medium',
    supportedModes: [EXECUTION_MODES.KUBERNETES, EXECUTION_MODES.SIMULATED],
    cooldownMs: 30000,
    enabled: true,
  },
];

/**
 * ActionRegistry - Central registry for all remediation actions
 *
 * Provides:
 * - Registration of new action types
 * - Lookup of action definitions and executors
 * - Validation of action requests
 * - Extensibility for future action types
 */
export class ActionRegistry {
  private definitions: Map<ActionType, ActionDefinition> = new Map();
  private executors: Map<string, ActionExecutor> = new Map(); // key: `${actionType}:${mode}`

  constructor() {
    // Register default action definitions
    for (const def of DEFAULT_ACTION_DEFINITIONS) {
      this.definitions.set(def.type, def);
    }

    logger.info({ actionCount: this.definitions.size }, 'ActionRegistry initialized');
  }

  /**
   * Register a new action definition
   */
  registerAction(definition: ActionDefinition): void {
    if (this.definitions.has(definition.type)) {
      logger.warn({ type: definition.type }, 'Overwriting existing action definition');
    }

    this.definitions.set(definition.type, definition);
    logger.info({ type: definition.type, name: definition.name }, 'Action registered');
  }

  /**
   * Register an executor for a specific action type and mode
   */
  registerExecutor(actionType: ActionType, mode: ExecutionMode, executor: ActionExecutor): void {
    const key = `${actionType}:${mode}`;
    if (this.executors.has(key)) {
      logger.warn({ actionType, mode }, 'Overwriting existing executor');
    }

    this.executors.set(key, executor);
    logger.info({ actionType, mode, executorName: executor.name }, 'Executor registered');
  }

  /**
   * Get action definition by type
   */
  getDefinition(type: ActionType): ActionDefinition | undefined {
    return this.definitions.get(type);
  }

  /**
   * Get all registered action definitions
   */
  getAllDefinitions(): ActionDefinition[] {
    return Array.from(this.definitions.values());
  }

  /**
   * Get enabled action definitions
   */
  getEnabledDefinitions(): ActionDefinition[] {
    return Array.from(this.definitions.values()).filter(d => d.enabled);
  }

  /**
   * Get executor for a specific action type and mode
   */
  getExecutor(actionType: ActionType, mode: ExecutionMode): ActionExecutor | undefined {
    const key = `${actionType}:${mode}`;
    return this.executors.get(key);
  }

  /**
   * Check if an action type is supported
   */
  isSupported(type: ActionType): boolean {
    return this.definitions.has(type);
  }

  /**
   * Check if an action type is enabled
   */
  isEnabled(type: ActionType): boolean {
    const def = this.definitions.get(type);
    return def?.enabled ?? false;
  }

  /**
   * Enable or disable an action type
   */
  setEnabled(type: ActionType, enabled: boolean): void {
    const def = this.definitions.get(type);
    if (def) {
      def.enabled = enabled;
      logger.info({ type, enabled }, 'Action enabled status changed');
    }
  }

  /**
   * Validate an action request against its definition
   */
  validateRequest(request: ActionRequest): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    const def = this.definitions.get(request.type);
    if (!def) {
      errors.push(`Unknown action type: ${request.type}`);
      return { valid: false, errors, warnings };
    }

    if (!def.enabled) {
      errors.push(`Action type '${request.type}' is not enabled`);
    }

    // Check required parameters
    for (const param of def.requiredParams) {
      if (param === 'namespace' && !request.target.namespace) {
        errors.push('Missing required parameter: namespace');
      } else if (param === 'deployment' && !request.target.deployment) {
        errors.push('Missing required parameter: deployment');
      } else if (param === 'replicas' && request.parameters?.replicas === undefined) {
        errors.push('Missing required parameter: replicas');
      }
    }

    // Add warnings for high-risk actions
    if (def.riskLevel === 'high' || def.riskLevel === 'critical') {
      warnings.push(`This is a ${def.riskLevel}-risk action: ${def.description}`);
    }

    if (!request.dryRun && !request.reason) {
      warnings.push('No reason provided for non-dry-run action');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Execute an action using the appropriate executor
   */
  async execute(request: ActionRequest, mode: ExecutionMode): Promise<ActionResult> {
    const def = this.definitions.get(request.type);
    if (!def) {
      return {
        success: false,
        mode,
        action: request,
        timestamp: new Date(),
        durationMs: 0,
        message: `Unknown action type: ${request.type}`,
        details: { error: `Action type '${request.type}' is not registered` },
      };
    }

    if (!def.enabled) {
      return {
        success: false,
        mode,
        action: request,
        timestamp: new Date(),
        durationMs: 0,
        message: `Action type '${request.type}' is disabled`,
        details: { error: 'Action is disabled' },
      };
    }

    const executor = this.getExecutor(request.type, mode);
    if (!executor) {
      return {
        success: false,
        mode,
        action: request,
        timestamp: new Date(),
        durationMs: 0,
        message: `No executor found for ${request.type} in ${mode} mode`,
        details: { error: 'No executor registered for this action/mode combination' },
      };
    }

    return executor.execute(request);
  }

  /**
   * Get summary of registered actions for monitoring/debugging
   */
  getSummary(): {
    totalActions: number;
    enabledActions: number;
    registeredExecutors: number;
    actions: Array<{ type: string; name: string; enabled: boolean; riskLevel: string }>;
  } {
    const actions = Array.from(this.definitions.values()).map(d => ({
      type: d.type,
      name: d.name,
      enabled: d.enabled,
      riskLevel: d.riskLevel,
    }));

    return {
      totalActions: this.definitions.size,
      enabledActions: actions.filter(a => a.enabled).length,
      registeredExecutors: this.executors.size,
      actions,
    };
  }
}

// Singleton instance
let registryInstance: ActionRegistry | null = null;

/**
 * Get the singleton ActionRegistry instance
 */
export function getActionRegistry(): ActionRegistry {
  if (!registryInstance) {
    registryInstance = new ActionRegistry();
  }
  return registryInstance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetActionRegistry(): void {
  registryInstance = null;
}

export default ActionRegistry;

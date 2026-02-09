/**
 * ActionExecutor Types
 * Defines the interface for executing remediation actions
 */

/**
 * Supported action types
 */
export const ACTION_TYPES = {
  ROLLBACK: 'rollback',
  RESTART: 'restart',
  SCALE: 'scale',
  CODE_FIX: 'code_fix',
} as const;

export type ActionType = (typeof ACTION_TYPES)[keyof typeof ACTION_TYPES];

/**
 * Execution modes
 */
export const EXECUTION_MODES = {
  KUBERNETES: 'kubernetes',
  SIMULATED: 'simulated',
  AUTO: 'auto',
} as const;

export type ExecutionMode = (typeof EXECUTION_MODES)[keyof typeof EXECUTION_MODES];

/**
 * Action execution request
 */
export interface ActionRequest {
  type: ActionType;
  target: {
    namespace: string;
    deployment: string;
    container?: string;
  };
  parameters?: {
    revision?: number; // For rollback
    replicas?: number; // For scale
  };
  dryRun?: boolean;
  reason?: string;
  incidentId?: string;
}

/**
 * Action execution result
 */
export interface ActionResult {
  success: boolean;
  mode: ExecutionMode;
  action: ActionRequest;
  timestamp: Date;
  durationMs: number;
  message: string;
  details?: {
    command?: string;
    output?: string;
    error?: string;
    previousState?: Record<string, unknown>;
    newState?: Record<string, unknown>;
    // Fallback-specific fields
    fallbackReason?: string;
    originalError?: string;
    // Simulated executor fields
    detectedBug?: string;
  };
}

/**
 * Action executor interface
 * Implementations can use kubectl, API calls, or simulated responses
 */
export interface ActionExecutor {
  /**
   * Name of the executor
   */
  readonly name: string;

  /**
   * Execution mode
   */
  readonly mode: ExecutionMode;

  /**
   * Check if the executor is available (e.g., kubectl is installed)
   */
  isAvailable(): Promise<boolean>;

  /**
   * Execute a remediation action
   */
  execute(request: ActionRequest): Promise<ActionResult>;

  /**
   * Validate an action before execution
   */
  validate(request: ActionRequest): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }>;
}

/**
 * Kubernetes executor config (all optional for partial config)
 */
export interface K8sFactoryConfig {
  kubeconfigPath?: string;
  context?: string;
  allowedNamespaces?: string[];
  allowedActions?: ActionType[];
  dryRunDefault?: boolean;
}

/**
 * Simulated executor config (all optional for partial config)
 */
export interface SimulatedFactoryConfig {
  demoAppUrl?: string;
  simulateLatencyMs?: number;
  simulateFailureRate?: number;
}

/**
 * Executor factory configuration
 */
export interface ExecutorFactoryConfig {
  mode: ExecutionMode;
  kubernetes?: K8sFactoryConfig;
  simulated?: SimulatedFactoryConfig;
}

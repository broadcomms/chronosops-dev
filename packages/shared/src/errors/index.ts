/**
 * Custom error hierarchy for ChronosOps
 */

export type ErrorCategory =
  | 'VALIDATION'
  | 'GEMINI'
  | 'KUBERNETES'
  | 'DATABASE'
  | 'VIDEO'
  | 'STATE_MACHINE'
  | 'CONFIGURATION'
  | 'NETWORK'
  | 'UNKNOWN';

export type ErrorSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ErrorContext {
  category: ErrorCategory;
  severity: ErrorSeverity;
  retryable: boolean;
  incidentId?: string;
  phase?: string;
  [key: string]: unknown;
}

/**
 * Base error class for ChronosOps
 */
export class ChronosOpsError extends Error {
  public readonly code: string;
  public readonly context: ErrorContext;
  public readonly timestamp: Date;

  constructor(
    message: string,
    code: string,
    context: Partial<ErrorContext> = {}
  ) {
    super(message);
    this.name = 'ChronosOpsError';
    this.code = code;
    this.context = {
      category: context.category ?? 'UNKNOWN',
      severity: context.severity ?? 'MEDIUM',
      retryable: context.retryable ?? false,
      ...context,
    };
    this.timestamp = new Date();

    // Maintains proper stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      timestamp: this.timestamp.toISOString(),
      stack: this.stack,
    };
  }
}

/**
 * Validation errors (user input, schema validation)
 */
export class ValidationError extends ChronosOpsError {
  constructor(message: string, context: Partial<ErrorContext> = {}) {
    super(message, 'E1001', {
      category: 'VALIDATION',
      severity: 'LOW',
      retryable: false,
      ...context,
    });
    this.name = 'ValidationError';
  }
}

/**
 * Gemini API errors
 */
export class GeminiError extends ChronosOpsError {
  constructor(message: string, code: string, context: Partial<ErrorContext> = {}) {
    super(message, code, {
      category: 'GEMINI',
      severity: 'MEDIUM',
      retryable: true,
      ...context,
    });
    this.name = 'GeminiError';
  }
}

export class GeminiRateLimitError extends GeminiError {
  public readonly retryAfterMs: number;

  constructor(retryAfterMs: number, context: Partial<ErrorContext> = {}) {
    super('Gemini API rate limit exceeded', 'E2001', {
      severity: 'MEDIUM',
      retryable: true,
      ...context,
    });
    this.name = 'GeminiRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class GeminiTimeoutError extends GeminiError {
  constructor(timeoutMs: number, context: Partial<ErrorContext> = {}) {
    super(`Gemini API call timed out after ${timeoutMs}ms`, 'E2002', {
      severity: 'MEDIUM',
      retryable: true,
      ...context,
    });
    this.name = 'GeminiTimeoutError';
  }
}

/**
 * Kubernetes errors
 */
export class KubernetesError extends ChronosOpsError {
  constructor(message: string, code: string, context: Partial<ErrorContext> = {}) {
    super(message, code, {
      category: 'KUBERNETES',
      severity: 'HIGH',
      retryable: false,
      ...context,
    });
    this.name = 'KubernetesError';
  }
}

export class NamespaceNotAllowedError extends KubernetesError {
  constructor(namespace: string, context: Partial<ErrorContext> = {}) {
    super(`Namespace '${namespace}' is not in the allowed list`, 'E3001', {
      severity: 'HIGH',
      retryable: false,
      ...context,
    });
    this.name = 'NamespaceNotAllowedError';
  }
}

export class ActionNotAllowedError extends KubernetesError {
  constructor(actionType: string, context: Partial<ErrorContext> = {}) {
    super(`Action type '${actionType}' is not permitted`, 'E3002', {
      severity: 'HIGH',
      retryable: false,
      ...context,
    });
    this.name = 'ActionNotAllowedError';
  }
}

export class ActionCooldownError extends KubernetesError {
  public readonly remainingMs: number;

  constructor(remainingMs: number, context: Partial<ErrorContext> = {}) {
    super(`Action cooldown active. Wait ${Math.ceil(remainingMs / 1000)}s`, 'E3003', {
      severity: 'LOW',
      retryable: true,
      ...context,
    });
    this.name = 'ActionCooldownError';
    this.remainingMs = remainingMs;
  }
}

/**
 * Database errors
 */
export class DatabaseError extends ChronosOpsError {
  constructor(message: string, code: string, context: Partial<ErrorContext> = {}) {
    super(message, code, {
      category: 'DATABASE',
      severity: 'HIGH',
      retryable: false,
      ...context,
    });
    this.name = 'DatabaseError';
  }
}

/**
 * State machine errors
 */
export class StateMachineError extends ChronosOpsError {
  constructor(message: string, code: string, context: Partial<ErrorContext> = {}) {
    super(message, code, {
      category: 'STATE_MACHINE',
      severity: 'HIGH',
      retryable: false,
      ...context,
    });
    this.name = 'StateMachineError';
  }
}

export class InvalidTransitionError extends StateMachineError {
  constructor(fromState: string, toState: string, context: Partial<ErrorContext> = {}) {
    super(`Invalid state transition: ${fromState} -> ${toState}`, 'E5001', {
      severity: 'MEDIUM',
      retryable: false,
      ...context,
    });
    this.name = 'InvalidTransitionError';
  }
}

/**
 * Configuration errors
 */
export class ConfigurationError extends ChronosOpsError {
  constructor(message: string, context: Partial<ErrorContext> = {}) {
    super(message, 'E6001', {
      category: 'CONFIGURATION',
      severity: 'CRITICAL',
      retryable: false,
      ...context,
    });
    this.name = 'ConfigurationError';
  }
}

/**
 * Helper to check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof ChronosOpsError) {
    return error.context.retryable;
  }
  return false;
}

/**
 * Helper to wrap unknown errors
 */
export function wrapError(error: unknown, context: Partial<ErrorContext> = {}): ChronosOpsError {
  if (error instanceof ChronosOpsError) {
    return error;
  }

  if (error instanceof Error) {
    return new ChronosOpsError(error.message, 'E9999', {
      category: 'UNKNOWN',
      severity: 'MEDIUM',
      retryable: false,
      originalError: error.name,
      ...context,
    });
  }

  return new ChronosOpsError(String(error), 'E9999', {
    category: 'UNKNOWN',
    severity: 'MEDIUM',
    retryable: false,
    ...context,
  });
}

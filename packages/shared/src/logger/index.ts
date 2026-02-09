/**
 * Structured logging for ChronosOps
 */

import pino from 'pino';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Re-export pino.Logger type for convenience
export type Logger = pino.Logger;

export interface LogContext {
  incidentId?: string;
  phase?: string;
  component?: string;
  [key: string]: unknown;
}

// Create base logger
function createBaseLogger(level: LogLevel = 'info') {
  return pino({
    level,
    transport:
      process.env.NODE_ENV === 'development'
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
    base: {
      service: 'chronosops',
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
  });
}

// Singleton logger instance
let loggerInstance: pino.Logger | null = null;

export function getLogger(): pino.Logger {
  if (!loggerInstance) {
    const level = (process.env.LOG_LEVEL as LogLevel) || 'info';
    loggerInstance = createBaseLogger(level);
  }
  return loggerInstance;
}

// Create child logger with context
export function createChildLogger(context: LogContext): pino.Logger {
  return getLogger().child(context);
}

// Convenience function to create a named logger
export function createLogger(name: string): pino.Logger {
  return createChildLogger({ component: name });
}

// Convenience logging functions
export function debug(message: string, context?: LogContext): void {
  getLogger().debug(context ?? {}, message);
}

export function info(message: string, context?: LogContext): void {
  getLogger().info(context ?? {}, message);
}

export function warn(message: string, context?: LogContext): void {
  getLogger().warn(context ?? {}, message);
}

export function error(message: string, error?: Error, context?: LogContext): void {
  getLogger().error({ ...context, err: error }, message);
}

// Structured event logging for OODA phases
export function logPhaseTransition(
  incidentId: string,
  fromPhase: string,
  toPhase: string,
  reason: string
): void {
  getLogger().info(
    {
      event: 'phase_transition',
      incidentId,
      fromPhase,
      toPhase,
      reason,
    },
    `Phase transition: ${fromPhase} -> ${toPhase}`
  );
}

export function logActionExecution(
  incidentId: string,
  actionType: string,
  target: string,
  dryRun: boolean
): void {
  getLogger().info(
    {
      event: 'action_execution',
      incidentId,
      actionType,
      target,
      dryRun,
    },
    `Executing action: ${actionType} on ${target}${dryRun ? ' (dry-run)' : ''}`
  );
}

export function logGeminiCall(
  operation: string,
  model: string,
  thinkingBudget: number,
  durationMs?: number
): void {
  getLogger().info(
    {
      event: 'gemini_call',
      operation,
      model,
      thinkingBudget,
      durationMs,
    },
    `Gemini ${operation} call${durationMs ? ` completed in ${durationMs}ms` : ''}`
  );
}

// Reset logger (for testing)
export function resetLogger(): void {
  loggerInstance = null;
}

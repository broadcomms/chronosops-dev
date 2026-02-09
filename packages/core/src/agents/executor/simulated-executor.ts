/**
 * Simulated Action Executor
 * Executes remediation actions by calling the demo app API
 * Used as a fallback when kubectl is not available
 *
 * Supports the NexusCart cinematic demo with 4 bug types:
 * - smart_recommendations (CPU + timeout)
 * - realtime_analytics (memory leak + queue)
 * - debug_mode (log explosion + latency)
 * - experimental_checkout (pod crash + errors)
 */

import type {
  ActionExecutor,
  ActionRequest,
  ActionResult,
  ExecutionMode,
} from './types.js';
import { EXECUTION_MODES } from './types.js';
import { createChildLogger } from '@chronosops/shared';

const logger = createChildLogger({ component: 'SimulatedExecutor' });

/**
 * Bug mapping for hypothesis-based remediation
 * Maps keywords in the hypothesis to specific bug IDs
 */
interface BugMapping {
  keywords: string[];
  bugId: string;
}

const BUG_MAPPINGS: BugMapping[] = [
  {
    keywords: ['recommendation', 'ml', 'inference', 'gpu', 'cpu spike', 'cpu usage', 'high cpu', 'model', 'scoring'],
    bugId: 'smart_recommendations',
  },
  {
    keywords: ['memory', 'leak', 'heap', 'queue', 'analytics', 'oom', 'out of memory', 'event queue', 'kafka'],
    bugId: 'realtime_analytics',
  },
  {
    keywords: ['debug', 'logging', 'verbose', 'log volume', 'disk', 'log explosion', 'trace'],
    bugId: 'debug_mode',
  },
  {
    keywords: ['checkout', 'payment', 'pod', 'crash', 'restart', 'crashloop', 'stripe', 'transaction', '500 error'],
    bugId: 'experimental_checkout',
  },
];

export interface SimulatedExecutorConfig {
  demoAppUrl: string;
  simulateLatencyMs: number;
  simulateFailureRate: number;
}

const DEFAULT_CONFIG: SimulatedExecutorConfig = {
  demoAppUrl: 'http://localhost:8080',
  simulateLatencyMs: 500,
  simulateFailureRate: 0,
};

export class SimulatedExecutor implements ActionExecutor {
  readonly name = 'SimulatedExecutor';
  readonly mode: ExecutionMode = EXECUTION_MODES.SIMULATED;

  private config: SimulatedExecutorConfig;

  constructor(config: Partial<SimulatedExecutorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Always available (it's simulated)
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.demoAppUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Validate action - always valid for simulation
   */
  async validate(request: ActionRequest): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    return {
      valid: true,
      errors: [],
      warnings: [
        'Using simulated executor - actions will be simulated via demo app API',
        `Target: ${request.target.namespace}/${request.target.deployment}`,
      ],
    };
  }

  /**
   * Execute action by calling demo app API
   * Uses hypothesis-based bug detection to call the correct endpoint
   */
  async execute(request: ActionRequest): Promise<ActionResult> {
    const startTime = Date.now();

    // Determine which bug to disable based on the action reason (hypothesis)
    const bugId = this.determineBugFromHypothesis(request.reason);

    logger.info(
      { actionType: request.type, target: request.target, bugId },
      'Simulating action execution with targeted bug remediation'
    );

    // Simulate latency
    if (this.config.simulateLatencyMs > 0) {
      await this.delay(this.config.simulateLatencyMs);
    }

    // Simulate random failures
    if (Math.random() < this.config.simulateFailureRate) {
      return {
        success: false,
        mode: this.mode,
        action: request,
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
        message: `[SIMULATED] Action failed (random failure simulation)`,
        details: {
          error: 'Simulated failure for testing purposes',
        },
      };
    }

    try {
      // Determine endpoint based on bug detection
      // If we identified a specific bug, call /bugs/:bugId/disable
      // Otherwise, fall back to /bug/disable (legacy endpoint that disables all)
      const endpoint = bugId
        ? `${this.config.demoAppUrl}/bugs/${bugId}/disable`
        : `${this.config.demoAppUrl}/bug/disable`;

      logger.info({ endpoint, bugId, reason: request.reason }, 'Calling demo app remediation endpoint');

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'chronosops', reason: request.reason }),
        signal: AbortSignal.timeout(10000),
      });

      const data = (await response.json()) as { success: boolean; message: string; bugId?: string };

      if (response.ok && data.success) {
        return {
          success: true,
          mode: this.mode,
          action: request,
          timestamp: new Date(),
          durationMs: Date.now() - startTime,
          message: `[SIMULATED] Successfully executed ${request.type} on ${request.target.deployment}`,
          details: {
            command: `POST ${endpoint}`,
            output: data.message,
            detectedBug: bugId ?? 'unknown',
            previousState: { bugEnabled: true },
            newState: { bugEnabled: false },
          },
        };
      }

      // Bug was already disabled - still counts as success
      if (response.status === 409) {
        return {
          success: true,
          mode: this.mode,
          action: request,
          timestamp: new Date(),
          durationMs: Date.now() - startTime,
          message: `[SIMULATED] ${request.type} completed - system already in healthy state`,
          details: {
            command: `POST ${endpoint}`,
            output: data.message,
            detectedBug: bugId ?? 'unknown',
          },
        };
      }

      return {
        success: false,
        mode: this.mode,
        action: request,
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
        message: `[SIMULATED] API call failed: ${data.message}`,
        details: {
          error: data.message,
          detectedBug: bugId ?? 'unknown',
        },
      };
    } catch (error) {
      const err = error as Error;
      return {
        success: false,
        mode: this.mode,
        action: request,
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
        message: `[SIMULATED] Failed to call demo app: ${err.message}`,
        details: {
          error: err.message,
          detectedBug: bugId ?? 'unknown',
        },
      };
    }
  }

  /**
   * Determine which bug to disable based on keywords in the hypothesis
   * Returns the bug ID if a match is found, or null for legacy fallback
   */
  private determineBugFromHypothesis(hypothesis?: string): string | null {
    if (!hypothesis) return null;

    const lowerHypothesis = hypothesis.toLowerCase();

    for (const mapping of BUG_MAPPINGS) {
      for (const keyword of mapping.keywords) {
        if (lowerHypothesis.includes(keyword.toLowerCase())) {
          logger.debug(
            { keyword, bugId: mapping.bugId, hypothesis: hypothesis.substring(0, 100) },
            'Matched hypothesis to bug'
          );
          return mapping.bugId;
        }
      }
    }

    logger.debug({ hypothesis: hypothesis.substring(0, 100) }, 'No bug match found, will use legacy endpoint');
    return null;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

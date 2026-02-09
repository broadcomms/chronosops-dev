/**
 * Verification Service
 * Confirms action success/failure through multi-modal verification
 */

import { EventEmitter } from 'events';
import { createChildLogger } from '@chronosops/shared';
import type { ActionResult, ActionType } from '../agents/executor/types.js';
import type { Metric } from '../ingestion/types.js';
import { LogParser } from '../ingestion/log-parser.js';
import {
  DEFAULT_VERIFICATION_CONFIG,
  type VerificationConfig,
  type VerificationCheck,
  type VerificationResult,
  type VerificationServiceConfig,
  type MetricVerificationInput,
  type MetricVerificationResult,
  type LogVerificationInput,
  type LogVerificationResult,
  type VisualVerificationResult,
  type HealthCheckInput,
  type HealthCheckResult,
  type GeminiVerificationRequest,
  type GeminiVerificationResponse,
} from './types.js';

export class VerificationService extends EventEmitter {
  private logger = createChildLogger({ component: 'VerificationService' });
  private config: VerificationServiceConfig;
  private logParser: LogParser;

  // Gemini client injection point
  private geminiClient?: {
    generateContent: (request: GeminiVerificationRequest) => Promise<GeminiVerificationResponse>;
  };

  // K8s client injection point
  private k8sClient?: {
    getPodStatus: (namespace: string, selector?: Record<string, string>) => Promise<Array<{
      name: string;
      status: string;
      ready: boolean;
      restarts: number;
      reason?: string;
    }>>;
    exec: (namespace: string, pod: string, command: string[]) => Promise<string>;
  };

  constructor(config: Partial<VerificationServiceConfig> = {}) {
    super();
    this.config = {
      defaultConfig: { ...DEFAULT_VERIFICATION_CONFIG, ...config.defaultConfig },
      kubernetesEnabled: config.kubernetesEnabled ?? true,
      geminiEnabled: config.geminiEnabled ?? true,
      metricsSource: config.metricsSource,
      logSource: config.logSource,
      dashboardCapture: config.dashboardCapture,
    };
    this.logParser = new LogParser();
  }

  /**
   * Inject Gemini client for AI-powered verification
   */
  setGeminiClient(client: typeof this.geminiClient): void {
    this.geminiClient = client;
  }

  /**
   * Inject Kubernetes client for health checks
   */
  setK8sClient(client: typeof this.k8sClient): void {
    this.k8sClient = client;
  }

  /**
   * Main verification entry point
   */
  async verify(
    action: ActionResult,
    incidentId: string,
    preActionState?: {
      metrics?: Metric[];
      logs?: string[];
      frameId?: string;
    },
    postActionState?: {
      metrics?: Metric[];
      logs?: string[];
      frameId?: string;
    },
    configOverrides?: Partial<VerificationConfig>
  ): Promise<VerificationResult> {
    const config = { ...this.config.defaultConfig, ...configOverrides };
    const verificationId = `ver-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const actionId = `act-${action.timestamp.getTime()}`;
    const startTime = new Date();

    this.logger.info(
      { actionId, incidentId, strategy: config.strategy },
      'Starting verification'
    );

    // Wait for cooldown period before verifying
    if (config.cooldownMs > 0) {
      this.logger.debug({ cooldownMs: config.cooldownMs }, 'Waiting for cooldown period');
      await this.delay(config.cooldownMs);
    }

    const checks: VerificationCheck[] = [];
    let metricResults: MetricVerificationResult[] | undefined;
    let logResult: LogVerificationResult | undefined;
    let visualResult: VisualVerificationResult | undefined;
    let healthResult: HealthCheckResult | undefined;

    try {
      // Run enabled verification checks
      if (config.enableMetricVerification && preActionState?.metrics && postActionState?.metrics) {
        const metricCheck = this.createCheck('metric_comparison', 'Metric Verification');
        checks.push(metricCheck);
        this.emitCheckStarted(metricCheck);

        metricResults = await this.verifyMetrics(
          preActionState.metrics,
          postActionState.metrics,
          this.inferMetricExpectations(action.action.type)
        );

        metricCheck.status = 'passed';
        metricCheck.completedAt = new Date();
        metricCheck.result = {
          passed: metricResults.every(r => r.met),
          confidence: this.averageConfidence(metricResults.map(r => r.confidence)),
          details: this.summarizeMetricResults(metricResults),
          evidence: metricResults.map(r => r.metricName),
        };
        this.emitCheckCompleted(metricCheck);
      }

      if (config.enableLogVerification && postActionState?.logs) {
        const logCheck = this.createCheck('log_analysis', 'Log Verification');
        checks.push(logCheck);
        this.emitCheckStarted(logCheck);

        logResult = await this.verifyLogs(postActionState.logs, {
          successPatterns: this.inferSuccessPatterns(action.action.type),
          failurePatterns: this.inferFailurePatterns(),
          timeWindowMs: 60000,
        });

        logCheck.status = logResult.verdict === 'inconclusive' ? 'inconclusive' : 'passed';
        logCheck.completedAt = new Date();
        logCheck.result = {
          passed: logResult.verdict === 'success',
          confidence: logResult.confidence,
          details: `Found ${logResult.successIndicators} success indicators, ${logResult.failureIndicators} failure indicators`,
          evidence: [...logResult.successPatternsFound, ...logResult.failurePatternsFound],
        };
        this.emitCheckCompleted(logCheck);
      }

      // Health check for K8s actions
      const actionTarget = action.action.target;
      if (this.config.kubernetesEnabled && this.k8sClient && actionTarget) {
        const healthCheck = this.createCheck('health_check', 'Health Check');
        checks.push(healthCheck);
        this.emitCheckStarted(healthCheck);

        healthResult = await this.performHealthCheck({
          podSelector: {
            namespace: actionTarget.namespace ?? 'default',
            name: actionTarget.deployment,
          },
        });

        healthCheck.status = healthResult.healthy ? 'passed' : 'failed';
        healthCheck.completedAt = new Date();
        healthCheck.result = {
          passed: healthResult.healthy,
          confidence: healthResult.confidence,
          details: healthResult.details,
          evidence: [`${healthResult.healthyPods}/${healthResult.podsChecked} pods healthy`],
        };
        this.emitCheckCompleted(healthCheck);
      }

      // Visual verification if enabled and frames available
      if (config.enableVisualVerification && preActionState?.frameId && postActionState?.frameId) {
        const visualCheck = this.createCheck('visual_confirmation', 'Visual Verification');
        checks.push(visualCheck);
        this.emitCheckStarted(visualCheck);

        // Visual verification would typically involve Gemini to analyze frames
        // Placeholder for now - would need frame data passed in
        visualResult = {
          changesObserved: [],
          expectedChangesMet: [],
          overallHealth: 'healthy',
          improvement: true,
          confidence: 0.5,
        };

        visualCheck.status = 'inconclusive';
        visualCheck.completedAt = new Date();
        visualCheck.result = {
          passed: visualResult.improvement,
          confidence: visualResult.confidence,
          details: 'Visual verification requires frame comparison',
          evidence: [],
        };
        this.emitCheckCompleted(visualCheck);
      }

      // Gemini multi-modal verification if enabled
      if (this.config.geminiEnabled && this.geminiClient && config.strategy === 'multi_modal') {
        const geminiCheck = this.createCheck('multi_modal', 'AI Analysis');
        checks.push(geminiCheck);
        this.emitCheckStarted(geminiCheck);

        try {
          const geminiResult = await this.geminiClient.generateContent({
            incidentId,
            action: {
              type: action.action.type,
              target: action.action.target?.deployment ?? 'unknown',
              description: action.message,
            },
            preActionState: {
              metrics: preActionState?.metrics,
              logSamples: preActionState?.logs,
            },
            postActionState: {
              metrics: postActionState?.metrics,
              logSamples: postActionState?.logs,
            },
            expectedOutcome: `Action ${action.action.type} should resolve the incident`,
          });

          geminiCheck.status = geminiResult.success ? 'passed' : 'failed';
          geminiCheck.completedAt = new Date();
          geminiCheck.result = {
            passed: geminiResult.success,
            confidence: geminiResult.confidence,
            details: geminiResult.verdict,
            evidence: geminiResult.improvements,
          };
        } catch (error) {
          geminiCheck.status = 'failed';
          geminiCheck.error = error instanceof Error ? error.message : 'Unknown error';
        }
        this.emitCheckCompleted(geminiCheck);
      }

      // Calculate overall result
      const endTime = new Date();
      const result = this.calculateOverallResult(
        verificationId,
        actionId,
        incidentId,
        startTime,
        endTime,
        checks,
        metricResults,
        logResult,
        visualResult,
        healthResult,
        config
      );

      this.logger.info(
        { verificationId, success: result.success, confidence: result.confidence, verdict: result.verdict },
        'Verification complete'
      );

      this.emit('verificationComplete', result);
      return result;
    } catch (error) {
      this.logger.error({ error, verificationId }, 'Verification failed with error');
      this.emit('error', error instanceof Error ? error : new Error(String(error)));

      return this.createFailedResult(
        verificationId,
        actionId,
        incidentId,
        startTime,
        checks,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Verify metrics by comparing pre and post action values
   */
  async verifyMetrics(
    preMetrics: Metric[],
    postMetrics: Metric[],
    expectations: MetricVerificationInput[]
  ): Promise<MetricVerificationResult[]> {
    const results: MetricVerificationResult[] = [];

    for (const expectation of expectations) {
      const preMet = preMetrics.find(m => m.name === expectation.metricName);
      const postMet = postMetrics.find(m => m.name === expectation.metricName);

      if (!preMet || !postMet) {
        results.push({
          metricName: expectation.metricName,
          preActionValue: preMet?.value ?? 0,
          postActionValue: postMet?.value ?? 0,
          changePercent: 0,
          expectedImprovement: expectation.expectedImprovement,
          met: false,
          confidence: 0.3,
          details: `Metric ${expectation.metricName} not found in pre or post action data`,
        });
        continue;
      }

      const changePercent = ((postMet.value - preMet.value) / Math.max(preMet.value, 0.001)) * 100;
      const threshold = expectation.thresholdPercent ?? 10;

      let met = false;
      let confidence = 0.5;

      switch (expectation.expectedImprovement) {
        case 'decrease':
          met = changePercent <= -threshold;
          confidence = met ? Math.min(0.9, 0.5 + Math.abs(changePercent) / 100) : 0.3;
          break;
        case 'increase':
          met = changePercent >= threshold;
          confidence = met ? Math.min(0.9, 0.5 + Math.abs(changePercent) / 100) : 0.3;
          break;
        case 'stabilize':
          met = Math.abs(changePercent) <= threshold / 2;
          confidence = met ? 0.8 : 0.4;
          break;
      }

      results.push({
        metricName: expectation.metricName,
        preActionValue: preMet.value,
        postActionValue: postMet.value,
        changePercent,
        expectedImprovement: expectation.expectedImprovement,
        met,
        confidence,
        details: `${expectation.metricName}: ${preMet.value.toFixed(2)} → ${postMet.value.toFixed(2)} (${changePercent > 0 ? '+' : ''}${changePercent.toFixed(1)}%)`,
      });
    }

    return results;
  }

  /**
   * Verify by analyzing logs for success/failure patterns
   */
  async verifyLogs(
    logs: string[],
    input: LogVerificationInput
  ): Promise<LogVerificationResult> {
    const logContent = logs.join('\n');
    const parsedLogs = this.logParser.parse(logContent);

    const successPatternsFound: string[] = [];
    const failurePatternsFound: string[] = [];

    for (const pattern of input.successPatterns) {
      const regex = new RegExp(pattern, 'i');
      if (parsedLogs.some(l => regex.test(l.message))) {
        successPatternsFound.push(pattern);
      }
    }

    for (const pattern of input.failurePatterns) {
      const regex = new RegExp(pattern, 'i');
      if (parsedLogs.some(l => regex.test(l.message))) {
        failurePatternsFound.push(pattern);
      }
    }

    const successIndicators = successPatternsFound.length;
    const failureIndicators = failurePatternsFound.length;

    let verdict: 'success' | 'failure' | 'inconclusive';
    let confidence: number;

    if (successIndicators > 0 && failureIndicators === 0) {
      verdict = 'success';
      confidence = Math.min(0.9, 0.5 + successIndicators * 0.1);
    } else if (failureIndicators > 0 && successIndicators === 0) {
      verdict = 'failure';
      confidence = Math.min(0.9, 0.5 + failureIndicators * 0.1);
    } else if (successIndicators > failureIndicators) {
      verdict = 'success';
      confidence = 0.5 + (successIndicators - failureIndicators) * 0.05;
    } else if (failureIndicators > successIndicators) {
      verdict = 'failure';
      confidence = 0.5 + (failureIndicators - successIndicators) * 0.05;
    } else {
      verdict = 'inconclusive';
      confidence = 0.3;
    }

    return {
      successPatternsFound,
      failurePatternsFound,
      totalLogsAnalyzed: parsedLogs.length,
      successIndicators,
      failureIndicators,
      verdict,
      confidence,
      sampleLogs: parsedLogs.slice(0, 5).map(l => l.message),
    };
  }

  /**
   * Perform health check on pods/deployments
   */
  async performHealthCheck(input: HealthCheckInput): Promise<HealthCheckResult> {
    if (!this.k8sClient) {
      return {
        healthy: false,
        podsChecked: 0,
        healthyPods: 0,
        unhealthyPods: [],
        confidence: 0,
        details: 'Kubernetes client not available',
      };
    }

    try {
      const pods = await this.k8sClient.getPodStatus(
        input.podSelector?.namespace ?? 'default',
        input.podSelector?.labels
      );

      // Filter by name if specified
      const targetPods = input.podSelector?.name
        ? pods.filter(p => p.name.includes(input.podSelector!.name!))
        : pods;

      const healthyPods = targetPods.filter(p => p.ready && p.status === 'Running');
      const unhealthyPods = targetPods
        .filter(p => !p.ready || p.status !== 'Running')
        .map(p => ({
          name: p.name,
          reason: p.reason ?? 'Unknown',
          status: p.status,
        }));

      const healthyRatio = targetPods.length > 0 ? healthyPods.length / targetPods.length : 0;

      return {
        healthy: healthyRatio >= 0.8,
        podsChecked: targetPods.length,
        healthyPods: healthyPods.length,
        unhealthyPods,
        confidence: Math.min(0.9, 0.5 + healthyRatio * 0.4),
        details: `${healthyPods.length}/${targetPods.length} pods are healthy and running`,
      };
    } catch (error) {
      this.logger.error({ error }, 'Health check failed');
      return {
        healthy: false,
        podsChecked: 0,
        healthyPods: 0,
        unhealthyPods: [],
        confidence: 0.2,
        details: `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Infer metric expectations based on action type
   */
  private inferMetricExpectations(actionType: ActionType): MetricVerificationInput[] {
    const expectations: MetricVerificationInput[] = [];

    switch (actionType) {
      case 'restart':
        expectations.push(
          { metricName: 'error_rate', preActionValue: 0, expectedImprovement: 'decrease', thresholdPercent: 20 },
          { metricName: 'pod_restarts', preActionValue: 0, expectedImprovement: 'stabilize', thresholdPercent: 50 }
        );
        break;
      case 'scale':
        expectations.push(
          { metricName: 'cpu_utilization', preActionValue: 0, expectedImprovement: 'decrease', thresholdPercent: 15 },
          { metricName: 'memory_utilization', preActionValue: 0, expectedImprovement: 'decrease', thresholdPercent: 10 },
          { metricName: 'response_time_p99', preActionValue: 0, expectedImprovement: 'decrease', thresholdPercent: 20 }
        );
        break;
      case 'rollback':
        expectations.push(
          { metricName: 'error_rate', preActionValue: 0, expectedImprovement: 'decrease', thresholdPercent: 30 },
          { metricName: 'request_success_rate', preActionValue: 0, expectedImprovement: 'increase', thresholdPercent: 10 }
        );
        break;
      default:
        expectations.push(
          { metricName: 'error_rate', preActionValue: 0, expectedImprovement: 'decrease', thresholdPercent: 10 }
        );
    }

    return expectations;
  }

  /**
   * Infer success log patterns based on action type
   */
  private inferSuccessPatterns(actionType: ActionType): string[] {
    const common = ['successfully', 'completed', 'healthy', 'ready', 'started'];

    switch (actionType) {
      case 'restart':
        return [...common, 'restarted', 'pod running', 'container started'];
      case 'scale':
        return [...common, 'scaled', 'replicas ready', 'deployment updated'];
      case 'rollback':
        return [...common, 'rolled back', 'revision', 'deployment rolled back'];
      default:
        return common;
    }
  }

  /**
   * Infer failure log patterns
   */
  private inferFailurePatterns(): string[] {
    return [
      'error',
      'failed',
      'crash',
      'CrashLoopBackOff',
      'OOMKilled',
      'timeout',
      'unhealthy',
      'terminating',
      'ImagePullBackOff',
      'ErrImagePull',
      'CreateContainerError',
    ];
  }

  /**
   * Calculate overall verification result
   */
  private calculateOverallResult(
    verificationId: string,
    actionId: string,
    incidentId: string,
    startTime: Date,
    endTime: Date,
    checks: VerificationCheck[],
    metricResults?: MetricVerificationResult[],
    logResult?: LogVerificationResult,
    visualResult?: VisualVerificationResult,
    healthResult?: HealthCheckResult,
    config?: VerificationConfig
  ): VerificationResult {
    const passedChecks = checks.filter(c => c.status === 'passed');
    const failedChecks = checks.filter(c => c.status === 'failed');
    const inconclusiveChecks = checks.filter(c => c.status === 'inconclusive');

    // Calculate overall confidence
    const confidences = checks
      .filter(c => c.result?.confidence !== undefined)
      .map(c => c.result!.confidence);
    const avgConfidence = confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : 0.5;

    // Determine verdict
    let verdict: VerificationResult['verdict'];
    let success: boolean;

    if (failedChecks.length > 0 && passedChecks.length === 0) {
      verdict = 'confirmed_failure';
      success = false;
    } else if (passedChecks.length > 0 && failedChecks.length === 0) {
      verdict = 'confirmed_success';
      success = true;
    } else if (passedChecks.length > failedChecks.length) {
      verdict = 'partial_success';
      success = avgConfidence >= (config?.successThreshold ?? 0.7);
    } else if (checks.length === 0 || inconclusiveChecks.length === checks.length) {
      verdict = 'inconclusive';
      success = false;
    } else {
      verdict = 'confirmed_failure';
      success = false;
    }

    // Generate recommendations
    const recommendations: string[] = [];
    if (!success) {
      if (healthResult && !healthResult.healthy) {
        recommendations.push('Check pod logs for crash reasons');
        recommendations.push('Verify resource limits are sufficient');
      }
      if (logResult?.verdict === 'failure') {
        recommendations.push('Investigate error logs for root cause');
      }
      if (metricResults?.some(m => !m.met)) {
        recommendations.push('Allow more time for metrics to stabilize');
      }
    }

    // Determine if retry is warranted
    const shouldRetry = !success && failedChecks.length < passedChecks.length + inconclusiveChecks.length;

    return {
      id: verificationId,
      actionId,
      incidentId,
      timestamp: endTime,
      success,
      confidence: avgConfidence,
      verdict,
      checks,
      metricVerification: metricResults,
      logVerification: logResult,
      visualVerification: visualResult,
      healthCheck: healthResult,
      verificationStartedAt: startTime,
      verificationCompletedAt: endTime,
      durationMs: endTime.getTime() - startTime.getTime(),
      summary: this.generateSummary(verdict, checks, avgConfidence),
      recommendations,
      shouldRetry,
      retryReason: shouldRetry ? 'Some checks were inconclusive or showed partial success' : undefined,
    };
  }

  /**
   * Generate verification summary
   */
  private generateSummary(
    verdict: VerificationResult['verdict'],
    checks: VerificationCheck[],
    confidence: number
  ): string {
    const passed = checks.filter(c => c.status === 'passed').length;
    const total = checks.length;

    switch (verdict) {
      case 'confirmed_success':
        return `Action verified successful. ${passed}/${total} checks passed with ${(confidence * 100).toFixed(0)}% confidence.`;
      case 'confirmed_failure':
        return `Action verification failed. Only ${passed}/${total} checks passed. Investigation recommended.`;
      case 'partial_success':
        return `Action partially successful. ${passed}/${total} checks passed. Some improvements observed but not all criteria met.`;
      case 'inconclusive':
        return `Verification inconclusive. Unable to determine action outcome with sufficient confidence.`;
    }
  }

  /**
   * Summarize metric verification results
   */
  private summarizeMetricResults(results: MetricVerificationResult[]): string {
    const met = results.filter(r => r.met).length;
    return `${met}/${results.length} metric expectations met. ` +
      results.map(r => `${r.metricName}: ${r.met ? '✓' : '✗'}`).join(', ');
  }

  /**
   * Calculate average confidence from array
   */
  private averageConfidence(confidences: number[]): number {
    if (confidences.length === 0) return 0.5;
    return confidences.reduce((a, b) => a + b, 0) / confidences.length;
  }

  /**
   * Create a verification check object
   */
  private createCheck(
    strategy: VerificationCheck['strategy'],
    name: string
  ): VerificationCheck {
    return {
      id: `chk-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name,
      description: `${name} using ${strategy} strategy`,
      strategy,
      status: 'pending',
      startedAt: new Date(),
    };
  }

  /**
   * Create a failed verification result
   */
  private createFailedResult(
    verificationId: string,
    actionId: string,
    incidentId: string,
    startTime: Date,
    checks: VerificationCheck[],
    errorMessage: string
  ): VerificationResult {
    const endTime = new Date();
    return {
      id: verificationId,
      actionId,
      incidentId,
      timestamp: endTime,
      success: false,
      confidence: 0,
      verdict: 'inconclusive',
      checks,
      verificationStartedAt: startTime,
      verificationCompletedAt: endTime,
      durationMs: endTime.getTime() - startTime.getTime(),
      summary: `Verification failed with error: ${errorMessage}`,
      recommendations: ['Check service connectivity', 'Verify Kubernetes access'],
      shouldRetry: true,
      retryReason: 'Verification encountered an error',
    };
  }

  /**
   * Emit check started event
   */
  private emitCheckStarted(check: VerificationCheck): void {
    check.status = 'running';
    this.emit('checkStarted', check);
  }

  /**
   * Emit check completed event
   */
  private emitCheckCompleted(check: VerificationCheck): void {
    this.emit('checkCompleted', check);
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

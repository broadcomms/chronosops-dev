/**
 * Correlation Engine
 * Finds causal relationships between signals across modalities
 */

import { randomUUID } from 'crypto';
import { createChildLogger, type Evidence } from '@chronosops/shared';
import type { GeminiClient } from '@chronosops/gemini';
import { THINKING_BUDGETS } from '@chronosops/gemini';
import type { InfraEvent } from '../ingestion/types.js';
import type {
  Signal,
  SignalType,
  VisualSignal,
  LogSignal,
  MetricSignal,
  EventSignal,
  AlignedData,
  Correlation,
  CausalChain,
  CorrelationResult,
  CorrelationEngineConfig,
} from './types.js';

const DEFAULT_CONFIG: CorrelationEngineConfig = {
  windowMs: 30000,               // 30 seconds
  minCorrelationConfidence: 0.5,
  maxCorrelations: 20,
  enableGeminiCorrelation: true,
  causalityTimeThreshold: 300000, // 5 minutes
};

/**
 * Helper to convert timestamp (Date or string) to milliseconds
 */
function getTimestampMs(ts: Date | string): number {
  return ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
}

export class CorrelationEngine {
  private geminiClient?: GeminiClient;
  private config: CorrelationEngineConfig;
  private logger = createChildLogger({ component: 'CorrelationEngine' });

  constructor(
    geminiClient?: GeminiClient,
    config: Partial<CorrelationEngineConfig> = {}
  ) {
    this.geminiClient = geminiClient;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Align all data sources by time window
   */
  alignByTime(
    visual: VisualSignal[],
    logs: LogSignal[],
    metrics: MetricSignal[],
    events: EventSignal[],
    windowMs?: number
  ): AlignedData[] {
    const window = windowMs ?? this.config.windowMs;

    // Collect all timestamps
    const allSignals: Signal[] = [...visual, ...logs, ...metrics, ...events];

    if (allSignals.length === 0) {
      return [];
    }

    const timestamps = allSignals.map((s) => getTimestampMs(s.timestamp));
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);

    // Create time windows
    const alignedData: AlignedData[] = [];

    for (let t = minTime; t <= maxTime; t += window) {
      const windowStart = new Date(t);
      const windowEnd = new Date(t + window);

      const inWindow = (ts: Date | string) => {
        const time = getTimestampMs(ts);
        return time >= t && time < t + window;
      };

      const windowVisual = visual.filter((s) => inWindow(s.timestamp));
      const windowLogs = logs.filter((s) => inWindow(s.timestamp));
      const windowMetrics = metrics.filter((s) => inWindow(s.timestamp));
      const windowEvents = events.filter((s) => inWindow(s.timestamp));

      const signalCount =
        windowVisual.length +
        windowLogs.length +
        windowMetrics.length +
        windowEvents.length;

      // Skip empty windows
      if (signalCount === 0) {
        continue;
      }

      // Determine dominant signal type
      const counts: Record<SignalType, number> = {
        visual: windowVisual.length,
        log: windowLogs.length,
        metric: windowMetrics.length,
        event: windowEvents.length,
      };
      const dominantSignalType = (Object.entries(counts) as [SignalType, number][])
        .sort((a, b) => b[1] - a[1])[0]?.[0];

      alignedData.push({
        timestamp: windowStart,
        window: { start: windowStart, end: windowEnd },
        visual: windowVisual,
        logs: windowLogs,
        metrics: windowMetrics,
        events: windowEvents,
        signalCount,
        dominantSignalType,
      });
    }

    this.logger.debug({
      windowCount: alignedData.length,
      totalSignals: allSignals.length,
    }, 'Aligned data by time');

    return alignedData;
  }

  /**
   * Convert evidence to signals for correlation
   */
  evidenceToSignals(evidence: Evidence[]): {
    visual: VisualSignal[];
    logs: LogSignal[];
    metrics: MetricSignal[];
    events: EventSignal[];
  } {
    const visual: VisualSignal[] = [];
    const logs: LogSignal[] = [];
    const metrics: MetricSignal[] = [];
    const events: EventSignal[] = [];

    for (const ev of evidence) {
      const baseSignal = {
        id: ev.id,
        timestamp: ev.timestamp,
        source: ev.source,
        confidence: ev.confidence ?? undefined,
      };

      switch (ev.type) {
        case 'video_frame': {
          const content = ev.content as {
            anomalyType?: string;
            description?: string;
            severity?: string;
            healthy?: boolean;
            metrics?: Array<{ name: string; value: number; unit: string; status: string }>;
          };

          visual.push({
            ...baseSignal,
            type: 'visual',
            severity: this.mapSeverity(content.severity),
            description: content.description ?? 'Visual observation',
            data: {
              frameId: ev.id,
              systemState: content.healthy === false ? 'critical' : 'healthy',
              anomalies: content.anomalyType ? [{
                type: content.anomalyType,
                description: content.description ?? '',
                severity: content.severity ?? 'medium',
              }] : [],
              metrics: content.metrics ?? [],
            },
          });
          break;
        }

        case 'log': {
          const content = ev.content as {
            description?: string;
            pattern?: string;
            severity?: string;
            count?: number;
          };

          logs.push({
            ...baseSignal,
            type: 'log',
            severity: this.mapSeverity(content.severity),
            description: content.description ?? content.pattern ?? 'Log entry',
            data: {
              id: ev.id,
              timestamp: ev.timestamp,
              level: content.severity === 'high' || content.severity === 'critical' ? 'error' : 'warn',
              source: ev.source,
              message: content.description ?? '',
              metadata: ev.metadata ?? {},
              raw: JSON.stringify(content),
            },
          });
          break;
        }

        case 'metric': {
          const content = ev.content as {
            name?: string;
            value?: number;
            unit?: string;
            trend?: string;
            description?: string;
          };

          metrics.push({
            ...baseSignal,
            type: 'metric',
            severity: 'medium',
            description: content.description ?? `${content.name}: ${content.value}${content.unit ?? ''}`,
            data: {
              name: content.name ?? 'unknown',
              timestamp: ev.timestamp,
              value: content.value ?? 0,
              labels: {},
            },
          });
          break;
        }

        case 'k8s_event': {
          const content = ev.content as {
            type?: string;
            description?: string;
            severity?: string;
            target?: string;
          };

          const eventSeverity = this.mapSeverity(content.severity);
          events.push({
            ...baseSignal,
            type: 'event',
            severity: eventSeverity,
            description: content.description ?? 'K8s event',
            data: {
              id: ev.id,
              type: (content.type as InfraEvent['type']) ?? 'k8s_event',
              timestamp: ev.timestamp,
              description: content.description ?? '',
              actor: ev.source,
              target: content.target ?? '',
              metadata: ev.metadata ?? {},
              severity: this.mapToInfraEventSeverity(eventSeverity),
            },
          });
          break;
        }
      }
    }

    return { visual, logs, metrics, events };
  }

  /**
   * Find correlations between signals using heuristics
   */
  findCorrelationsHeuristic(aligned: AlignedData[]): Correlation[] {
    const correlations: Correlation[] = [];

    for (const window of aligned) {
      const allSignals: Signal[] = [
        ...window.visual,
        ...window.logs,
        ...window.metrics,
        ...window.events,
      ];

      if (allSignals.length < 2) {
        continue;
      }

      // Find temporal correlations (signals in same window)
      if (allSignals.length >= 2) {
        const temporalCorrelation = this.createTemporalCorrelation(
          allSignals,
          window
        );
        if (temporalCorrelation.confidence >= this.config.minCorrelationConfidence) {
          correlations.push(temporalCorrelation);
        }
      }

      // Find error correlations (errors + related metrics)
      const errorSignals = allSignals.filter(
        (s) => s.severity === 'high' || s.severity === 'critical'
      );
      const metricSignals = window.metrics;

      if (errorSignals.length > 0 && metricSignals.length > 0) {
        const symptomaticCorrelation = this.createSymptomaticCorrelation(
          errorSignals,
          metricSignals,
          window
        );
        if (symptomaticCorrelation) {
          correlations.push(symptomaticCorrelation);
        }
      }

      // Find event-to-error correlations (potential causal)
      const eventSignals = window.events;
      if (eventSignals.length > 0 && errorSignals.length > 0) {
        const causalCorrelation = this.createCausalCorrelation(
          eventSignals,
          errorSignals,
          window
        );
        if (causalCorrelation) {
          correlations.push(causalCorrelation);
        }
      }
    }

    // Sort by confidence and limit
    correlations.sort((a, b) => b.confidence - a.confidence);
    return correlations.slice(0, this.config.maxCorrelations);
  }

  /**
   * Find correlations using Gemini
   */
  async findCorrelationsWithGemini(
    aligned: AlignedData[],
    incidentId: string
  ): Promise<Correlation[]> {
    if (!this.geminiClient) {
      this.logger.warn('Gemini client not configured, using heuristics');
      return this.findCorrelationsHeuristic(aligned);
    }

    try {
      // Build prompt for context (logging purposes)
      this.buildCorrelationPrompt(aligned);

      const response = await this.geminiClient.analyzeWithFullContext({
        incidentId,
        incidentTitle: 'Correlation Analysis',
        incidentDescription: 'Finding causal relationships between signals',
        severity: 'high',
        namespace: 'analysis',
        evidence: [], // Using aligned data directly
        fullLogs: JSON.stringify(
          aligned.flatMap((a) => a.logs.map((l) => l.description)),
          null,
          2
        ),
        thinkingBudget: THINKING_BUDGETS.HIGH,
      });

      if (!response.success || !response.data) {
        this.logger.warn('Gemini correlation failed, using heuristics');
        return this.findCorrelationsHeuristic(aligned);
      }

      // Parse Gemini response into correlations
      const geminiCorrelations = this.parseGeminiCorrelations(
        response.data,
        aligned
      );

      this.logger.info({
        geminiCorrelations: geminiCorrelations.length,
      }, 'Gemini correlation analysis complete');

      return geminiCorrelations;
    } catch (error) {
      this.logger.error({
        error: (error as Error).message,
      }, 'Gemini correlation failed');
      return this.findCorrelationsHeuristic(aligned);
    }
  }

  /**
   * Infer causal chain from correlations
   */
  inferCausality(
    correlations: Correlation[],
    allSignals: Signal[]
  ): CausalChain | null {
    if (correlations.length === 0 || allSignals.length === 0) {
      return null;
    }

    // Find the most likely root cause
    const rootCauseCandidate = this.findRootCauseCandidate(allSignals, correlations);
    if (!rootCauseCandidate) {
      return null;
    }

    // Build causal chain from root cause to effects
    const effects: Signal[] = [];
    const intermediateSteps: CausalChain['intermediateSteps'] = [];
    const timeline: CausalChain['timeline'] = [];

    // Sort signals by time
    const sortedSignals = [...allSignals].sort(
      (a, b) => getTimestampMs(a.timestamp) - getTimestampMs(b.timestamp)
    );

    // Find effects that happened after root cause
    const rootCauseTime = getTimestampMs(rootCauseCandidate.timestamp);

    for (const signal of sortedSignals) {
      if (signal.id === rootCauseCandidate.id) {
        timeline.push({
          timestamp: signal.timestamp,
          signal,
          relationship: 'ROOT_CAUSE',
        });
        continue;
      }

      const signalTime = getTimestampMs(signal.timestamp);
      const timeDelta = signalTime - rootCauseTime;

      // Check if this could be an effect (happened after, within threshold)
      if (timeDelta > 0 && timeDelta < this.config.causalityTimeThreshold) {
        const relationship = this.determineRelationship(
          rootCauseCandidate,
          signal,
          correlations
        );

        if (relationship) {
          effects.push(signal);
          intermediateSteps.push({
            signal,
            relationship: relationship.description,
            confidence: relationship.confidence,
          });
          timeline.push({
            timestamp: signal.timestamp,
            signal,
            relationship: relationship.description,
          });
        }
      }
    }

    if (effects.length === 0) {
      return null;
    }

    // Calculate overall confidence
    const stepConfidences = intermediateSteps.map((s) => s.confidence);
    const avgConfidence =
      stepConfidences.reduce((a, b) => a + b, 0) / stepConfidences.length;

    const causalChain: CausalChain = {
      id: randomUUID(),
      rootCause: rootCauseCandidate,
      effects,
      intermediateSteps,
      confidence: avgConfidence,
      reasoning: `Root cause: ${rootCauseCandidate.description}. Led to ${effects.length} subsequent effects.`,
      timeline,
    };

    this.logger.info({
      rootCause: rootCauseCandidate.description,
      effectCount: effects.length,
      confidence: avgConfidence,
    }, 'Inferred causal chain');

    return causalChain;
  }

  /**
   * Run full correlation analysis
   */
  async analyze(
    evidence: Evidence[],
    incidentId: string
  ): Promise<CorrelationResult> {
    // Convert evidence to signals
    const { visual, logs, metrics, events } = this.evidenceToSignals(evidence);

    // Align by time
    const aligned = this.alignByTime(visual, logs, metrics, events);

    // Find correlations
    const correlations = this.config.enableGeminiCorrelation && this.geminiClient
      ? await this.findCorrelationsWithGemini(aligned, incidentId)
      : this.findCorrelationsHeuristic(aligned);

    // Get all signals
    const allSignals: Signal[] = [...visual, ...logs, ...metrics, ...events];

    // Infer causal chain
    const causalChain = this.inferCausality(correlations, allSignals);

    // Find trigger event
    const triggerEvent = causalChain?.rootCause ?? this.findTriggerEvent(events);

    // Generate root cause hypotheses
    const rootCauseHypotheses = this.generateRootCauseHypotheses(
      allSignals,
      correlations,
      causalChain
    );

    // Calculate summary
    const confidenceScore = correlations.length > 0
      ? correlations.reduce((sum, c) => sum + c.confidence, 0) / correlations.length
      : 0;

    return {
      alignedData: aligned,
      correlations,
      causalChain,
      triggerEvent,
      rootCauseHypotheses,
      summary: {
        totalSignals: allSignals.length,
        timeWindows: aligned.length,
        correlationsFound: correlations.length,
        hasCausalChain: causalChain !== null,
        confidenceScore,
      },
    };
  }

  // ===========================================
  // Private Helper Methods
  // ===========================================

  private mapSeverity(severity?: string): 'low' | 'medium' | 'high' | 'critical' {
    switch (severity?.toLowerCase()) {
      case 'critical':
      case 'fatal':
        return 'critical';
      case 'high':
      case 'error':
        return 'high';
      case 'medium':
      case 'warning':
      case 'warn':
        return 'medium';
      default:
        return 'low';
    }
  }

  private mapToInfraEventSeverity(severity: 'low' | 'medium' | 'high' | 'critical'): 'info' | 'warning' | 'critical' {
    switch (severity) {
      case 'critical':
        return 'critical';
      case 'high':
      case 'medium':
        return 'warning';
      default:
        return 'info';
    }
  }

  private createTemporalCorrelation(
    signals: Signal[],
    window: AlignedData
  ): Correlation {
    const severities = signals.map((s) => this.severityToNumber(s.severity));
    const avgSeverity = severities.reduce((a, b) => a + b, 0) / severities.length;
    const confidence = Math.min(0.3 + avgSeverity * 0.2, 0.8);

    return {
      id: randomUUID(),
      timestamp: window.timestamp,
      signals,
      type: 'temporal',
      confidence,
      description: `${signals.length} signals occurred within ${this.config.windowMs / 1000}s`,
      reasoning: `Temporal co-occurrence of ${signals.map((s) => s.type).join(', ')} signals`,
      timeSpan: {
        start: window.window.start,
        end: window.window.end,
        durationMs: this.config.windowMs,
      },
    };
  }

  private createSymptomaticCorrelation(
    errors: Signal[],
    metrics: MetricSignal[],
    window: AlignedData
  ): Correlation | null {
    if (errors.length === 0 || metrics.length === 0) {
      return null;
    }

    const confidence = 0.6;

    return {
      id: randomUUID(),
      timestamp: window.timestamp,
      signals: [...errors, ...metrics],
      type: 'symptomatic',
      confidence,
      description: `${errors.length} errors correlated with ${metrics.length} metric changes`,
      reasoning: 'Errors and metric anomalies occurring together suggest symptomatic relationship',
      timeSpan: {
        start: window.window.start,
        end: window.window.end,
        durationMs: this.config.windowMs,
      },
    };
  }

  private createCausalCorrelation(
    events: EventSignal[],
    errors: Signal[],
    window: AlignedData
  ): Correlation | null {
    // Look for events that happened before errors
    const earliestError = errors.reduce(
      (min, e) => (e.timestamp < min.timestamp ? e : min),
      errors[0]!
    );

    const precedingEvents = events.filter(
      (e) => e.timestamp < earliestError.timestamp
    );

    if (precedingEvents.length === 0) {
      return null;
    }

    const confidence = 0.7;

    return {
      id: randomUUID(),
      timestamp: precedingEvents[0]!.timestamp,
      signals: [...precedingEvents, ...errors],
      type: 'causal',
      confidence,
      description: `${precedingEvents.length} events preceded ${errors.length} errors`,
      reasoning: 'Events occurring before errors may indicate causal relationship',
      timeSpan: {
        start: window.window.start,
        end: window.window.end,
        durationMs: this.config.windowMs,
      },
    };
  }

  private findRootCauseCandidate(
    signals: Signal[],
    correlations: Correlation[]
  ): Signal | null {
    // Score each signal as potential root cause
    const scores = new Map<string, number>();

    for (const signal of signals) {
      let score = 0;

      // Earlier signals are more likely root causes
      const timeScore = 1 - (signals.indexOf(signal) / signals.length);
      score += timeScore * 0.3;

      // Events are more likely root causes
      if (signal.type === 'event') {
        score += 0.3;
      }

      // High severity increases likelihood
      score += this.severityToNumber(signal.severity) * 0.2;

      // Being part of causal correlations increases score
      for (const corr of correlations) {
        if (corr.type === 'causal' && corr.signals.includes(signal)) {
          score += 0.2;
        }
      }

      scores.set(signal.id, score);
    }

    // Find highest scored signal
    let maxScore = 0;
    let rootCause: Signal | null = null;

    for (const signal of signals) {
      const score = scores.get(signal.id) ?? 0;
      if (score > maxScore) {
        maxScore = score;
        rootCause = signal;
      }
    }

    return rootCause;
  }

  private determineRelationship(
    cause: Signal,
    effect: Signal,
    correlations: Correlation[]
  ): { description: string; confidence: number } | null {
    // Check if they're in a correlation together
    for (const corr of correlations) {
      const hasEffect = corr.signals.some((s) => s.id === effect.id);
      const hasCause = corr.signals.some((s) => s.id === cause.id);

      if (hasEffect && hasCause) {
        return {
          description: `${corr.type} relationship`,
          confidence: corr.confidence,
        };
      }
    }

    // Infer relationship based on signal types
    if (cause.type === 'event' && effect.type === 'log') {
      return {
        description: 'Event triggered error logs',
        confidence: 0.6,
      };
    }

    if (cause.type === 'event' && effect.type === 'metric') {
      return {
        description: 'Event caused metric change',
        confidence: 0.5,
      };
    }

    if (cause.type === 'log' && effect.type === 'visual') {
      return {
        description: 'Errors manifested in dashboard',
        confidence: 0.7,
      };
    }

    return {
      description: 'Sequential occurrence',
      confidence: 0.4,
    };
  }

  private findTriggerEvent(events: EventSignal[]): EventSignal | null {
    // Find the earliest event with high severity
    const criticalEvents = events
      .filter((e) => e.severity === 'critical' || e.severity === 'high')
      .sort((a, b) => getTimestampMs(a.timestamp) - getTimestampMs(b.timestamp));

    return criticalEvents[0] ?? events[0] ?? null;
  }

  private generateRootCauseHypotheses(
    signals: Signal[],
    _correlations: Correlation[],
    causalChain: CausalChain | null
  ): Array<{
    signal: Signal;
    confidence: number;
    supporting: Signal[];
    reasoning: string;
  }> {
    const hypotheses: Array<{
      signal: Signal;
      confidence: number;
      supporting: Signal[];
      reasoning: string;
    }> = [];

    // If we have a causal chain, the root cause is the primary hypothesis
    if (causalChain) {
      hypotheses.push({
        signal: causalChain.rootCause,
        confidence: causalChain.confidence,
        supporting: causalChain.effects,
        reasoning: causalChain.reasoning,
      });
    }

    // Add other high-confidence signals as alternative hypotheses
    const potentialCauses = signals
      .filter(
        (s) =>
          s.type === 'event' ||
          s.severity === 'critical' ||
          s.severity === 'high'
      )
      .filter((s) => !causalChain || s.id !== causalChain.rootCause.id);

    for (const signal of potentialCauses.slice(0, 3)) {
      // Find supporting signals
      const supporting = signals.filter(
        (s) =>
          s.id !== signal.id &&
          getTimestampMs(s.timestamp) > getTimestampMs(signal.timestamp) &&
          getTimestampMs(s.timestamp) - getTimestampMs(signal.timestamp) <
            this.config.causalityTimeThreshold
      );

      hypotheses.push({
        signal,
        confidence: 0.3 + this.severityToNumber(signal.severity) * 0.2,
        supporting,
        reasoning: `Alternative hypothesis: ${signal.description}`,
      });
    }

    return hypotheses.sort((a, b) => b.confidence - a.confidence);
  }

  private severityToNumber(severity: string): number {
    switch (severity) {
      case 'critical':
        return 1.0;
      case 'high':
        return 0.75;
      case 'medium':
        return 0.5;
      case 'low':
        return 0.25;
      default:
        return 0;
    }
  }

  private buildCorrelationPrompt(aligned: AlignedData[]): string {
    const windows = aligned.map((w) => ({
      timestamp: w.timestamp.toISOString(),
      visual: w.visual.map((v) => v.description),
      logs: w.logs.map((l) => l.description),
      metrics: w.metrics.map((m) => m.description),
      events: w.events.map((e) => e.description),
    }));

    return `
Analyze the following time-aligned signals from an incident investigation.
Find correlations and determine causal relationships.

Time Windows:
${JSON.stringify(windows, null, 2)}

Identify:
1. Signals that occur together (temporal correlation)
2. Signals where one likely caused another (causal correlation)
3. The most likely root cause signal
4. The chain of events from root cause to visible symptoms

Return your analysis as JSON with correlations and causal chain.
    `.trim();
  }

  private parseGeminiCorrelations(
    response: unknown,
    aligned: AlignedData[]
  ): Correlation[] {
    // Parse Gemini response and convert to correlations
    // For now, fall back to heuristics if parsing fails
    try {
      const data = response as {
        correlations?: Array<{
          description: string;
          confidence: number;
          signalDescriptions: string[];
        }>;
      };

      if (!data.correlations || !Array.isArray(data.correlations)) {
        return this.findCorrelationsHeuristic(aligned);
      }

      const correlations: Correlation[] = [];
      const allSignals = aligned.flatMap((a) => [
        ...a.visual,
        ...a.logs,
        ...a.metrics,
        ...a.events,
      ]);

      for (const gc of data.correlations) {
        // Find matching signals by description
        const matchedSignals = allSignals.filter((s) =>
          gc.signalDescriptions?.some((desc: string) =>
            s.description.includes(desc) || desc.includes(s.description)
          )
        );

        if (matchedSignals.length >= 2) {
          correlations.push({
            id: randomUUID(),
            timestamp: matchedSignals[0]!.timestamp,
            signals: matchedSignals,
            type: 'temporal',
            confidence: gc.confidence ?? 0.5,
            description: gc.description,
            reasoning: 'Identified by Gemini analysis',
            timeSpan: {
              start: matchedSignals[0]!.timestamp,
              end: matchedSignals[matchedSignals.length - 1]!.timestamp,
              durationMs:
                getTimestampMs(matchedSignals[matchedSignals.length - 1]!.timestamp) -
                getTimestampMs(matchedSignals[0]!.timestamp),
            },
          });
        }
      }

      return correlations;
    } catch {
      return this.findCorrelationsHeuristic(aligned);
    }
  }
}

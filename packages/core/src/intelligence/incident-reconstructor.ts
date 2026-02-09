/**
 * Incident Reconstructor
 * Reconstructs incident timelines from raw data using Gemini's 1M context window
 */

import { EventEmitter } from 'eventemitter3';
import type { GeminiClient } from '@chronosops/gemini';
import { createChildLogger } from '@chronosops/shared';

// Maximum tokens we'll use (leave buffer under 1M limit)
const MAX_CONTEXT_TOKENS = 900000;
// Approximate tokens per character (conservative estimate)
const TOKENS_PER_CHAR = 0.25;

// ===========================================
// Types
// ===========================================

export interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  service: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface MetricDatapoint {
  timestamp: string;
  metric: string;
  value: number;
  labels?: Record<string, string>;
}

export interface KubernetesEvent {
  timestamp: string;
  type: 'Normal' | 'Warning';
  reason: string;
  object: string;
  message: string;
  namespace: string;
}

export interface Screenshot {
  timestamp: string;
  description: string;
  base64?: string; // Optional - may be too large
  url?: string;
}

export interface RawIncidentData {
  /** Time range for the incident */
  timeRange: {
    start: Date;
    end: Date;
  };
  /** Optional incident ID to link reconstruction to */
  incidentId?: string;
  /** Log entries within time range */
  logs?: LogEntry[];
  /** Metric datapoints within time range */
  metrics?: MetricDatapoint[];
  /** Kubernetes events within time range */
  events?: KubernetesEvent[];
  /** Dashboard screenshots */
  screenshots?: Screenshot[];
  /** Additional context (deployment info, config changes, etc.) */
  additionalContext?: string;
}

export interface TimelineEntry {
  timestamp: string;
  category: 'error' | 'warning' | 'info' | 'metric_anomaly' | 'k8s_event' | 'action';
  summary: string;
  details?: string;
  impact?: string;
  relatedEntities?: string[];
}

export interface CausalLink {
  from: string;
  to: string;
  relationship: string;
  confidence: number;
}

export interface ReconstructionResult {
  /** Unique ID for this reconstruction */
  id: string;
  /** Optional linked incident ID */
  incidentId?: string;
  /** Time range analyzed */
  timeRange: {
    start: Date;
    end: Date;
  };
  /** Reconstructed timeline */
  timeline: TimelineEntry[];
  /** Causal chain showing event relationships */
  causalChain: CausalLink[];
  /** Identified root cause */
  rootCause: string;
  /** Severity assessment */
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** Impact summary */
  impactSummary: string;
  /** Recommended actions */
  recommendations: string[];
  /** Narrative explanation of what happened */
  narrative: string;
  /** Data quality assessment */
  dataQuality: {
    logsAvailable: boolean;
    metricsAvailable: boolean;
    eventsAvailable: boolean;
    screenshotsAvailable: boolean;
    confidenceScore: number;
    gaps: string[];
  };
  /** Token usage statistics */
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
  };
  /** Processing duration in ms */
  processingTimeMs: number;
}

export interface IncidentReconstructorEvents {
  'reconstruction:started': { incidentId?: string; dataSize: number };
  'reconstruction:progress': { stage: string; progress: number };
  'reconstruction:completed': { result: ReconstructionResult };
  'reconstruction:failed': { error: string };
}

// ===========================================
// Incident Reconstructor
// ===========================================

export class IncidentReconstructor extends EventEmitter<IncidentReconstructorEvents> {
  private geminiClient: GeminiClient;
  private logger = createChildLogger({ component: 'IncidentReconstructor' });

  constructor(geminiClient: GeminiClient) {
    super();
    this.geminiClient = geminiClient;
  }

  /**
   * Reconstruct an incident from raw data
   */
  async reconstruct(data: RawIncidentData): Promise<ReconstructionResult> {
    const startTime = Date.now();
    const reconstructionId = crypto.randomUUID();

    this.logger.info(
      {
        reconstructionId,
        incidentId: data.incidentId,
        timeRange: data.timeRange,
        logCount: data.logs?.length ?? 0,
        metricCount: data.metrics?.length ?? 0,
        eventCount: data.events?.length ?? 0,
      },
      'Starting incident reconstruction'
    );

    this.emit('reconstruction:started', {
      incidentId: data.incidentId,
      dataSize: this.estimateDataSize(data),
    });

    try {
      // Stage 1: Validate and prepare data
      this.emit('reconstruction:progress', { stage: 'validation', progress: 10 });
      const validatedData = this.validateData(data);

      // Stage 2: Build context within token limits
      this.emit('reconstruction:progress', { stage: 'context_building', progress: 30 });
      const context = await this.buildContext(validatedData);

      // Stage 3: Send to Gemini for analysis
      this.emit('reconstruction:progress', { stage: 'analysis', progress: 50 });
      const analysisResult = await this.analyzeWithGemini(context, data.timeRange);

      // Stage 4: Post-process and structure results
      this.emit('reconstruction:progress', { stage: 'structuring', progress: 80 });
      const result = this.structureResult(
        reconstructionId,
        data,
        analysisResult,
        context.tokenEstimate,
        startTime
      );

      this.emit('reconstruction:progress', { stage: 'completed', progress: 100 });
      this.emit('reconstruction:completed', { result });

      this.logger.info(
        {
          reconstructionId,
          duration: Date.now() - startTime,
          rootCause: result.rootCause,
          timelineEntries: result.timeline.length,
        },
        'Incident reconstruction completed'
      );

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error: errorMessage, reconstructionId }, 'Reconstruction failed');
      this.emit('reconstruction:failed', { error: errorMessage });
      throw error;
    }
  }

  /**
   * Estimate total data size in tokens
   */
  private estimateDataSize(data: RawIncidentData): number {
    let charCount = 0;

    if (data.logs) {
      charCount += JSON.stringify(data.logs).length;
    }
    if (data.metrics) {
      charCount += JSON.stringify(data.metrics).length;
    }
    if (data.events) {
      charCount += JSON.stringify(data.events).length;
    }
    if (data.additionalContext) {
      charCount += data.additionalContext.length;
    }

    return Math.ceil(charCount * TOKENS_PER_CHAR);
  }

  /**
   * Validate input data
   */
  private validateData(data: RawIncidentData): RawIncidentData {
    if (!data.timeRange?.start || !data.timeRange?.end) {
      throw new Error('Time range is required');
    }

    if (data.timeRange.start >= data.timeRange.end) {
      throw new Error('Invalid time range: start must be before end');
    }

    const hasData = data.logs?.length || data.metrics?.length || data.events?.length;
    if (!hasData) {
      throw new Error('At least one data source (logs, metrics, or events) is required');
    }

    return data;
  }

  /**
   * Build context within token limits
   * Prioritizes recent events and errors
   */
  private async buildContext(data: RawIncidentData): Promise<{
    content: string;
    tokenEstimate: number;
    dataQuality: ReconstructionResult['dataQuality'];
  }> {
    const sections: string[] = [];
    let totalTokens = 0;

    const dataQuality: ReconstructionResult['dataQuality'] = {
      logsAvailable: (data.logs?.length ?? 0) > 0,
      metricsAvailable: (data.metrics?.length ?? 0) > 0,
      eventsAvailable: (data.events?.length ?? 0) > 0,
      screenshotsAvailable: (data.screenshots?.length ?? 0) > 0,
      confidenceScore: 0,
      gaps: [],
    };

    // Header
    const header = this.buildHeader(data.timeRange);
    sections.push(header);
    totalTokens += this.estimateTokens(header);

    // Kubernetes Events (highest priority - clear system events)
    if (data.events?.length) {
      const eventsSection = this.buildEventsSection(data.events, MAX_CONTEXT_TOKENS - totalTokens);
      sections.push(eventsSection.content);
      totalTokens += eventsSection.tokens;

      if (eventsSection.truncated) {
        dataQuality.gaps.push(`Events truncated: ${eventsSection.originalCount - eventsSection.includedCount} omitted`);
      }
    } else {
      dataQuality.gaps.push('No Kubernetes events available');
    }

    // Logs (high priority - especially errors and warnings)
    if (data.logs?.length) {
      const logsSection = this.buildLogsSection(data.logs, MAX_CONTEXT_TOKENS - totalTokens);
      sections.push(logsSection.content);
      totalTokens += logsSection.tokens;

      if (logsSection.truncated) {
        dataQuality.gaps.push(`Logs truncated: ${logsSection.originalCount - logsSection.includedCount} omitted`);
      }
    } else {
      dataQuality.gaps.push('No logs available');
    }

    // Metrics (medium priority)
    if (data.metrics?.length) {
      const metricsSection = this.buildMetricsSection(data.metrics, MAX_CONTEXT_TOKENS - totalTokens);
      sections.push(metricsSection.content);
      totalTokens += metricsSection.tokens;

      if (metricsSection.truncated) {
        dataQuality.gaps.push(`Metrics truncated: ${metricsSection.originalCount - metricsSection.includedCount} omitted`);
      }
    } else {
      dataQuality.gaps.push('No metrics available');
    }

    // Screenshots / Dashboard frames (visual analysis data)
    if (data.screenshots?.length) {
      const screenshotsSection = this.buildScreenshotsSection(data.screenshots, MAX_CONTEXT_TOKENS - totalTokens);
      sections.push(screenshotsSection.content);
      totalTokens += screenshotsSection.tokens;

      if (screenshotsSection.truncated) {
        dataQuality.gaps.push(`Screenshots truncated: ${screenshotsSection.originalCount - screenshotsSection.includedCount} omitted`);
      }
    } else {
      dataQuality.gaps.push('No dashboard screenshots provided');
    }

    // Additional context
    if (data.additionalContext) {
      const ctxTokens = this.estimateTokens(data.additionalContext);
      if (totalTokens + ctxTokens < MAX_CONTEXT_TOKENS) {
        sections.push(`## Additional Context\n${data.additionalContext}`);
        totalTokens += ctxTokens;
      }
    }

    // Calculate confidence score based on data availability and completeness
    // Now includes screenshots as a data source
    const availableSourceCount = [
      data.logs?.length,
      data.metrics?.length,
      data.events?.length,
      data.screenshots?.length,
    ].filter((n) => n && n > 0).length;
    dataQuality.confidenceScore = Math.min(
      1,
      (availableSourceCount / 4) * 0.6 + (dataQuality.gaps.length === 0 ? 0.4 : 0.2)
    );

    return {
      content: sections.join('\n\n'),
      tokenEstimate: totalTokens,
      dataQuality,
    };
  }

  /**
   * Build context header
   */
  private buildHeader(timeRange: { start: Date; end: Date }): string {
    return `# Incident Analysis Context

## Time Range
- Start: ${timeRange.start.toISOString()}
- End: ${timeRange.end.toISOString()}
- Duration: ${Math.round((timeRange.end.getTime() - timeRange.start.getTime()) / 1000 / 60)} minutes

## Instructions
Analyze the following data to:
1. Reconstruct a timeline of events
2. Identify the root cause
3. Determine the causal chain
4. Assess severity and impact
5. Provide recommendations`;
  }

  /**
   * Build events section with token limit
   */
  private buildEventsSection(
    events: KubernetesEvent[],
    maxTokens: number
  ): { content: string; tokens: number; truncated: boolean; originalCount: number; includedCount: number } {
    // Sort by timestamp, prioritize Warning events
    const sorted = [...events].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'Warning' ? -1 : 1;
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });

    const lines: string[] = ['## Kubernetes Events'];
    let tokens = this.estimateTokens(lines[0]!);
    let includedCount = 0;

    for (const event of sorted) {
      const line = `[${event.timestamp}] ${event.type}: ${event.reason} - ${event.object} - ${event.message}`;
      const lineTokens = this.estimateTokens(line);

      if (tokens + lineTokens > maxTokens * 0.3) break; // Cap at 30% of available tokens

      lines.push(line);
      tokens += lineTokens;
      includedCount++;
    }

    return {
      content: lines.join('\n'),
      tokens,
      truncated: includedCount < events.length,
      originalCount: events.length,
      includedCount,
    };
  }

  /**
   * Build logs section with token limit
   */
  private buildLogsSection(
    logs: LogEntry[],
    maxTokens: number
  ): { content: string; tokens: number; truncated: boolean; originalCount: number; includedCount: number } {
    // Prioritize by level: fatal > error > warn > info > debug
    const levelPriority: Record<string, number> = {
      fatal: 0,
      error: 1,
      warn: 2,
      info: 3,
      debug: 4,
    };

    const sorted = [...logs].sort((a, b) => {
      if (a.level !== b.level) return levelPriority[a.level]! - levelPriority[b.level]!;
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });

    const lines: string[] = ['## Application Logs'];
    let tokens = this.estimateTokens(lines[0]!);
    let includedCount = 0;

    for (const log of sorted) {
      const metadata = log.metadata ? ` ${JSON.stringify(log.metadata)}` : '';
      const line = `[${log.timestamp}] ${log.level.toUpperCase()} [${log.service}] ${log.message}${metadata}`;
      const lineTokens = this.estimateTokens(line);

      if (tokens + lineTokens > maxTokens * 0.4) break; // Cap at 40% of available tokens

      lines.push(line);
      tokens += lineTokens;
      includedCount++;
    }

    return {
      content: lines.join('\n'),
      tokens,
      truncated: includedCount < logs.length,
      originalCount: logs.length,
      includedCount,
    };
  }

  /**
   * Build metrics section with token limit
   */
  private buildMetricsSection(
    metrics: MetricDatapoint[],
    maxTokens: number
  ): { content: string; tokens: number; truncated: boolean; originalCount: number; includedCount: number } {
    // Group metrics by name and sample
    const grouped = new Map<string, MetricDatapoint[]>();
    for (const m of metrics) {
      const key = m.metric;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(m);
    }

    const lines: string[] = ['## Metrics'];
    let tokens = this.estimateTokens(lines[0]!);
    let includedCount = 0;

    for (const [metricName, datapoints] of grouped.entries()) {
      // Sample datapoints evenly
      const samples = this.sampleDatapoints(datapoints, 10);
      const line = `${metricName}: ${samples.map((d) => `${d.timestamp}=${d.value}`).join(', ')}`;
      const lineTokens = this.estimateTokens(line);

      if (tokens + lineTokens > maxTokens * 0.2) break; // Cap at 20% of available tokens

      lines.push(line);
      tokens += lineTokens;
      includedCount += datapoints.length;
    }

    return {
      content: lines.join('\n'),
      tokens,
      truncated: includedCount < metrics.length,
      originalCount: metrics.length,
      includedCount,
    };
  }

  /**
   * Build screenshots section with token limit
   */
  private buildScreenshotsSection(
    screenshots: Screenshot[],
    maxTokens: number
  ): { content: string; tokens: number; truncated: boolean; originalCount: number; includedCount: number } {
    // Sort by timestamp
    const sorted = [...screenshots].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const lines: string[] = ['## Dashboard Screenshots / Visual Analysis'];
    let tokens = this.estimateTokens(lines[0]!);
    let includedCount = 0;

    for (const screenshot of sorted) {
      // Include description (visual analysis) but not base64 data to save tokens
      const line = `[${screenshot.timestamp}] ${screenshot.description}`;
      const lineTokens = this.estimateTokens(line);

      if (tokens + lineTokens > maxTokens * 0.15) break; // Cap at 15% of available tokens

      lines.push(line);
      tokens += lineTokens;
      includedCount++;
    }

    return {
      content: lines.join('\n'),
      tokens,
      truncated: includedCount < screenshots.length,
      originalCount: screenshots.length,
      includedCount,
    };
  }

  /**
   * Sample datapoints evenly
   */
  private sampleDatapoints(datapoints: MetricDatapoint[], maxSamples: number): MetricDatapoint[] {
    if (datapoints.length <= maxSamples) return datapoints;

    const sorted = [...datapoints].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const step = Math.ceil(sorted.length / maxSamples);
    return sorted.filter((_, i) => i % step === 0);
  }

  /**
   * Estimate tokens for a string
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length * TOKENS_PER_CHAR);
  }

  /**
   * Analyze context with Gemini using the reconstructIncident method
   */
  private async analyzeWithGemini(
    context: { content: string; tokenEstimate: number; dataQuality: ReconstructionResult['dataQuality'] },
    timeRange: { start: Date; end: Date }
  ): Promise<{
    timeline: TimelineEntry[];
    causalChain: CausalLink[];
    rootCause: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    impactSummary: string;
    recommendations: string[];
    narrative: string;
    tokenUsage: { inputTokens: number; outputTokens: number };
  }> {
    // Use the GeminiClient's reconstructIncident method
    const response = await this.geminiClient.reconstructIncident({
      logs: context.content,
      timeRange: {
        start: timeRange.start.toISOString(),
        end: timeRange.end.toISOString(),
      },
    });

    if (!response.success || !response.data) {
      throw new Error(`Gemini analysis failed: ${response.error ?? 'Unknown error'}`);
    }

    // Transform the Gemini response to our internal format
    const geminiData = response.data;

    // Convert timeline format
    const timeline: TimelineEntry[] = geminiData.timeline.map((entry) => ({
      timestamp: entry.timestamp,
      category: this.mapSeverityToCategory(entry.severity),
      summary: entry.event,
      details: entry.evidence,
      impact: entry.isKeyEvent ? 'Key event in incident chain' : undefined,
      relatedEntities: [entry.service],
    }));

    // Convert causal chain format
    const causalChain: CausalLink[] = geminiData.causalChain.map((link) => ({
      from: link.causedBy ?? link.event,
      to: link.event,
      relationship: this.mapRelationshipType(link.relationship),
      confidence: link.relationship === 'direct' ? 0.9 : link.relationship === 'cascading' ? 0.7 : 0.5,
    }));

    // Determine severity from timeline events
    const hasCritical = geminiData.timeline.some((e) => e.severity === 'critical');
    const hasError = geminiData.timeline.some((e) => e.severity === 'error');
    const hasWarning = geminiData.timeline.some((e) => e.severity === 'warning');
    const severity: 'low' | 'medium' | 'high' | 'critical' = hasCritical
      ? 'critical'
      : hasError
        ? 'high'
        : hasWarning
          ? 'medium'
          : 'low';

    // Extract root cause description
    const rootCause = geminiData.rootCause.description;

    // Generate impact summary from timeline
    const keyEvents = geminiData.timeline.filter((e) => e.isKeyEvent);
    const impactSummary = keyEvents.length > 0
      ? `${keyEvents.length} key events identified. ${keyEvents.map((e) => e.event).join('; ')}`
      : geminiData.rootCause.differentFromSymptoms;

    // Convert recommendations to strings
    const recommendations = geminiData.recommendations.map((r) => `[${r.priority}] ${r.action} - ${r.rationale}`);

    return {
      timeline,
      causalChain,
      rootCause,
      severity,
      impactSummary,
      recommendations,
      narrative: geminiData.narrative,
      tokenUsage: {
        inputTokens: context.tokenEstimate,
        outputTokens: this.estimateTokens(JSON.stringify(response.data)),
      },
    };
  }

  /**
   * Map severity to timeline category
   */
  private mapSeverityToCategory(severity: string): TimelineEntry['category'] {
    switch (severity) {
      case 'critical':
      case 'error':
        return 'error';
      case 'warning':
        return 'warning';
      default:
        return 'info';
    }
  }

  /**
   * Map relationship type
   */
  private mapRelationshipType(relationship: string): string {
    switch (relationship) {
      case 'direct':
        return 'caused';
      case 'cascading':
        return 'triggered';
      case 'contributing':
        return 'contributed_to';
      default:
        return 'preceded';
    }
  }

  /**
   * Structure the final result
   */
  private structureResult(
    id: string,
    data: RawIncidentData,
    analysis: Awaited<ReturnType<typeof this.analyzeWithGemini>>,
    inputTokens: number,
    startTime: number
  ): ReconstructionResult {
    return {
      id,
      incidentId: data.incidentId,
      timeRange: data.timeRange,
      timeline: analysis.timeline,
      causalChain: analysis.causalChain,
      rootCause: analysis.rootCause,
      severity: analysis.severity,
      impactSummary: analysis.impactSummary,
      recommendations: analysis.recommendations,
      narrative: analysis.narrative,
      dataQuality: {
        logsAvailable: (data.logs?.length ?? 0) > 0,
        metricsAvailable: (data.metrics?.length ?? 0) > 0,
        eventsAvailable: (data.events?.length ?? 0) > 0,
        screenshotsAvailable: (data.screenshots?.length ?? 0) > 0,
        confidenceScore: this.calculateConfidence(data, analysis),
        gaps: this.identifyGaps(data),
      },
      tokenUsage: {
        inputTokens,
        outputTokens: analysis.tokenUsage.outputTokens,
      },
      processingTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(
    data: RawIncidentData,
    analysis: Awaited<ReturnType<typeof this.analyzeWithGemini>>
  ): number {
    let score = 0.5; // Base score

    // Data source availability (now includes screenshots)
    if (data.logs?.length) score += 0.12;
    if (data.metrics?.length) score += 0.08;
    if (data.events?.length) score += 0.12;
    if (data.screenshots?.length) score += 0.08; // Visual analysis adds confidence

    // Analysis quality
    if (analysis.causalChain.length > 0) score += 0.05;
    if (analysis.timeline.length > 3) score += 0.05;

    return Math.min(1, score);
  }

  /**
   * Identify data gaps
   * Note: Screenshots gap is handled separately in buildContext to avoid duplication
   */
  private identifyGaps(data: RawIncidentData): string[] {
    const gaps: string[] = [];

    if (!data.logs?.length) gaps.push('No application logs provided');
    if (!data.metrics?.length) gaps.push('No metrics data provided');
    if (!data.events?.length) gaps.push('No Kubernetes events provided');
    // Screenshots gap is already added in buildContext, don't duplicate here

    return gaps;
  }
}

/**
 * Gemini 3 API Client
 * Uses @google/genai SDK (v1.34.0+)
 * Includes OpenTelemetry tracing for production observability
 */

import { GoogleGenAI } from '@google/genai';
import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';
import { createChildLogger, GeminiError } from '@chronosops/shared';
import type {
  GeminiClientConfig,
  GenerateOptions,
  FrameAnalysisRequest,
  FrameAnalysisResponse,
  LogAnalysisRequest,
  LogAnalysisResponse,
  HypothesisGenerationRequest,
  HypothesisGenerationResponse,
  PostmortemRequest,
  PostmortemResponse,
  FullContextAnalysisRequest,
  FullContextAnalysisResponse,
  AnalysisWithToolsRequest,
  AnalysisWithToolsResponse,
  GeminiResponse,
  GeminiContents,
  ContentPart,
  GeminiFunctionCall,
  // Development types
  RequirementAnalysisGeminiRequest,
  RequirementAnalysisGeminiResponse,
  ArchitectureDesignGeminiRequest,
  ArchitectureDesignGeminiResponse,
  CodeGenerationGeminiRequest,
  CodeGenerationGeminiResponse,
  CodeFixGeminiRequest,
  CodeFixGeminiResponse,
  TestGenerationGeminiRequest,
  TestGenerationGeminiResponse,
  AllTestsGenerationGeminiRequest,
  IncidentReconstructionGeminiRequest,
  IncidentReconstructionGeminiResponse,
  PatternLearningGeminiRequest,
  PatternLearningGeminiResponse,
} from './types.js';
import { GEMINI_MODELS, THINKING_BUDGETS, DEFAULT_PROGRESSIVE_BACKOFF, type GeminiModel, type ThinkingBudget, type ProgressiveBackoffConfig } from './types.js';
import {
  FRAME_ANALYSIS_PROMPT,
  LOG_ANALYSIS_PROMPT,
  HYPOTHESIS_PROMPT,
  POSTMORTEM_PROMPT,
  FULL_CONTEXT_ANALYSIS_PROMPT,
  ANALYZE_REQUIREMENT_PROMPT,
  DESIGN_ARCHITECTURE_PROMPT,
  GENERATE_CODE_PROMPT,
  FIX_CODE_PROMPT,
  GENERATE_TESTS_PROMPT,
  GENERATE_ALL_TESTS_PROMPT,
  RECONSTRUCT_INCIDENT_PROMPT,
  LEARN_PATTERN_PROMPT,
  ENHANCE_OPENAPI_SPEC_PROMPT,
} from '../prompts/index.js';
import {
  FRAME_ANALYSIS_SCHEMA,
  LOG_ANALYSIS_SCHEMA,
  HYPOTHESIS_SCHEMA,
  POSTMORTEM_SCHEMA,
  FULL_CONTEXT_ANALYSIS_SCHEMA,
  REQUIREMENT_ANALYSIS_SCHEMA,
  ARCHITECTURE_DESIGN_SCHEMA,
  CODE_GENERATION_SCHEMA,
  CODE_FIX_SCHEMA,
  TEST_GENERATION_SCHEMA,
  INCIDENT_RECONSTRUCTION_SCHEMA,
  PATTERN_LEARNING_SCHEMA,
} from './schemas.js';
import {
  KUBERNETES_TOOLS,
  toGeminiToolFormat,
  TOOL_ANALYSIS_SYSTEM_PROMPT,
} from './tools.js';
import { DEFAULT_MODEL_ASSIGNMENTS, DEFAULT_TEMPERATURE_ASSIGNMENTS, type AITask, type ModelAssignments, type TemperatureAssignments } from '@chronosops/shared';

const DEFAULT_CONFIG: Partial<GeminiClientConfig> = {
  model: GEMINI_MODELS.FLASH,
  proModel: GEMINI_MODELS.PRO,
  defaultThinkingBudget: THINKING_BUDGETS.MEDIUM,
  defaultTemperature: 0.1, // Lower temperature for consistent incident response
  maxRetries: 5, // Increased for progressive backoff
  retryDelayMs: 2000, // Legacy: 2 seconds (use progressiveBackoff instead)
  requestTimeoutMs: 180000, // 3 minutes - Gemini 3 models need time for complex code gen
  progressiveBackoff: DEFAULT_PROGRESSIVE_BACKOFF, // 15s → 30s → 45s → 60s (reduced for faster retry)
};

/**
 * Explicit allowlist of models that support thinking features.
 * This is more reliable than regex patterns for future compatibility.
 */
const THINKING_ENABLED_MODELS = new Set([
  'gemini-2.5-flash',
  'gemini-2.5-flash-preview',
  'gemini-2.5-pro',
  'gemini-2.5-pro-preview',
  'gemini-3-flash',
  'gemini-3-flash-preview',
  'gemini-3-pro',
  'gemini-3-pro-preview',
  'gemini-2.0-flash-thinking-exp',
  'gemini-2.0-flash-thinking-exp-01-21',
]);

/**
 * Check if a model supports thinking features
 * Uses explicit allowlist for reliability, with fallback for 'thinking' models
 */
function supportsThinking(model: string): boolean {
  return THINKING_ENABLED_MODELS.has(model) || model.toLowerCase().includes('thinking');
}

/**
 * Check if a model is a Gemini 3 model
 * Gemini 3 models use thinkingLevel instead of thinkingBudget
 */
function isGemini3Model(model: string): boolean {
  return model.includes('gemini-3');
}

/**
 * Convert thinking budget (token count) to thinking level for Gemini 3 models
 *
 * Gemini 3 supports discrete thinking levels:
 * - 'minimal': Minimal reasoning (Gemini 3 Flash only)
 * - 'low': Light reasoning
 * - 'medium': Moderate reasoning (Gemini 3 Flash only)
 * - 'high': Deep reasoning
 *
 * @param budget Token budget from THINKING_BUDGETS
 * @param isFlash Whether the model is Gemini 3 Flash (supports minimal/medium)
 * @returns Appropriate thinking level
 */
function budgetToThinkingLevel(budget: number, isFlash: boolean): 'minimal' | 'low' | 'medium' | 'high' {
  // Map our existing THINKING_BUDGETS to Gemini 3 levels
  // Gemini 3 Pro only supports 'low' and 'high' (no medium)
  // Gemini 3 Flash supports 'minimal', 'low', 'medium', 'high'
  //
  // LOW (1024) -> 'minimal' (Flash) or 'low' (Pro)
  // MEDIUM (8192) -> 'medium' (Flash) or 'high' (Pro) - Pro needs 'high' for good reasoning
  // HIGH (24576) -> 'high'
  if (budget <= 1024) {
    return isFlash ? 'minimal' : 'low';
  }
  if (budget <= 8192) {
    return isFlash ? 'medium' : 'high'; // Pro: use 'high' since no 'medium' available
  }
  return 'high';
}

// OpenTelemetry tracer for Gemini API observability
const tracer = trace.getTracer('gemini-client', '1.0.0');

// SDK version for debugging and observability
const GENAI_SDK_VERSION = '1.34.0';

export class GeminiClient {
  private client: GoogleGenAI;
  private config: Required<Omit<GeminiClientConfig, 'modelAssignments' | 'temperatureAssignments'>> & {
    modelAssignments: ModelAssignments;
    temperatureAssignments: TemperatureAssignments;
  };
  private logger = createChildLogger({ component: 'GeminiClient' });

  /**
   * Track the time of the last API call to implement dynamic delays
   * If enough time has passed since the last call, we can skip pre-request delays
   */
  private lastApiCallTime: number = 0;

  /**
   * Minimum time (ms) since last API call before we skip pre-request delays
   * If 30+ seconds have passed, we're unlikely to hit rate limits
   */
  private static readonly SKIP_DELAY_THRESHOLD_MS = 30000;

  constructor(config: GeminiClientConfig) {
    // Merge default model assignments with any overrides
    const modelAssignments: ModelAssignments = {
      ...DEFAULT_MODEL_ASSIGNMENTS,
      ...config.modelAssignments,
    };

    // Merge default temperature assignments with any overrides
    const temperatureAssignments: TemperatureAssignments = {
      ...DEFAULT_TEMPERATURE_ASSIGNMENTS,
      ...config.temperatureAssignments,
    };

    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      modelAssignments,
      temperatureAssignments,
    } as Required<Omit<GeminiClientConfig, 'modelAssignments' | 'temperatureAssignments'>> & {
      modelAssignments: ModelAssignments;
      temperatureAssignments: TemperatureAssignments;
    };

    this.client = new GoogleGenAI({
      apiKey: this.config.apiKey,
      httpOptions: {
        timeout: this.config.requestTimeoutMs,
      },
    });

    const backoff = this.getProgressiveBackoffConfig();
    this.logger.info({
      timeout: this.config.requestTimeoutMs,
      model: this.config.model,
      proModel: this.config.proModel,
      modelAssignments: this.config.modelAssignments,
      temperatureAssignments: this.config.temperatureAssignments,
      progressiveBackoff: backoff.enabled ? `${backoff.initialDelayMs / 1000}s → ${backoff.maxDelayMs / 1000}s` : 'disabled',
    }, 'GeminiClient initialized with model and temperature assignments');
  }

  /**
   * Get merged progressive backoff configuration
   */
  private getProgressiveBackoffConfig(): ProgressiveBackoffConfig {
    return {
      ...DEFAULT_PROGRESSIVE_BACKOFF,
      ...this.config.progressiveBackoff,
    };
  }

  /**
   * Calculate dynamic pre-request delay based on time since last API call
   *
   * This optimization reduces unnecessary waiting when the API has been idle.
   * If 30+ seconds have passed since the last call, we skip the delay entirely.
   *
   * @param baseDelayMs - The base delay to use if not enough time has passed
   * @param context - Optional context for logging (e.g., method name)
   * @returns The actual delay to use (0 if enough time has passed)
   */
  private calculateDynamicDelay(baseDelayMs: number, context?: string): number {
    const timeSinceLastCall = Date.now() - this.lastApiCallTime;

    // If this is the first call or enough time has passed, skip delay
    if (this.lastApiCallTime === 0 || timeSinceLastCall >= GeminiClient.SKIP_DELAY_THRESHOLD_MS) {
      this.logger.debug({
        timeSinceLastCallMs: timeSinceLastCall,
        thresholdMs: GeminiClient.SKIP_DELAY_THRESHOLD_MS,
        baseDelayMs,
        actualDelayMs: 0,
        context,
      }, 'Skipping pre-request delay - enough time has passed since last API call');
      return 0;
    }

    // Otherwise, use the base delay (but could reduce it proportionally)
    this.logger.debug({
      timeSinceLastCallMs: timeSinceLastCall,
      baseDelayMs,
      context,
    }, 'Using pre-request delay');
    return baseDelayMs;
  }

  /**
   * Record that an API call was just made (to track for dynamic delays)
   */
  private recordApiCallTime(): void {
    this.lastApiCallTime = Date.now();
  }

  /**
   * Calculate retry delay for a given attempt using progressive backoff
   *
   * Implements pattern: 1m → 2m → 3m → 4m → 5m (capped)
   * With jitter to prevent thundering herd
   *
   * @param attempt - Current attempt number (0-indexed)
   * @returns Delay in milliseconds with jitter applied
   */
  private calculateProgressiveDelay(attempt: number): number {
    const backoff = this.getProgressiveBackoffConfig();

    if (!backoff.enabled) {
      // Fall back to legacy linear delay
      return this.config.retryDelayMs * (attempt + 1);
    }

    // Calculate base delay: initialDelay + (attempt * increment)
    // Attempt 0: 60s, Attempt 1: 120s, Attempt 2: 180s, etc.
    const baseDelay = backoff.initialDelayMs + (attempt * backoff.incrementMs);

    // Cap at maximum
    const cappedDelay = Math.min(baseDelay, backoff.maxDelayMs);

    // Add jitter (±jitterFactor of base delay)
    const jitterRange = cappedDelay * backoff.jitterFactor;
    const jitter = (Math.random() * 2 - 1) * jitterRange; // Random between -jitterRange and +jitterRange

    const finalDelay = Math.max(1000, Math.round(cappedDelay + jitter)); // Minimum 1 second

    this.logger.debug({
      attempt,
      baseDelayMs: baseDelay,
      cappedDelayMs: cappedDelay,
      jitterMs: Math.round(jitter),
      finalDelayMs: finalDelay,
      delayMinutes: (finalDelay / 60000).toFixed(1),
    }, 'Calculated progressive retry delay');

    return finalDelay;
  }

  /**
   * Get the model to use for a specific AI task
   * Uses the configured model assignments to determine flash vs pro
   */
  getModelForTask(task: AITask): GeminiModel {
    const tier = this.config.modelAssignments[task];
    const model = tier === 'pro' ? this.config.proModel : this.config.model;
    this.logger.debug({ task, tier, model }, 'Selected model for task');
    return model;
  }

  /**
   * Get the temperature to use for a specific AI task
   * Uses the configured temperature assignments for fine-grained control
   * over creativity vs consistency per task type
   */
  getTemperatureForTask(task: AITask): number {
    const temperature = this.config.temperatureAssignments[task];
    this.logger.debug({ task, temperature }, 'Selected temperature for task');
    return temperature;
  }

  /**
   * Helper to record span attributes for Gemini API calls
   */
  private recordSpanAttributes(
    span: Span,
    options: GenerateOptions,
    model: string
  ): void {
    span.setAttribute('gemini.model', model);
    span.setAttribute('gemini.temperature', options.temperature ?? this.config.defaultTemperature);
    if (options.thinkingBudget) {
      span.setAttribute('gemini.thinking_budget', options.thinkingBudget);
    }
    if (options.responseFormat) {
      span.setAttribute('gemini.response_format', options.responseFormat);
    }
  }

  /**
   * Helper to record usage metrics on span
   */
  private recordUsageMetrics(
    span: Span,
    usage?: {
      promptTokens: number;
      completionTokens: number;
      thinkingTokens?: number;
      totalTokens: number;
    }
  ): void {
    if (usage) {
      span.setAttribute('gemini.tokens.prompt', usage.promptTokens);
      span.setAttribute('gemini.tokens.completion', usage.completionTokens);
      span.setAttribute('gemini.tokens.total', usage.totalTokens);
      if (usage.thinkingTokens) {
        span.setAttribute('gemini.tokens.thinking', usage.thinkingTokens);
      }
    }
  }

  // ===========================================
  // Thinking Capture Helper
  // ===========================================

  /**
   * Capture thinking content separately from structured output
   *
   * When using JSON schema validation (responseSchema), Gemini doesn't include
   * thought content in the response parts. This method makes a separate call
   * WITHOUT JSON schema to capture the AI's reasoning process.
   *
   * Use this before structured output calls when you need to display AI reasoning
   * in the UI (e.g., during ANALYZING, DESIGNING phases).
   *
   * @param prompt The prompt to analyze
   * @param systemInstruction System instruction for context
   * @param model Model to use (should match the subsequent structured call)
   * @param thinkingBudget Thinking budget to use
   * @returns Thought content and signature for display
   */
  async captureThinkingContent(
    prompt: string,
    systemInstruction: string,
    model: GeminiModel,
    thinkingBudget: ThinkingBudget = THINKING_BUDGETS.HIGH
  ): Promise<{
    thoughtContent: string | undefined;
    thoughtSignature: string | undefined;
    thinkingTokensUsed: number;
  }> {
    this.logger.info({
      model,
      thinkingBudget,
      promptLength: prompt.length,
    }, 'Capturing thinking content (separate call without JSON schema)');

    try {
      // Make a call WITHOUT responseSchema to get thinking content
      // Ask for a brief summary to minimize token usage while getting thoughts
      const thinkingPrompt = `${prompt}

Please provide a brief summary of your analysis approach and key insights.
Focus on your reasoning process and decision-making.`;

      const response = await this.generateWithRetry({
        model,
        thinkingBudget,
        systemInstruction,
        responseFormat: 'text', // NOT JSON - allows thought extraction
        // No responseSchema - this is key for getting thought parts
      }, thinkingPrompt);

      // For Gemini 3: Use response.text as thought content since Gemini 3
      // doesn't return thought === true parts. The text IS the thinking summary
      // since we asked the model to explain its reasoning process.
      const thoughtContent = response.thoughtContent || response.text;

      this.logger.info({
        hasThoughtSignature: !!response.thoughtSignature,
        thoughtContentLength: thoughtContent?.length ?? 0,
        thinkingTokens: response.usage?.thinkingTokens ?? 0,
        usedResponseText: !response.thoughtContent && !!response.text,
      }, 'Thinking content captured');

      return {
        thoughtContent,
        thoughtSignature: response.thoughtSignature,
        thinkingTokensUsed: response.usage?.thinkingTokens ?? 0,
      };
    } catch (error) {
      // Don't fail the overall operation if thinking capture fails
      this.logger.warn({
        error: (error as Error).message,
      }, 'Failed to capture thinking content - continuing without it');
      return {
        thoughtContent: undefined,
        thoughtSignature: undefined,
        thinkingTokensUsed: 0,
      };
    }
  }

  /**
   * Analyze dashboard video frames
   */
  async analyzeFrames(request: FrameAnalysisRequest): Promise<GeminiResponse<FrameAnalysisResponse>> {
    this.logger.info('Analyzing dashboard frames', {
      incidentId: request.incidentId,
      frameCount: request.frames.length,
    });

    try {
      const contents = this.buildFrameAnalysisContent(request);

      const response = await this.generateWithRetry({
        model: this.getModelForTask('frameAnalysis'),
        temperature: this.getTemperatureForTask('frameAnalysis'),
        thinkingBudget: THINKING_BUDGETS.MEDIUM,
        systemInstruction: FRAME_ANALYSIS_PROMPT.system,
        responseFormat: 'json',
        responseSchema: FRAME_ANALYSIS_SCHEMA,
      }, contents);

      const parsed = this.parseJsonResponse<FrameAnalysisResponse>(response);

      return {
        success: true,
        data: parsed.data,
        usage: response.usage,
        thoughtSignature: response.thoughtSignature,
      };
    } catch (error) {
      return this.handleError<FrameAnalysisResponse>(error);
    }
  }

  /**
   * Analyze log entries
   */
  async analyzeLogs(request: LogAnalysisRequest): Promise<GeminiResponse<LogAnalysisResponse>> {
    this.logger.info({
      incidentId: request.incidentId,
      logCount: request.logs.length,
    }, 'Analyzing logs');

    try {
      const prompt = LOG_ANALYSIS_PROMPT.build({
        logs: request.logs.join('\n'),
        timeRange: `${request.timeRange.start.toISOString()} to ${request.timeRange.end.toISOString()}`,
        context: request.context ?? '',
      });

      const response = await this.generateWithRetry({
        model: this.getModelForTask('logAnalysis'),
        temperature: this.getTemperatureForTask('logAnalysis'),
        thinkingBudget: THINKING_BUDGETS.LOW,
        systemInstruction: LOG_ANALYSIS_PROMPT.system,
        responseFormat: 'json',
        responseSchema: LOG_ANALYSIS_SCHEMA,
      }, prompt);

      const parsed = this.parseJsonResponse<LogAnalysisResponse>(response);

      return {
        success: true,
        data: parsed.data,
        usage: response.usage,
        thoughtSignature: response.thoughtSignature,
      };
    } catch (error) {
      return this.handleError<LogAnalysisResponse>(error);
    }
  }

  /**
   * Generate hypotheses based on evidence
   *
   * Supports dynamic thinking escalation: when evidence confidence is low,
   * callers can pass a higher thinkingBudget for deeper analysis.
   *
   * Action filtering: When allowedActions is provided, only those actions
   * will be suggested by Gemini. This respects user configuration from
   * the Kubernetes settings in the database.
   */
  async generateHypotheses(
    request: HypothesisGenerationRequest
  ): Promise<GeminiResponse<HypothesisGenerationResponse>> {
    // Use dynamic thinking budget if provided, otherwise default to MEDIUM to prevent timeouts
    const thinkingBudget = request.thinkingBudget ?? THINKING_BUDGETS.MEDIUM;

    // Default to all actions if not specified
    const allowedActions = request.allowedActions ?? ['rollback', 'restart', 'scale'];

    this.logger.info({
      incidentId: request.incidentId,
      evidenceCount: request.evidence.length,
      thinkingBudget,
      isDynamicBudget: request.thinkingBudget !== undefined,
      allowedActions,
    }, 'Generating hypotheses');

    try {
      // Strip frameImage from evidence metadata to avoid exceeding token limits
      // Frame images are stored for UI display, not for AI re-analysis
      const sanitizedEvidence = request.evidence.map(e => ({
        ...e,
        metadata: e.metadata ? this.stripFrameImagesFromMetadata(e.metadata) : null,
      }));

      const prompt = HYPOTHESIS_PROMPT.build({
        evidence: JSON.stringify(sanitizedEvidence, null, 2),
        previousHypotheses: request.previousHypotheses
          ? JSON.stringify(request.previousHypotheses, null, 2)
          : 'None',
        namespace: request.namespace,
        targetDeployment: request.targetDeployment,
        allowedActions,
      });

      // Use Pro model for complex reasoning with dynamic thinking budget
      const response = await this.generateWithRetry({
        model: this.getModelForTask('hypothesisGeneration'),
        temperature: this.getTemperatureForTask('hypothesisGeneration'),
        thinkingBudget,
        systemInstruction: HYPOTHESIS_PROMPT.system,
        responseFormat: 'json',
        responseSchema: HYPOTHESIS_SCHEMA,
        thoughtSignature: request.thoughtSignature,
      }, prompt);

      const parsed = this.parseJsonResponse<HypothesisGenerationResponse>(response);

      // Safety net: Filter out any actions that aren't in the allowed list
      // This catches cases where Gemini might ignore the prompt constraint
      if (parsed.data?.hypotheses) {
        for (const hypothesis of parsed.data.hypotheses) {
          if (hypothesis.suggestedActions) {
            const originalCount = hypothesis.suggestedActions.length;
            hypothesis.suggestedActions = hypothesis.suggestedActions.filter(
              action => allowedActions.includes(action.type)
            );
            const filteredCount = originalCount - hypothesis.suggestedActions.length;
            if (filteredCount > 0) {
              this.logger.warn({
                filteredCount,
                allowedActions,
              }, 'Filtered out disallowed actions from Gemini response');
            }
          }
        }
      }

      return {
        success: true,
        data: {
          ...parsed.data!,
          thoughtSignature: response.thoughtSignature,
          thinkingTokensUsed: response.usage?.thinkingTokens,
        },
        usage: response.usage,
        thoughtSignature: response.thoughtSignature,
      };
    } catch (error) {
      return this.handleError<HypothesisGenerationResponse>(error);
    }
  }

  /**
   * Generate postmortem report
   */
  async generatePostmortem(request: PostmortemRequest): Promise<GeminiResponse<PostmortemResponse>> {
    this.logger.info('Generating postmortem', {
      incidentId: request.incidentId,
      duration: request.duration,
    });

    try {
      const prompt = POSTMORTEM_PROMPT.build({
        title: request.title,
        evidence: JSON.stringify(request.evidence, null, 2),
        hypotheses: JSON.stringify(request.hypotheses, null, 2),
        actions: JSON.stringify(request.actions, null, 2),
        duration: Math.round(request.duration / 1000), // Convert to seconds
      });

      const response = await this.generateWithRetry({
        model: this.getModelForTask('postmortemGeneration'),
        temperature: this.getTemperatureForTask('postmortemGeneration'),
        thinkingBudget: THINKING_BUDGETS.HIGH,
        systemInstruction: POSTMORTEM_PROMPT.system,
        responseFormat: 'json',
        responseSchema: POSTMORTEM_SCHEMA,
        thoughtSignature: request.thoughtSignature,
      }, prompt);

      const parsed = this.parseJsonResponse<PostmortemResponse>(response);

      return {
        success: true,
        data: parsed.data,
        usage: response.usage,
        thoughtSignature: response.thoughtSignature,
      };
    } catch (error) {
      return this.handleError<PostmortemResponse>(error);
    }
  }

  /**
   * Generate postmortem with streaming progress updates
   *
   * Postmortem generation can take 30+ seconds with complex incidents.
   * This streaming version provides real-time progress updates via callback.
   *
   * Use cases:
   * - WebSocket-based UI updates
   * - CLI progress indicators
   * - Long-running job monitoring
   *
   * @param request - Postmortem generation request
   * @param onProgress - Callback invoked with each text chunk as it arrives
   * @param onThinking - Optional callback for thinking/reasoning chunks
   * @returns Complete postmortem response after streaming completes
   */
  async generatePostmortemWithProgress(
    request: PostmortemRequest,
    onProgress?: (chunk: string) => void,
    onThinking?: (thought: string) => void
  ): Promise<GeminiResponse<PostmortemResponse>> {
    this.logger.info({
      incidentId: request.incidentId,
      duration: request.duration,
      streaming: true,
    }, 'Generating postmortem with streaming');

    const startTime = Date.now();

    try {
      const prompt = POSTMORTEM_PROMPT.build({
        title: request.title,
        evidence: JSON.stringify(request.evidence, null, 2),
        hypotheses: JSON.stringify(request.hypotheses, null, 2),
        actions: JSON.stringify(request.actions, null, 2),
        duration: Math.round(request.duration / 1000),
      });

      // Build config for streaming request
      const config: Record<string, unknown> = {
        systemInstruction: POSTMORTEM_PROMPT.system,
        responseMimeType: 'application/json',
        responseSchema: POSTMORTEM_SCHEMA,
      };

      // Only add thinking for models that support it
      // IMPORTANT: Gemini 3 uses thinkingLevel, Gemini 2.5 uses thinkingBudget
      if (supportsThinking(this.config.proModel)) {
        if (isGemini3Model(this.config.proModel)) {
          // Gemini 3 Pro uses thinkingLevel
          config.thinkingConfig = {
            thinkingLevel: 'high',
            includeThoughts: true,
          };
        } else {
          // Gemini 2.5 uses thinkingBudget
          config.thinkingConfig = {
            thinkingBudget: THINKING_BUDGETS.HIGH,
            includeThoughts: true,
          };
        }
      }

      // Start streaming request
      const stream = await this.client.models.generateContentStream({
        model: this.config.proModel,
        contents: prompt,
        config,
      });

      // Collect chunks and invoke callbacks
      let fullText = '';
      let thinkingText = '';
      let chunkCount = 0;

      for await (const chunk of stream) {
        chunkCount++;

        // Process each part in the chunk
        const parts = (chunk as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> })
          .candidates?.[0]?.content?.parts ?? [];

        for (const part of parts) {
          if (part.thought && part.text) {
            // This is thinking/reasoning content
            thinkingText += part.text;
            onThinking?.(part.text);
          } else if (part.text) {
            // This is the actual response content
            fullText += part.text;
            onProgress?.(part.text);
          }
        }

        // Also handle direct text property
        const directText = (chunk as { text?: string }).text;
        if (directText) {
          fullText += directText;
          onProgress?.(directText);
        }
      }

      const elapsed = Date.now() - startTime;
      this.logger.info({
        incidentId: request.incidentId,
        chunkCount,
        totalLength: fullText.length,
        thinkingLength: thinkingText.length,
        elapsedMs: elapsed,
      }, 'Postmortem streaming complete');

      // Parse the complete response
      let data: PostmortemResponse;
      try {
        data = JSON.parse(fullText) as PostmortemResponse;
      } catch (parseError) {
        this.logger.error({
          error: (parseError as Error).message,
          textLength: fullText.length,
          textPreview: fullText.substring(0, 200),
        }, 'Failed to parse streamed postmortem response');

        return {
          success: false,
          error: 'Failed to parse streamed response as JSON',
        };
      }

      // Create thought signature from thinking content
      const thoughtSignature = thinkingText
        ? Buffer.from(thinkingText.slice(0, 2000)).toString('base64')
        : undefined;

      return {
        success: true,
        data,
        thoughtSignature,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error({
        errorName: err.name,
        errorMessage: err.message,
      }, 'Streaming postmortem generation failed');

      return this.handleError<PostmortemResponse>(error);
    }
  }

  /**
   * Analyze with full context - leverages Gemini 3's 1M token context window
   *
   * This method enables deep correlation analysis by loading:
   * - Complete logs (not samples) - megabytes of log data
   * - Historical similar incidents - pattern matching from past issues
   * - Full Kubernetes state - deployments, events, pod statuses
   * - All collected evidence - visual, metrics, logs
   *
   * The 1M token context window eliminates the need for:
   * - Chunking/splitting large documents
   * - RAG retrieval pipelines
   * - Sampling/truncation of logs
   *
   * @see https://ai.google.dev/gemini-api/docs/gemini-3
   */
  async analyzeWithFullContext(
    request: FullContextAnalysisRequest
  ): Promise<GeminiResponse<FullContextAnalysisResponse>> {
    // Calculate context statistics
    const logLines = request.fullLogs?.split('\n').length ?? 0;
    const evidenceCount = request.evidence.length;
    const historicalCount = request.historicalIncidents?.length ?? 0;

    // Estimate token count (roughly 4 chars per token)
    const estimatedTokens = this.estimateTokenCount(request);

    this.logger.info({
      incidentId: request.incidentId,
      estimatedTokens,
      logLines,
      evidenceCount,
      historicalCount,
      isLargeContext: estimatedTokens > 100000,
    }, 'Analyzing with full context (1M token window)');

    // Warn if approaching context limits
    if (estimatedTokens > 900000) {
      this.logger.warn({
        estimatedTokens,
        limit: 1000000,
      }, 'Approaching 1M token context limit');
    }

    try {
      // Build the full context prompt
      const prompt = FULL_CONTEXT_ANALYSIS_PROMPT.build({
        incident: JSON.stringify({
          id: request.incidentId,
          title: request.incidentTitle,
          description: request.incidentDescription,
          severity: request.severity,
          namespace: request.namespace,
        }, null, 2),
        evidence: JSON.stringify(request.evidence, null, 2),
        fullLogs: request.fullLogs ?? '',
        historicalIncidents: request.historicalIncidents
          ? JSON.stringify(request.historicalIncidents, null, 2)
          : '[]',
        kubernetesContext: request.kubernetesContext
          ? JSON.stringify(request.kubernetesContext, null, 2)
          : '{}',
      });

      // Use Pro model for large context analysis - MEDIUM budget to prevent phase timeouts
      const thinkingBudget = request.thinkingBudget ?? THINKING_BUDGETS.MEDIUM;

      const response = await this.generateWithRetry({
        model: this.config.proModel,
        thinkingBudget,
        systemInstruction: FULL_CONTEXT_ANALYSIS_PROMPT.system,
        responseFormat: 'json',
        responseSchema: FULL_CONTEXT_ANALYSIS_SCHEMA,
        thoughtSignature: request.thoughtSignature,
      }, prompt);

      const parsed = this.parseJsonResponse<FullContextAnalysisResponse>(response);

      // Enrich response with context stats
      if (parsed.data) {
        parsed.data.contextStats = {
          estimatedInputTokens: estimatedTokens,
          evidenceItems: evidenceCount,
          logLines,
          historicalIncidents: historicalCount,
        };
      }

      this.logger.info({
        incidentId: request.incidentId,
        promptTokens: response.usage?.promptTokens,
        thinkingTokens: response.usage?.thinkingTokens,
        correlationsFound: parsed.data?.correlations?.length ?? 0,
        patternsMatched: parsed.data?.historicalPatterns?.length ?? 0,
      }, 'Full context analysis complete');

      return {
        success: true,
        data: parsed.data,
        usage: response.usage,
        thoughtSignature: response.thoughtSignature,
      };
    } catch (error) {
      return this.handleError<FullContextAnalysisResponse>(error);
    }
  }

  /**
   * Analyze with Kubernetes tool use - real-time cluster inspection
   *
   * This method enables Gemini to query Kubernetes resources during investigation:
   * - kubectl get (pods, deployments, services, events)
   * - kubectl logs (pod logs for error investigation)
   * - kubectl describe (detailed resource info)
   * - kubectl top (CPU/memory metrics)
   * - kubectl rollout (deployment status/history)
   *
   * Gemini autonomously decides which tools to call based on the investigation context.
   * The toolExecutor callback handles actual execution against the cluster.
   *
   * @see https://ai.google.dev/gemini-api/docs/function-calling
   */
  async analyzeWithTools(
    request: AnalysisWithToolsRequest
  ): Promise<GeminiResponse<AnalysisWithToolsResponse>> {
    const maxRounds = request.maxToolRounds ?? 5;

    this.logger.info({
      incidentId: request.incidentId,
      namespace: request.namespace,
      maxRounds,
      toolCount: KUBERNETES_TOOLS.length,
    }, 'Starting tool-enabled analysis');

    const toolCallsExecuted: Array<{
      tool: string;
      args: Record<string, unknown>;
      result: unknown;
    }> = [];

    try {
      // Build initial config with tools
      const config: Record<string, unknown> = {
        systemInstruction: TOOL_ANALYSIS_SYSTEM_PROMPT,
        tools: toGeminiToolFormat(KUBERNETES_TOOLS),
        toolConfig: {
          functionCallingConfig: {
            mode: 'AUTO', // Let Gemini decide when to call tools
          },
        },
      };

      // Add thinking if requested and model supports it
      // IMPORTANT: Gemini 3 uses thinkingLevel, Gemini 2.5 uses thinkingBudget
      if (request.thinkingBudget && supportsThinking(this.config.model)) {
        if (isGemini3Model(this.config.model)) {
          // Gemini 3 models use thinkingLevel (discrete levels)
          const isFlash = this.config.model.includes('flash');
          const thinkingLevel = budgetToThinkingLevel(request.thinkingBudget, isFlash);
          config.thinkingConfig = {
            thinkingLevel,
            includeThoughts: true,
          };
          this.logger.debug({ thinkingLevel }, 'Tool analysis using Gemini 3 thinkingLevel');
        } else {
          // Gemini 2.5 and earlier models use thinkingBudget (token count)
          config.thinkingConfig = {
            thinkingBudget: request.thinkingBudget,
            includeThoughts: true,
          };
        }
      }

      // Build initial prompt with context
      const initialPrompt = `Incident ID: ${request.incidentId}
Namespace: ${request.namespace}

Investigation Request:
${request.prompt}

Use the available Kubernetes tools to gather information needed for your analysis.
After gathering sufficient data, provide your findings and recommendations.`;

      // Enrich with previous thought context if available
      const contents = this.enrichContentsWithThoughtContext(
        initialPrompt,
        request.thoughtSignature
      );

      // Conversation history for multi-turn tool calls
      // Note: functionResponse.response must be Record<string, unknown> per SDK requirements
      const conversationHistory: Array<{
        role: 'user' | 'model' | 'function';
        parts: Array<{
          text?: string;
          functionCall?: GeminiFunctionCall;
          functionResponse?: { name: string; response: Record<string, unknown> };
        }>;
      }> = [
        { role: 'user', parts: [{ text: typeof contents === 'string' ? contents : JSON.stringify(contents) }] },
      ];

      let round = 0;
      let finalResponse: string | null = null;
      let thoughtSignature: string | undefined;

      // Tool call loop - continue until Gemini provides a final response
      while (round < maxRounds && finalResponse === null) {
        round++;

        this.logger.debug({
          round,
          historyLength: conversationHistory.length,
        }, 'Tool call round');

        // Make API call
        const response = await this.client.models.generateContent({
          model: this.config.model,
          contents: conversationHistory,
          config,
        });

        // Extract thought signature from this round
        const roundThoughtSignature = this.extractThoughtSignature(response);
        if (roundThoughtSignature) {
          thoughtSignature = roundThoughtSignature;
        }

        // Check for function calls in the response
        const candidates = (response as {
          candidates?: Array<{
            content?: {
              parts?: Array<{
                text?: string;
                functionCall?: { name: string; args: Record<string, unknown> };
              }>;
            };
          }>;
        }).candidates;

        const parts = candidates?.[0]?.content?.parts ?? [];
        const functionCalls = parts.filter((p) => p.functionCall).map((p) => p.functionCall!);
        const textParts = parts.filter((p) => p.text).map((p) => p.text!);

        if (functionCalls.length > 0) {
          // Add model response to history
          conversationHistory.push({
            role: 'model',
            parts: functionCalls.map((fc) => ({ functionCall: fc })),
          });

          // Execute each function call
          const functionResults: Array<{ name: string; response: Record<string, unknown> }> = [];

          for (const fc of functionCalls) {
            this.logger.info({
              tool: fc.name,
              args: fc.args,
              round,
            }, 'Executing tool call');

            try {
              // Execute the tool via the callback
              const result = await request.toolExecutor(fc.name, fc.args);

              // Wrap result in a record structure for SDK compatibility
              const wrappedResult = typeof result === 'object' && result !== null
                ? (result as Record<string, unknown>)
                : { value: result };

              toolCallsExecuted.push({
                tool: fc.name,
                args: fc.args,
                result,
              });

              functionResults.push({
                name: fc.name,
                response: wrappedResult,
              });

              this.logger.debug({
                tool: fc.name,
                resultSize: JSON.stringify(result).length,
              }, 'Tool call completed');
            } catch (toolError) {
              const err = toolError as Error;
              this.logger.error({
                tool: fc.name,
                error: err.message,
              }, 'Tool execution failed');

              functionResults.push({
                name: fc.name,
                response: { error: err.message },
              });

              toolCallsExecuted.push({
                tool: fc.name,
                args: fc.args,
                result: { error: err.message },
              });
            }
          }

          // Add function results to history
          conversationHistory.push({
            role: 'function',
            parts: functionResults.map((fr) => ({ functionResponse: fr })),
          });
        } else if (textParts.length > 0) {
          // No more function calls - this is the final response
          finalResponse = textParts.join('\n');
        } else {
          // Unexpected response format
          this.logger.warn({ response: JSON.stringify(response).substring(0, 500) }, 'Unexpected response format');
          finalResponse = response.text ?? 'Analysis complete (no detailed response)';
        }
      }

      if (finalResponse === null) {
        finalResponse = `Analysis stopped after ${maxRounds} tool call rounds. Gathered ${toolCallsExecuted.length} data points.`;
      }

      this.logger.info({
        incidentId: request.incidentId,
        totalToolCalls: toolCallsExecuted.length,
        rounds: round,
      }, 'Tool-enabled analysis complete');

      return {
        success: true,
        data: {
          analysis: finalResponse,
          toolCallsExecuted,
          totalToolCalls: toolCallsExecuted.length,
        },
        thoughtSignature,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error({
        errorName: err.name,
        errorMessage: err.message,
        toolCallsExecuted: toolCallsExecuted.length,
      }, 'Tool-enabled analysis failed');

      return {
        success: false,
        error: err.message,
        data: {
          analysis: `Analysis failed: ${err.message}`,
          toolCallsExecuted,
          totalToolCalls: toolCallsExecuted.length,
        },
      };
    }
  }

  // ===========================================
  // Development / Self-Regenerating Methods
  // ===========================================

  /**
   * Analyze a requirement and produce structured specification
   * Uses HIGH thinking budget for thorough analysis
   *
   * @param request.captureThinking When true, makes a separate call to capture
   *   AI reasoning for UI display (JSON schema mode doesn't return thoughts)
   */
  async analyzeRequirement(
    request: RequirementAnalysisGeminiRequest
  ): Promise<GeminiResponse<RequirementAnalysisGeminiResponse>> {
    this.logger.info({
      requirementLength: request.requirement.length,
      captureThinking: request.captureThinking ?? false,
    }, 'Analyzing requirement');

    try {
      const prompt = ANALYZE_REQUIREMENT_PROMPT.build({
        requirement: request.requirement,
        projectContext: request.projectContext ?? '',
        existingPatterns: request.existingPatterns ?? '',
      });

      // Optionally capture thinking content via separate call
      let capturedThought: { thoughtContent?: string; thoughtSignature?: string } = {};
      if (request.captureThinking) {
        const thinkingResult = await this.captureThinkingContent(
          prompt,
          ANALYZE_REQUIREMENT_PROMPT.system,
          this.getModelForTask('requirementAnalysis'),
          THINKING_BUDGETS.HIGH // Use HIGH for thorough requirement analysis
        );
        capturedThought = {
          thoughtContent: thinkingResult.thoughtContent,
          thoughtSignature: thinkingResult.thoughtSignature,
        };
        this.logger.info({
          hasThoughtContent: !!capturedThought.thoughtContent,
          thoughtContentLength: capturedThought.thoughtContent?.length ?? 0,
        }, 'Thinking captured for requirement analysis');
      }
      if (capturedThought.thoughtContent) {
        const baseDelayMs = 5000; // 5 seconds base
        const actualDelayMs = this.calculateDynamicDelay(baseDelayMs, 'analyzeRequirement');
        if (actualDelayMs > 0) {
          this.logger.info({ delayMs: actualDelayMs }, 'Pre-request delay before structured output call');
          await new Promise((resolve) => setTimeout(resolve, actualDelayMs));
        }
      }
      // Now make the structured output call
      // IMPORTANT: Skip thinkingBudget if we already captured thinking in first call
      // Using both thinking + JSON schema together causes very slow responses (5+ minutes)
      const response = await this.generateWithRetry({
        model: this.getModelForTask('requirementAnalysis'),
        temperature: this.getTemperatureForTask('requirementAnalysis'),
        // Only use thinking if we didn't already capture it
        thinkingBudget: capturedThought.thoughtContent ? undefined : THINKING_BUDGETS.MEDIUM,
        systemInstruction: ANALYZE_REQUIREMENT_PROMPT.system,
        responseFormat: 'json',
        responseSchema: REQUIREMENT_ANALYSIS_SCHEMA,
        thoughtSignature: capturedThought.thoughtSignature ?? request.thoughtSignature,
      }, prompt);

      const parsed = this.parseJsonResponse<RequirementAnalysisGeminiResponse>(response);

      return {
        success: true,
        data: parsed.data,
        usage: response.usage,
        // Use captured thinking if available, otherwise fall back to response
        thoughtSignature: capturedThought.thoughtSignature ?? response.thoughtSignature,
        thoughtContent: capturedThought.thoughtContent ?? response.thoughtContent,
      };
    } catch (error) {
      return this.handleError<RequirementAnalysisGeminiResponse>(error);
    }
  }

  /**
   * Design architecture for a feature based on analyzed requirement
   * Uses HIGH thinking budget for complex architectural decisions
   *
   * @param request.captureThinking When true, makes a separate call to capture
   *   AI reasoning for UI display (JSON schema mode doesn't return thoughts)
   */
  async designArchitecture(
    request: ArchitectureDesignGeminiRequest
  ): Promise<GeminiResponse<ArchitectureDesignGeminiResponse>> {
    this.logger.info({
      captureThinking: request.captureThinking ?? false,
    }, 'Designing architecture for requirement');

    try {
      const prompt = DESIGN_ARCHITECTURE_PROMPT.build({
        requirement: request.requirement,
        acceptanceCriteria: request.acceptanceCriteria ?? [],
        existingArchitecture: request.existingArchitecture ?? '',
        codebaseContext: request.codebaseContext ?? '',
      });

      // Optionally capture thinking content via separate call
      let capturedThought: { thoughtContent?: string; thoughtSignature?: string } = {};
      if (request.captureThinking) {
        const thinkingResult = await this.captureThinkingContent(
          prompt,
          DESIGN_ARCHITECTURE_PROMPT.system,
          this.getModelForTask('architectureDesign'),
          THINKING_BUDGETS.MEDIUM // Reduced from HIGH to prevent 504 timeouts
        );
        capturedThought = {
          thoughtContent: thinkingResult.thoughtContent,
          thoughtSignature: thinkingResult.thoughtSignature,
        };
        this.logger.info({
          hasThoughtContent: !!capturedThought.thoughtContent,
          thoughtContentLength: capturedThought.thoughtContent?.length ?? 0,
        }, 'Thinking captured for architecture design');
      }
      if (capturedThought.thoughtContent) {
        const baseDelayMs = 10000; // 10 seconds base for architecture (heavier call)
        const actualDelayMs = this.calculateDynamicDelay(baseDelayMs, 'designArchitecture');
        if (actualDelayMs > 0) {
          this.logger.info({ delayMs: actualDelayMs }, 'Pre-request delay before structured output call');
          await new Promise((resolve) => setTimeout(resolve, actualDelayMs));
        }
      }
      // Now make the structured output call
      // IMPORTANT: Skip thinkingBudget if we already captured thinking in first call
      // Using both thinking + JSON schema together causes very slow responses (5+ minutes)
      const response = await this.generateWithRetry({
        model: this.getModelForTask('architectureDesign'),
        temperature: this.getTemperatureForTask('architectureDesign'),
        // Only use thinking if we didn't already capture it
        thinkingBudget: capturedThought.thoughtContent ? undefined : THINKING_BUDGETS.MEDIUM,
        systemInstruction: DESIGN_ARCHITECTURE_PROMPT.system,
        responseFormat: 'json',
        responseSchema: ARCHITECTURE_DESIGN_SCHEMA,
        thoughtSignature: capturedThought.thoughtSignature ?? request.thoughtSignature,
      }, prompt);

      const parsed = this.parseJsonResponse<ArchitectureDesignGeminiResponse>(response);

      return {
        success: true,
        data: parsed.data,
        usage: response.usage,
        // Use captured thinking if available, otherwise fall back to response
        thoughtSignature: capturedThought.thoughtSignature ?? response.thoughtSignature,
        thoughtContent: capturedThought.thoughtContent ?? response.thoughtContent,
      };
    } catch (error) {
      return this.handleError<ArchitectureDesignGeminiResponse>(error);
    }
  }

  /**
   * Generate an architecture diagram image from a completed architecture design.
   * Uses the Gemini image generation model to produce a visual representation
   * of the system architecture (components, data flow, dependencies).
   *
   * This is a non-blocking, best-effort operation - failures do not break the pipeline.
   *
   * @param architecture The completed architecture design (accepts both shared and Gemini response types)
   * @returns Base64-encoded PNG image buffer, or null if generation fails
   */
  async generateArchitectureDiagram(
    architecture: {
      overview: string;
      components: Array<{ name: string; type: string; purpose: string }>;
      dependencies: Array<{ from: string; to: string; type: string }>;
      dataFlow: string;
    }
  ): Promise<{ imageBuffer: Buffer; mimeType: string } | null> {
    this.logger.info({
      componentCount: architecture.components.length,
    }, 'Generating architecture diagram image');

    try {
      // Build a descriptive prompt from the architecture
      const componentDescriptions = architecture.components
        .map(c => `- ${c.name} (${c.type}): ${c.purpose}`)
        .join('\n');

      const dependencyDescriptions = architecture.dependencies
        .map(d => `${d.from} → ${d.to} (${d.type})`)
        .join('\n');

      const prompt = `Generate a clean, professional software architecture diagram with the following specifications:

SYSTEM OVERVIEW: ${architecture.overview}

COMPONENTS:
${componentDescriptions}

DEPENDENCIES/CONNECTIONS:
${dependencyDescriptions}

DATA FLOW: ${architecture.dataFlow}

STYLE REQUIREMENTS:
- Use a dark theme with a dark gray/navy background (#1a1b2e or similar)
- Use colored boxes/rounded rectangles for each component with labels
- Color-code by component type: services=blue, repositories=purple, controllers=green, middleware=orange, routes=cyan, models=teal, utils=gray
- Draw arrows showing data flow and dependencies between components
- Include a title at the top
- Keep it clean, readable, and professional - like a real architecture diagram
- Use a left-to-right or top-to-bottom flow layout
- Include the component names inside each box
- Make text large and clearly legible`;

      // Use the image generation model directly via the SDK
      const response = await this.client.models.generateContent({
        model: GEMINI_MODELS.IMAGE,
        contents: prompt,
        config: {
          responseModalities: ['IMAGE', 'TEXT'],
        },
      });

      // Extract image from response parts
      if (response.candidates && response.candidates[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData?.data && part.inlineData?.mimeType) {
            const imageBuffer = Buffer.from(part.inlineData.data, 'base64');
            this.logger.info({
              mimeType: part.inlineData.mimeType,
              sizeBytes: imageBuffer.length,
            }, 'Architecture diagram generated successfully');
            return {
              imageBuffer,
              mimeType: part.inlineData.mimeType,
            };
          }
        }
      }

      this.logger.warn('No image data found in Gemini response');
      return null;
    } catch (error) {
      this.logger.error({
        errorName: error instanceof Error ? error.name : 'Unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
      }, 'Failed to generate architecture diagram (non-fatal)');
      return null;
    }
  }

  /**
   * Generate entity schema from analyzed requirement using AI
   * This enables autonomous schema inference for ANY domain (users, widgets, bookings, etc.)
   * 
   * @param requirement The analyzed requirement with title, description, acceptance criteria
   * @returns Schema generation result with entity fields inferred by AI
   */
  async generateSchema(
    requirement: { title: string; description?: string; acceptanceCriteria?: string[]; suggestedApproach?: string; estimatedComplexity?: string }
  ): Promise<GeminiResponse<{
    resourceName: string;
    resourceNamePlural: string;
    fields: Array<{
      name: string;
      type: string;
      zodType: string;
      required: boolean;
      inCreate: boolean;
      inUpdate: boolean;
      description?: string;
    }>;
    entitySchema: string;
    createSchema: string;
    updateSchema: string;
  }>> {
    this.logger.info({
      title: requirement.title,
    }, 'Generating schema with AI');

    try {
      const systemPrompt = `You are generating Zod schemas for a TypeScript REST API.

CRITICAL RULES:
1. Infer the resource name and fields from the requirement description
2. Create schemas MUST have all required fields as z.string() (NO .optional())
3. Update schemas MUST have all fields as .optional() (for partial updates)
4. Types MUST be derived using z.infer<typeof Schema>
5. Field names must be camelCase
6. Use proper Zod validators: z.string().email(), z.string().uuid(), z.string().datetime()

DOMAIN INFERENCE EXAMPLES:
- "user management" → fields: email, name, role
- "task/todo" → fields: title, description, status, priority
- "product catalog" → fields: name, description, price, stock
- "booking system" → fields: date, time, duration, guestName, status
- "widget inventory" → fields: name, type, quantity, location

REQUIRED OUTPUT (JSON):
{
  "resourceName": "singularName",
  "resourceNamePlural": "pluralName", 
  "fields": [
    {
      "name": "id",
      "type": "string",
      "zodType": "z.string().uuid()",
      "required": true,
      "inCreate": false,
      "inUpdate": false,
      "description": "Unique identifier"
    }
  ],
  "entitySchema": "const Schema = z.object({...});",
  "createSchema": "const CreateSchema = z.object({...});",
  "updateSchema": "const UpdateSchema = z.object({...});"
}`;

      const prompt = `Generate Zod schemas for the following API:

REQUIREMENT:
${requirement.title}

${requirement.description ? `DESCRIPTION:\n${requirement.description}` : ''}

${requirement.acceptanceCriteria?.length ? `ACCEPTANCE CRITERIA:\n${requirement.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}` : ''}

${requirement.suggestedApproach ? `SUGGESTED APPROACH:\n${requirement.suggestedApproach}` : ''}

Analyze this requirement and infer:
1. The resource name (singular and plural)
2. All fields that would be needed for this entity
3. Which fields are required for creation vs optional
4. Proper Zod validation for each field type

Include standard fields: id, createdAt, updatedAt
Be thorough - infer all domain-specific fields that would be needed.`;

      const response = await this.generateWithRetry({
        model: this.getModelForTask('codeGeneration'),
        temperature: this.getTemperatureForTask('codeGeneration'),
        thinkingBudget: THINKING_BUDGETS.MEDIUM,
        systemInstruction: systemPrompt,
        responseFormat: 'json',
      }, prompt);

      // Parse JSON response
      const text = response.text?.trim() ?? '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in schema generation response');
      }

      const data = JSON.parse(jsonMatch[0]);

      return {
        success: true,
        data,
        usage: response.usage,
        thoughtSignature: response.thoughtSignature,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Generate production-quality code for a component
   * Uses MEDIUM thinking budget to balance quality with API latency
   */
  async generateCode(
    request: CodeGenerationGeminiRequest
  ): Promise<GeminiResponse<CodeGenerationGeminiResponse>> {
    const estimatedTokens = this.estimateCodeGenTokenCount(request);
    const isLargeRequest = estimatedTokens > 50000;

    this.logger.info({
      requirementId: request.requirementId,
      targetLanguage: request.targetLanguage,
      estimatedTokens,
      isLargeRequest,
    }, 'Generating code');

    if (estimatedTokens > 100000) {
      this.logger.warn({
        estimatedTokens,
        requirementId: request.requirementId,
      }, 'Large code generation request - consider breaking into smaller components');
    }

    try {
      const prompt = GENERATE_CODE_PROMPT.build({
        component: request.component ?? '',
        architecture: request.architecture ?? '',
        codebaseContext: request.context,
        previousThoughtSignature: request.thoughtSignature ?? '',
        constraints: request.constraints ?? [],
      });

      // Skip thinking if we already have a thoughtSignature from previous phases
         
      const delayMs = 1 * 5 * 1000; // 2 seconds
      this.logger.info({ delayMs, delayMinutes: 2 }, 'Waiting before structured output call');
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      this.logger.info('Delay complete, proceeding with structured output call');
    
      // This speeds up the API call since thinking + JSON schema is very slow
      const response = await this.generateWithRetry({
        model: this.getModelForTask('codeGeneration'),
        temperature: this.getTemperatureForTask('codeGeneration'),
        thinkingBudget: request.thoughtSignature ? undefined : THINKING_BUDGETS.MEDIUM,
        maxOutputTokens: 65536, // Ensure enough tokens for full file generation
        systemInstruction: GENERATE_CODE_PROMPT.system,
        responseFormat: 'json',
        responseSchema: CODE_GENERATION_SCHEMA,
        thoughtSignature: request.thoughtSignature,
      }, prompt);

      const parsed = this.parseJsonResponse<CodeGenerationGeminiResponse>(response);

      return {
        success: true,
        data: parsed.data,
        usage: response.usage,
        thoughtSignature: response.thoughtSignature,
      };
    } catch (error) {
      return this.handleError<CodeGenerationGeminiResponse>(error);
    }
  }

  /**
   * Fix code errors while preserving functionality
   * Uses MEDIUM thinking budget for targeted fixes
   */
  async fixCode(
    request: CodeFixGeminiRequest
  ): Promise<GeminiResponse<CodeFixGeminiResponse>> {
    this.logger.info({
      language: request.language,
      previousAttempts: request.previousAttempts ?? 0,
    }, 'Fixing code');

    try {
      const prompt = FIX_CODE_PROMPT.build({
        code: request.code,
        errors: request.errors,
        context: request.context ?? '',
        previousAttempts: request.previousAttempts ?? 0,
      });

      // Use dynamic delay - skip if enough time has passed since last call
      const baseDelayMs = 3000; // 3 seconds base
      const actualDelayMs = this.calculateDynamicDelay(baseDelayMs, 'fixCode');
      if (actualDelayMs > 0) {
        this.logger.info({ delayMs: actualDelayMs }, 'Pre-request delay before code fix call');
        await new Promise((resolve) => setTimeout(resolve, actualDelayMs));
      }

      // Use LOW thinking for code fixes - they're usually targeted fixes, not complex reasoning
      // This also reduces DEADLINE_EXCEEDED errors which are common with MEDIUM/HIGH thinking
      // The FIX_CODE_PROMPT is already detailed enough to guide simple fixes
      const response = await this.generateWithRetry({
        model: this.getModelForTask('codeFix'),
        temperature: this.getTemperatureForTask('codeFix'),
        thinkingBudget: request.thoughtSignature ? undefined : THINKING_BUDGETS.LOW,
        maxOutputTokens: 65536, // Ensure enough tokens for full file rewrite + thinking
        systemInstruction: FIX_CODE_PROMPT.system,
        responseFormat: 'json',
        responseSchema: CODE_FIX_SCHEMA,
        thoughtSignature: request.thoughtSignature,
      }, prompt);

      const parsed = this.parseJsonResponse<CodeFixGeminiResponse>(response);

      return {
        success: true,
        data: parsed.data,
        usage: response.usage,
        thoughtSignature: response.thoughtSignature,
      };
    } catch (error) {
      return this.handleError<CodeFixGeminiResponse>(error);
    }
  }

  /**
   * Enhance an OpenAPI spec using AI analysis of source code
   * 
   * This function analyzes the actual source code to generate a complete,
   * accurate OpenAPI 3.0 spec with proper security schemes, parameters,
   * request bodies, and response schemas.
   * 
   * Uses LOW thinking budget for fast, targeted enhancement.
   * 
   * Note: We don't use responseSchema here because OpenAPI specs have dynamic
   * structures (paths, schemas, etc.) that can't be expressed in a fixed schema.
   * Instead, we use responseFormat: 'json' and parse the response directly.
   * 
   * @param sourceCode - The TypeScript/Express source code to analyze
   * @param existingSpec - The existing (potentially incomplete) OpenAPI spec
   * @param routes - List of detected route patterns from the code
   * @param apiName - Name of the API for documentation
   * @returns Enhanced OpenAPI 3.0 specification
   */
  async enhanceOpenApiSpec(params: {
    sourceCode: string;
    existingSpec: Record<string, unknown>;
    routes: string[];
    apiName: string;
  }): Promise<GeminiResponse<Record<string, unknown>>> {
    this.logger.info({
      routeCount: params.routes.length,
      apiName: params.apiName,
      existingPathCount: Object.keys((params.existingSpec as { paths?: Record<string, unknown> })?.paths || {}).length,
    }, 'Enhancing OpenAPI spec with AI analysis');

    try {
      const prompt = ENHANCE_OPENAPI_SPEC_PROMPT.build({
        sourceCode: params.sourceCode,
        existingSpec: JSON.stringify(params.existingSpec, null, 2),
        routes: params.routes,
        apiName: params.apiName,
      });

      // Short delay to avoid rate limiting
      const delayMs = 2000;
      this.logger.info({ delayMs }, 'Short delay before OpenAPI enhancement call');
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      // Use LOW thinking for fast, targeted enhancement
      // Note: We use responseFormat: 'json' without responseSchema because
      // OpenAPI specs have dynamic structures that can't be expressed in a fixed schema
      const response = await this.generateWithRetry({
        model: this.getModelForTask('codeFix'), // Use same model as code fixes
        temperature: 0.1, // Low temperature for consistent output
        thinkingBudget: THINKING_BUDGETS.LOW,
        systemInstruction: ENHANCE_OPENAPI_SPEC_PROMPT.system,
        responseFormat: 'json',
        // No responseSchema - OpenAPI has dynamic structure
      }, prompt);

      // Extract clean JSON from potentially contaminated response
      const cleanedText = this.extractJsonFromResponse(response.text);
      const parsed = this.parseJsonResponse<Record<string, unknown>>({ text: cleanedText });

      this.logger.info({
        enhancedPathCount: Object.keys((parsed.data as { paths?: Record<string, unknown> })?.paths || {}).length,
        hasSecuritySchemes: !!(parsed.data as { components?: { securitySchemes?: unknown } })?.components?.securitySchemes,
      }, 'OpenAPI spec enhanced successfully');

      return {
        success: true,
        data: parsed.data,
        usage: response.usage,
      };
    } catch (error) {
      this.logger.error({ error }, 'Failed to enhance OpenAPI spec');
      return this.handleError<Record<string, unknown>>(error);
    }
  }

  /**
   * Generate tests for a component
   * Uses MEDIUM thinking budget
   */
  async generateTests(
    request: TestGenerationGeminiRequest
  ): Promise<GeminiResponse<TestGenerationGeminiResponse>> {
    this.logger.info({
      framework: request.framework,
      coverageTarget: request.coverageTarget ?? 80,
    }, 'Generating tests');

    try {
      const prompt = GENERATE_TESTS_PROMPT.build({
        component: request.component,
        code: request.code,
        framework: request.framework,
        coverageTarget: request.coverageTarget ?? 80,
      });

      // Skip thinking if we already have a thoughtSignature from previous phases
      
      const delayMs = 1 * 5 * 1000; // 2 seconds
      this.logger.info({ delayMs, delayMinutes: 5 }, 'Waiting before structured output call');
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      this.logger.info('Delay complete, proceeding with structured output call');
    
      // This speeds up the API call since thinking + JSON schema is very slow
      const response = await this.generateWithRetry({
        model: this.getModelForTask('testGeneration'),
        temperature: this.getTemperatureForTask('testGeneration'),
        thinkingBudget: request.thoughtSignature ? undefined : THINKING_BUDGETS.MEDIUM,
        systemInstruction: GENERATE_TESTS_PROMPT.system,
        responseFormat: 'json',
        responseSchema: TEST_GENERATION_SCHEMA,
        thoughtSignature: request.thoughtSignature,
      }, prompt);

      const parsed = this.parseJsonResponse<TestGenerationGeminiResponse>(response);

      return {
        success: true,
        data: parsed.data,
        usage: response.usage,
        thoughtSignature: response.thoughtSignature,
      };
    } catch (error) {
      return this.handleError<TestGenerationGeminiResponse>(error);
    }
  }

  /**
   * Generate tests for ALL components in a single call
   * Uses 1M context window for comprehensive test generation
   * Skips thinking if thoughtSignature provided from previous phases
   */
  async generateAllTests(
    request: AllTestsGenerationGeminiRequest
  ): Promise<GeminiResponse<TestGenerationGeminiResponse>> {
    this.logger.info({
      framework: request.framework,
      coverageTarget: request.coverageTarget ?? 80,
    }, 'Generating tests for ALL components in single call');

    try {
      const prompt = GENERATE_ALL_TESTS_PROMPT.build({
        allComponents: request.allComponents,
        allCode: request.allCode,
        framework: request.framework,
        coverageTarget: request.coverageTarget ?? 80,
      });

      // Skip thinking if we already have a thoughtSignature from previous phases
      const delayMs = 1 * 5 * 1000; // 2 seconds
      this.logger.info({ delayMs, delayMinutes: 5 }, 'Waiting before structured output call');
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      this.logger.info('Delay complete, proceeding with structured output call');

      // This speeds up the API call since thinking + JSON schema is very slow
      const response = await this.generateWithRetry({
        model: this.getModelForTask('testGeneration'),
        temperature: this.getTemperatureForTask('testGeneration'),
        thinkingBudget: request.thoughtSignature ? undefined : THINKING_BUDGETS.MEDIUM,
        systemInstruction: GENERATE_ALL_TESTS_PROMPT.system,
        responseFormat: 'json',
        responseSchema: TEST_GENERATION_SCHEMA,
        thoughtSignature: request.thoughtSignature,
      }, prompt);

      const parsed = this.parseJsonResponse<TestGenerationGeminiResponse>(response);

      return {
        success: true,
        data: parsed.data,
        usage: response.usage,
        thoughtSignature: response.thoughtSignature,
      };
    } catch (error) {
      return this.handleError<TestGenerationGeminiResponse>(error);
    }
  }

  /**
   * Reconstruct incident from raw data using 1M context window
   * Uses HIGH thinking budget for comprehensive analysis
   */
  async reconstructIncident(
    request: IncidentReconstructionGeminiRequest
  ): Promise<GeminiResponse<IncidentReconstructionGeminiResponse>> {
    const logLines = request.logs?.split('\n').length ?? 0;

    this.logger.info({
      timeRange: request.timeRange,
      logLines,
      hasMetrics: !!request.metrics,
      hasScreenshots: !!request.screenshots,
      hasEvents: !!request.events,
      hasDeployments: !!request.deployments,
    }, 'Reconstructing incident from raw data');

    try {
      const prompt = RECONSTRUCT_INCIDENT_PROMPT.build({
        logs: request.logs ?? '',
        metrics: request.metrics ?? '',
        screenshots: request.screenshots ?? '',
        events: request.events ?? '',
        deployments: request.deployments ?? '',
        timeRange: request.timeRange,
      });

      const response = await this.generateWithRetry({
        model: this.getModelForTask('incidentReconstruction'),
        temperature: this.getTemperatureForTask('incidentReconstruction'),
        thinkingBudget: THINKING_BUDGETS.HIGH,
        systemInstruction: RECONSTRUCT_INCIDENT_PROMPT.system,
        responseFormat: 'json',
        responseSchema: INCIDENT_RECONSTRUCTION_SCHEMA,
        thoughtSignature: request.thoughtSignature,
      }, prompt);

      const parsed = this.parseJsonResponse<IncidentReconstructionGeminiResponse>(response);

      return {
        success: true,
        data: parsed.data,
        usage: response.usage,
        thoughtSignature: response.thoughtSignature,
      };
    } catch (error) {
      return this.handleError<IncidentReconstructionGeminiResponse>(error);
    }
  }

  /**
   * Learn patterns from resolved incidents
   * Uses MEDIUM thinking budget
   */
  async learnPattern(
    request: PatternLearningGeminiRequest
  ): Promise<GeminiResponse<PatternLearningGeminiResponse>> {
    this.logger.info('Learning patterns from incident resolution');

    try {
      const prompt = LEARN_PATTERN_PROMPT.build({
        incident: request.incident,
        resolution: request.resolution,
        existingPatterns: request.existingPatterns ?? '',
      });

      const response = await this.generateWithRetry({
        model: this.getModelForTask('patternLearning'),
        temperature: this.getTemperatureForTask('patternLearning'),
        thinkingBudget: THINKING_BUDGETS.MEDIUM,
        systemInstruction: LEARN_PATTERN_PROMPT.system,
        responseFormat: 'json',
        responseSchema: PATTERN_LEARNING_SCHEMA,
      }, prompt);

      const parsed = this.parseJsonResponse<PatternLearningGeminiResponse>(response);

      return {
        success: true,
        data: parsed.data,
        usage: response.usage,
        thoughtSignature: response.thoughtSignature,
      };
    } catch (error) {
      return this.handleError<PatternLearningGeminiResponse>(error);
    }
  }

  // ===========================================
  // Code Evolution Methods
  // ===========================================

  /**
   * Analyze an evolution request to determine impact
   * Returns affected files, impact level, risks
   */
  async analyzeEvolutionRequest(request: {
    prompt: string;
    scope?: string[];
    existingFiles: Array<{ path: string; language: string; purpose: string; content: string }>;
  }): Promise<GeminiResponse<{
    summary: string;
    affectedFiles: string[];
    impactLevel: 'low' | 'medium' | 'high';
    risks: string[];
    recommendations: string[];
  }>> {
    this.logger.info({ prompt: request.prompt.substring(0, 100) }, 'Analyzing evolution request');

    try {
      const prompt = `Analyze this code evolution request and determine its impact.

## Evolution Request
${request.prompt}

${request.scope ? `## Specified Scope (files to modify)\n${request.scope.join('\n')}` : '## Scope: AI determines affected files'}

## Existing Codebase
${request.existingFiles.map(f => `### ${f.path} (${f.language})
Purpose: ${f.purpose}
\`\`\`${f.language}
${f.content}
\`\`\`
`).join('\n')}

Analyze this request and provide:
1. A summary of what changes are needed
2. Which files will be affected (file paths from the existing codebase or new files to create)
3. Impact level (low: cosmetic/docs, medium: behavior changes, high: structural/breaking changes)
4. Potential risks of this evolution
5. Recommendations for safe implementation`;

      const schema = {
        type: 'object' as const,
        properties: {
          summary: { type: 'string' as const, description: 'Summary of the evolution' },
          affectedFiles: { 
            type: 'array' as const, 
            items: { type: 'string' as const },
            description: 'File paths that will be affected' 
          },
          impactLevel: { 
            type: 'string' as const, 
            enum: ['low', 'medium', 'high'] as string[],
            description: 'Impact level of the evolution' 
          },
          risks: { 
            type: 'array' as const, 
            items: { type: 'string' as const },
            description: 'Potential risks' 
          },
          recommendations: { 
            type: 'array' as const, 
            items: { type: 'string' as const },
            description: 'Recommendations for safe implementation' 
          },
        },
        required: ['summary', 'affectedFiles', 'impactLevel', 'risks', 'recommendations'] as string[],
      };

      const response = await this.generateWithRetry({
        model: this.config.model,
        maxOutputTokens: 65536, // Ensure enough tokens for complete analysis
        thinkingBudget: THINKING_BUDGETS.HIGH,
        systemInstruction: 'You are a code evolution analyst. Analyze the requested changes and provide accurate impact assessment.',
        responseFormat: 'json',
        responseSchema: schema,
      }, prompt);

      const parsed = this.parseJsonResponse<{
        summary: string;
        affectedFiles: string[];
        impactLevel: 'low' | 'medium' | 'high';
        risks: string[];
        recommendations: string[];
      }>(response);

      return {
        success: true,
        data: parsed.data,
        usage: response.usage,
        thoughtSignature: response.thoughtSignature,
      };
    } catch (error) {
      return this.handleError<{
        summary: string;
        affectedFiles: string[];
        impactLevel: 'low' | 'medium' | 'high';
        risks: string[];
        recommendations: string[];
      }>(error);
    }
  }

  /**
   * Generate evolution changes for affected files
   * Returns proposed changes with diffs
   */
  async generateEvolutionChanges(request: {
    prompt: string;
    analysis: {
      summary: string;
      affectedFiles: string[];
      impactLevel: 'low' | 'medium' | 'high';
      risks: string[];
      recommendations: string[];
    };
    filesToModify: Array<{ path: string; language: string; purpose: string; content: string }>;
  }): Promise<GeminiResponse<Array<{
    filePath: string;
    changeType: 'create' | 'modify' | 'delete';
    oldContent?: string;
    newContent?: string;
    diff?: string;
    description: string;
  }>>> {
    // Calculate content sizes for logging
    const totalContentSize = request.filesToModify.reduce((sum, f) => sum + f.content.length, 0);
    const fileSizes = request.filesToModify.map(f => ({ path: f.path, size: f.content.length }));
    
    this.logger.info({ 
      filesCount: request.filesToModify.length,
      totalContentSize,
      fileSizes,
      model: this.config.proModel,
    }, 'Generating evolution changes');

    try {
      // Gemini 3 has a 1M token context window (~4MB of text)
      // Increased limits to leverage full context capacity for finding and fixing ANY bug
      const MAX_FILE_SIZE = 500000;    // 500KB per file (was 100KB)
      const MAX_TOTAL_SIZE = 2000000;  // 2MB total (was 500KB) - ~500K tokens

      let processedFiles = request.filesToModify;
      const truncated = totalContentSize > MAX_TOTAL_SIZE;

      // Log file sizes being sent to Gemini for debugging
      this.logger.info({
        filesCount: request.filesToModify.length,
        totalContentSize,
        maxFileSize: MAX_FILE_SIZE,
        maxTotalSize: MAX_TOTAL_SIZE,
        truncated,
        fileSizes: request.filesToModify.map(f => ({
          path: f.path,
          size: f.content.length,
          wouldTruncate: f.content.length > MAX_FILE_SIZE
        })),
      }, 'Preparing files for evolution generation');

      if (truncated) {
        this.logger.warn({ totalContentSize, maxSize: MAX_TOTAL_SIZE }, 'Content exceeds 2MB limit, truncating files');
        processedFiles = request.filesToModify.map(f => ({
          ...f,
          content: f.content.length > MAX_FILE_SIZE
            ? f.content.substring(0, MAX_FILE_SIZE) + '\n... (truncated)'
            : f.content
        }));
      }

      const prompt = `Generate code changes for this evolution request.

## Evolution Request
${request.prompt}

## Analysis Summary
${request.analysis.summary}
Impact Level: ${request.analysis.impactLevel}
Risks: ${request.analysis.risks.join(', ')}
Recommendations: ${request.analysis.recommendations.join(', ')}

## Files to Modify
${processedFiles.map(f => `### ${f.path} (${f.language})
Purpose: ${f.purpose}
\`\`\`${f.language}
${f.content}
\`\`\`
`).join('\n')}

## BUG DETECTION INSTRUCTIONS
BEFORE generating changes, carefully search the code above for ALL of these patterns:

1. **Random error injection (MOST COMMON)**: Look for ANY code that uses Math.random() to conditionally throw errors or return error responses:
   - \`if (Math.random() < X) throw ...\` (where X is any number like 0.25, 0.1, 0.5)
   - \`if (Math.random() < X) return res.status(500)...\`
   - \`if (Math.random() < X) { throw new Error(...) }\`
   - Variables set from Math.random() that later trigger errors

2. **Error injection patterns**: Look for throw statements with suspicious messages like "deliberate", "testing", "intentional", "fake", "simulated", "Internal Server Error", "Server Error"

3. **Chaos/fault injection middleware**: Look for middleware or interceptors that inject errors based on config:
   - \`chaosConfig.errorRate\`
   - \`faultInjection\`
   - Variables named \`errorRate\`, \`failureRate\`, etc.

4. **Debug flags**: Look for conditionals like \`if (true)\`, \`if (DEBUG)\`, \`if (FLAKY)\` that throw errors

5. **Route-specific bugs**: Check if specific routes/endpoints (especially GET endpoints) have error-throwing code inside their handlers

IMPORTANT: If the Evolution Request mentions a specific error rate (like "25%", "10%", etc.), search for that number (0.25, 0.1) in Math.random() comparisons and REMOVE all such code.

Search EVERY function and handler in the file for these patterns. Remove ALL instances, not just the first one you find.

## Output Requirements
Generate the specific changes needed for each affected file. For each file, provide:
1. The file path (MUST MATCH EXACTLY the path from "Files to Modify" section above)
2. Change type (create, modify, or delete)
3. For modifications: the COMPLETE new content in the "newContent" field
4. A brief description of the change (mention what bug pattern you removed)

CRITICAL REQUIREMENTS:
- For every "create" or "modify" change, you MUST include the complete "newContent" field with the FULL file contents
- Never omit, truncate, or abbreviate the newContent field
- The newContent must contain the entire working file, not just the changed parts
- Provide complete file contents, not patches or partial code
- Actually FIX the bug - don't just describe it, REMOVE the offending code
- The filePath in your response MUST exactly match one of the paths shown in "Files to Modify"
- When removing error injection code, ensure you remove the ENTIRE if-block, not just parts of it
- After your fix, the code should have ZERO intentional error injection - all requests should succeed normally`;

      const schema = {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            filePath: { type: 'string' as const, description: 'Path to the file' },
            changeType: { 
              type: 'string' as const, 
              enum: ['create', 'modify', 'delete'] as string[],
              description: 'Type of change' 
            },
            oldContent: { type: 'string' as const, description: 'Original content (for modify/delete)' },
            newContent: { type: 'string' as const, description: 'New content (for create/modify)' },
            diff: { type: 'string' as const, description: 'Unified diff of changes' },
            description: { type: 'string' as const, description: 'Description of the change' },
          },
          required: ['filePath', 'changeType', 'description', 'newContent'] as string[],
        },
      };

      const response = await this.generateWithRetry({
        model: this.config.model,
        maxOutputTokens: 65536, // Ensure enough tokens for complete file contents
        thinkingBudget: THINKING_BUDGETS.MEDIUM,
        systemInstruction: 'You are a code evolution generator. Generate complete, production-quality code changes. CRITICAL: Every create or modify change MUST include the complete newContent field with FULL file contents. Never omit or truncate newContent.',
        responseFormat: 'json',
        responseSchema: schema,
      }, prompt);

      const parsed = this.parseJsonResponse<Array<{
        filePath: string;
        changeType: 'create' | 'modify' | 'delete';
        oldContent?: string;
        newContent?: string;
        diff?: string;
        description: string;
      }>>(response);

      // Validate that all create/modify changes have newContent
      if (parsed.data) {
        for (const change of parsed.data) {
          if ((change.changeType === 'create' || change.changeType === 'modify') &&
              (!change.newContent || change.newContent.length === 0)) {
            this.logger.error({
              filePath: change.filePath,
              changeType: change.changeType,
              hasNewContent: !!change.newContent,
              newContentLength: change.newContent?.length || 0,
              description: change.description?.substring(0, 100),
            }, 'CRITICAL: Gemini returned change without newContent - response may have been truncated');

            return {
              success: false,
              error: `Missing newContent for ${change.changeType} change on ${change.filePath}. The AI response may have been truncated. Try reducing the number of files or simplifying the request.`,
            };
          }
        }
      }

      return {
        success: true,
        data: parsed.data,
        usage: response.usage,
        thoughtSignature: response.thoughtSignature,
      };
    } catch (error) {
      return this.handleError<Array<{
        filePath: string;
        changeType: 'create' | 'modify' | 'delete';
        oldContent?: string;
        newContent?: string;
        diff?: string;
        description: string;
      }>>(error);
    }
  }

  // ===========================================
  // Private Helper Methods
  // ===========================================

  /**
   * Estimate token count for a full context request
   *
   * Uses rough approximation of 4 characters per token.
   * This helps monitor context window usage.
   */
  private estimateTokenCount(request: FullContextAnalysisRequest): number {
    let totalChars = 0;

    // Evidence
    totalChars += JSON.stringify(request.evidence).length;

    // Full logs (typically the largest component)
    if (request.fullLogs) {
      totalChars += request.fullLogs.length;
    }

    // Historical incidents
    if (request.historicalIncidents) {
      totalChars += JSON.stringify(request.historicalIncidents).length;
    }

    // Kubernetes context
    if (request.kubernetesContext) {
      totalChars += JSON.stringify(request.kubernetesContext).length;
    }

    // Add overhead for prompt template and formatting (~5000 chars)
    totalChars += 5000;

    // Rough token estimate: 4 chars per token
    return Math.ceil(totalChars / 4);
  }

  /**
   * Estimate token count for code generation requests
   * Used to warn about large requests that may hit context limits
   */
  private estimateCodeGenTokenCount(request: CodeGenerationGeminiRequest): number {
    let totalChars = 0;

    // Requirement description
    totalChars += request.requirement.length;

    // Component specification (can be large for complex components)
    if (request.component) {
      totalChars += request.component.length;
    }

    // Architecture context (JSON stringified, can be substantial)
    if (request.architecture) {
      totalChars += request.architecture.length;
    }

    // Project context
    totalChars += request.context.length;

    // Existing code patterns
    if (request.existingCode) {
      totalChars += request.existingCode.length;
    }

    // Constraints
    if (request.constraints) {
      totalChars += request.constraints.join(' ').length;
    }

    // Add overhead for prompt template and system instructions (~3000 chars)
    totalChars += 3000;

    // Rough token estimate: 4 chars per token
    return Math.ceil(totalChars / 4);
  }

  /**
   * Generate content with retry logic
   *
   * Supports Gemini 3's thinking features:
   * - thinkingBudget: Token budget for reasoning (Gemini 2.5 style)
   * - includeThoughts: Always enabled to extract thought signatures
   * - thoughtSignature: Previous reasoning state for multi-step coherence
   *
   * Includes OpenTelemetry tracing for production observability.
   *
   * @see https://ai.google.dev/gemini-api/docs/thinking
   */
  private async generateWithRetry(
    options: GenerateOptions,
    contents: GeminiContents
  ): Promise<{
    text: string;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      thinkingTokens?: number;
      totalTokens: number;
    };
    thoughtSignature?: string;
    thoughtContent?: string;
  }> {
    const modelToUse = options.model ?? this.config.model;
    
    return tracer.startActiveSpan('gemini.generate', async (span) => {
      // Record initial attributes
      this.recordSpanAttributes(span, options, modelToUse);
      span.setAttribute('gemini.max_retries', this.config.maxRetries);
      
      let lastError: Error | null = null;

      for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
        const attemptStart = Date.now();
        span.setAttribute('gemini.current_attempt', attempt + 1);
        
        try {
          // Build config with thinkingConfig for Gemini 3 models
          const config: Record<string, unknown> = {
            systemInstruction: options.systemInstruction,
            temperature: options.temperature ?? this.config.defaultTemperature,
            responseMimeType: options.responseFormat === 'json'
              ? 'application/json'
              : 'text/plain',
          };

          // Set maxOutputTokens if provided
          if (options.maxOutputTokens) {
            config.maxOutputTokens = options.maxOutputTokens;
          }

          // Add JSON schema validation for guaranteed structured output
          // This ensures Gemini returns exactly the structure we expect
          if (options.responseSchema && options.responseFormat === 'json') {
            config.responseSchema = options.responseSchema;
            this.logger.debug('Using responseSchema for structured output validation');
          }

          // Enable thinking for models that support it
          // Check model capability before adding thinkingConfig
          // IMPORTANT: Gemini 3 uses thinkingLevel, Gemini 2.5 uses thinkingBudget
          if (options.thinkingBudget && supportsThinking(modelToUse)) {
            if (isGemini3Model(modelToUse)) {
              // Gemini 3 models use thinkingLevel (discrete levels)
              const isFlash = modelToUse.includes('flash');
              const thinkingLevel = budgetToThinkingLevel(options.thinkingBudget, isFlash);
              config.thinkingConfig = {
                thinkingLevel,
                includeThoughts: true, // Required for thought signature extraction
              };
              span.setAttribute('gemini.thinking_enabled', true);
              span.setAttribute('gemini.thinking_level', thinkingLevel);
              this.logger.info({
                model: modelToUse,
                thinkingLevel,
                originalBudget: options.thinkingBudget,
              }, 'Gemini 3 thinking enabled with thinkingLevel');
            } else {
              // Gemini 2.5 and earlier models use thinkingBudget (token count)
              config.thinkingConfig = {
                thinkingBudget: options.thinkingBudget,
                includeThoughts: true, // Required for thought signature extraction
              };
              span.setAttribute('gemini.thinking_enabled', true);
              span.setAttribute('gemini.thinking_budget', options.thinkingBudget);
              this.logger.debug({
                model: modelToUse,
                thinkingBudget: options.thinkingBudget,
              }, 'Gemini 2.5 thinking enabled with thinkingBudget');
            }
          } else if (options.thinkingBudget) {
            span.setAttribute('gemini.thinking_enabled', false);
            this.logger.debug({ model: modelToUse }, 'Skipping thinkingConfig - model does not support thinking');
          }

          // Build contents with thought signature context if available
          // This enables reasoning continuity across multi-step investigations
          const enrichedContents = this.enrichContentsWithThoughtContext(
            contents,
            options.thoughtSignature
          );

          this.logger.debug({
            attempt,
            model: modelToUse,
            sdkVersion: GENAI_SDK_VERSION,
            thinkingEnabled: supportsThinking(modelToUse),
          }, 'Starting Gemini API call');

          const response = await this.client.models.generateContent({
            model: options.model ?? this.config.model,
            contents: enrichedContents,
            config,
          });

          const duration = Date.now() - attemptStart;
          span.setAttribute('gemini.duration_ms', duration);
          span.setAttribute('gemini.attempts_used', attempt + 1);
          this.logger.info({ attempt, durationMs: duration }, 'Gemini API call completed');

          // Debug: Log response structure to understand thought extraction (INFO level for visibility)
          const rawResponse = response as unknown as Record<string, unknown>;
          const candidates = rawResponse.candidates as Array<{
            content?: { parts?: unknown[] };
            finishReason?: string;
          }> | undefined;
          const firstCandidate = candidates?.[0];
          const parts = firstCandidate?.content?.parts;
          const finishReason = firstCandidate?.finishReason;

          this.logger.info({
            hasText: !!response.text,
            hasCandidates: !!rawResponse.candidates,
            candidateCount: Array.isArray(rawResponse.candidates) ? rawResponse.candidates.length : 0,
            responseKeys: Object.keys(rawResponse).slice(0, 20),
            thoughtsTokenCount: response.usageMetadata?.thoughtsTokenCount ?? 0,
            // Additional debug info for Gemini 3 thought extraction
            partsCount: Array.isArray(parts) ? parts.length : 0,
            candidateKeys: firstCandidate ? Object.keys(firstCandidate) : [],
            contentKeys: firstCandidate?.content ? Object.keys(firstCandidate.content) : [],
            // CRITICAL: Log finishReason to detect truncation
            finishReason,
            maxOutputTokensRequested: options.maxOutputTokens ?? 'default',
          }, 'Gemini response structure for thought extraction');

          // Warn if response was truncated due to token limit
          if (finishReason === 'MAX_TOKENS') {
            this.logger.warn({
              finishReason,
              maxOutputTokens: options.maxOutputTokens,
              completionTokens: response.usageMetadata?.candidatesTokenCount,
              thinkingTokens: response.usageMetadata?.thoughtsTokenCount,
            }, 'Response truncated due to MAX_TOKENS - output may be incomplete');
          }

          // Extract response text and metadata
          const text = response.text ?? '';
          const usage = response.usageMetadata
            ? {
                promptTokens: response.usageMetadata.promptTokenCount ?? 0,
                completionTokens: response.usageMetadata.candidatesTokenCount ?? 0,
                thinkingTokens: response.usageMetadata.thoughtsTokenCount,
                totalTokens: response.usageMetadata.totalTokenCount ?? 0,
              }
            : undefined;

          // Record usage metrics on span
          this.recordUsageMetrics(span, usage);

          // Extract thought signature and content for state continuity
          const thoughtSignature = this.extractThoughtSignature(response);
          const thoughtContent = this.extractThoughtContent(response);

          // Always log thought signature status for debugging
          span.setAttribute('gemini.has_thought_signature', !!thoughtSignature);
          this.logger.info({
            thinkingTokens: usage?.thinkingTokens,
            hasThoughtSignature: !!thoughtSignature,
            thoughtContentLength: thoughtContent?.length ?? 0,
            usingJsonSchema: !!options.responseSchema,
          }, thoughtSignature
            ? 'Thought signature extracted successfully'
            : 'No thought signature in response (may be expected with JSON schema)');

          span.setStatus({ code: SpanStatusCode.OK });
          span.end();

          // Record successful API call time for dynamic delay calculation
          this.recordApiCallTime();

          return { text, usage, thoughtSignature, thoughtContent };
        } catch (error) {
          const duration = Date.now() - attemptStart;
          lastError = error as Error;
          const errorMessage = (error as Error).message;
          const errorName = (error as Error).name;
          const errorStack = (error as Error).stack;

          // Check if it's a 499 CANCELLED error (Google cancelled the request)
          const isCancelledError = errorMessage.includes('499') || errorMessage.includes('CANCELLED');

          span.setAttribute('gemini.error', errorMessage.substring(0, 500));
          span.setAttribute('gemini.error_type', errorName);

          this.logger.error({
            attempt,
            durationMs: duration,
            errorName,
            errorMessage: errorMessage.substring(0, 500),
            stack: errorStack?.substring(0, 300),
            isCancelledError,
          }, 'Gemini API call failed');

          if (this.isRateLimitError(error)) {
            // Rate limits: Respect Retry-After header if present, else use progressive backoff
            span.setAttribute('gemini.rate_limited', true);
            const retryAfter = this.extractRetryAfter(error);
            // Use the larger of Retry-After or progressive delay
            const progressiveDelay = this.calculateProgressiveDelay(attempt);
            const finalDelay = Math.max(retryAfter, progressiveDelay);
            this.logger.warn({
              attempt,
              retryAfterMs: retryAfter,
              progressiveDelayMs: progressiveDelay,
              finalDelayMs: finalDelay,
              delayMinutes: (finalDelay / 60000).toFixed(1),
              durationMs: duration,
            }, 'Rate limited, retrying with progressive backoff');
            await this.delayWithJitter(finalDelay);
          } else if (this.isTimeoutError(error)) {
            // Timeout errors: Use progressive backoff for recovery
            span.setAttribute('gemini.timeout_error', true);
            const retryDelay = this.calculateProgressiveDelay(attempt);
            this.logger.warn({
              attempt,
              durationMs: duration,
              retryDelayMs: retryDelay,
              delayMinutes: (retryDelay / 60000).toFixed(1),
              errorName,
            }, 'Request timed out, retrying with progressive backoff');
            await this.delayWithJitter(retryDelay);
          } else if (isCancelledError) {
            // 499 CANCELLED: Request was too complex or timed out on Google's side
            // Use progressive backoff for these cases
            span.setAttribute('gemini.server_cancelled', true);
            const retryDelay = this.calculateProgressiveDelay(attempt);
            this.logger.warn({
              attempt,
              durationMs: duration,
              retryDelayMs: retryDelay,
              delayMinutes: (retryDelay / 60000).toFixed(1),
            }, 'Request cancelled by server, retrying with progressive backoff');
            await this.delayWithJitter(retryDelay);
          } else if (attempt < this.config.maxRetries - 1) {
            // Generic API errors: Use progressive backoff
            const retryDelay = this.calculateProgressiveDelay(attempt);
            this.logger.warn({
              attempt,
              error: errorMessage,
              durationMs: duration,
              retryDelayMs: retryDelay,
              delayMinutes: (retryDelay / 60000).toFixed(1),
            }, 'API error, retrying with progressive backoff');
            await this.delayWithJitter(retryDelay);
          }
        }
      }

      span.setAttribute('gemini.retries_exhausted', true);
      span.setStatus({ code: SpanStatusCode.ERROR, message: lastError?.message });
      span.end();
      this.logger.error({ lastError: lastError?.message }, 'All retries exhausted');
      throw lastError ?? new Error('Max retries exceeded');
    });
  }

  /**
   * Enrich contents with previous thought context for reasoning continuity
   *
   * When a thought signature from a previous call is provided, we decode it
   * and inject a summary as context. This enables Gemini 3 to maintain
   * coherent reasoning across the OODA loop phases.
   */
  private enrichContentsWithThoughtContext(
    contents: GeminiContents,
    thoughtSignature?: string
  ): GeminiContents {
    if (!thoughtSignature) {
      return contents;
    }

    try {
      // Decode the thought signature to get previous reasoning context
      const previousThought = Buffer.from(thoughtSignature, 'base64').toString('utf-8');

      // Create context prefix with previous reasoning
      const contextPrefix = `[PREVIOUS REASONING CONTEXT]
The following is a summary of reasoning from the previous analysis step in this investigation:

${previousThought}

[END PREVIOUS CONTEXT]

Continue the investigation, building on the above reasoning:

`;

      // Handle string contents
      if (typeof contents === 'string') {
        return contextPrefix + contents;
      }

      // Handle array contents (multimodal)
      if (Array.isArray(contents)) {
        return [
          { text: contextPrefix },
          ...contents,
        ];
      }

      return contents;
    } catch (error) {
      this.logger.warn({ error: (error as Error).message }, 'Failed to decode thought signature');
      return contents;
    }
  }

  /**
   * Build multimodal content for frame analysis
   *
   * Leverages Gemini 3's spatial-temporal video understanding by:
   * 1. Providing explicit temporal context (duration, frame count)
   * 2. Showing time deltas between consecutive frames
   * 3. Requesting analysis of changes over time
   * 4. Identifying when issues began (onset detection)
   *
   * @see https://ai.google.dev/gemini-api/docs/vision
   */
  private buildFrameAnalysisContent(request: FrameAnalysisRequest): ContentPart[] {
    const parts: ContentPart[] = [];
    const frames = request.frames;
    const frameCount = frames.length;

    // Add temporal context upfront for multi-frame analysis
    if (frameCount > 1) {
      const firstFrame = frames[0];
      const lastFrame = frames[frameCount - 1];
      if (firstFrame && lastFrame) {
        const durationMs = lastFrame.timestamp.getTime() - firstFrame.timestamp.getTime();
        const durationSeconds = Math.round(durationMs / 1000);

        parts.push({
          text: `=== TEMPORAL ANALYSIS REQUEST ===

Analyzing ${frameCount} dashboard frames captured over ${durationSeconds} seconds.

TEMPORAL ANALYSIS FOCUS:
1. Changes between consecutive frames - what is getting better/worse?
2. Trend direction - are metrics increasing, decreasing, or volatile?
3. Anomaly onset timing - when exactly did the issue begin?
4. Correlation timing - do multiple metrics change together?

Investigation context: ${request.context ?? 'Incident investigation - identify root cause'}

Frames are provided in CHRONOLOGICAL ORDER. Pay attention to the time deltas between frames.

=== FRAMES BEGIN ===`,
        });
      }
    } else {
      // Single frame analysis
      parts.push({
        text: FRAME_ANALYSIS_PROMPT.build({ context: request.context ?? '' }),
      });
    }

    // Add each frame with temporal metadata
    for (let i = 0; i < frameCount; i++) {
      const frame = frames[i];
      if (!frame) continue;

      const base64Data = typeof frame.data === 'string'
        ? frame.data
        : frame.data.toString('base64');

      // Calculate time delta from previous frame
      let timeDeltaText: string;
      if (i === 0) {
        timeDeltaText = '(baseline frame)';
      } else {
        const prevFrame = frames[i - 1];
        if (prevFrame) {
          const deltaMs = frame.timestamp.getTime() - prevFrame.timestamp.getTime();
          const deltaSeconds = Math.round(deltaMs / 1000);
          timeDeltaText = `(+${deltaSeconds}s from previous frame)`;
        } else {
          timeDeltaText = '';
        }
      }

      // Frame header with position and timing
      parts.push({
        text: `
--- Frame ${i + 1}/${frameCount} ${timeDeltaText} ---
Timestamp: ${frame.timestamp.toISOString()}`,
      });

      // The actual frame image
      parts.push({
        inlineData: {
          mimeType: frame.mimeType ?? 'image/png',
          data: base64Data,
        },
      });

      // Add comparison prompt for subsequent frames
      if (i > 0) {
        parts.push({
          text: `↑ Compare with previous frame: What changed? Any new anomalies?`,
        });
      }
    }

    // Final analysis instruction
    if (frameCount > 1) {
      parts.push({
        text: `
=== FRAMES END ===

TEMPORAL ANALYSIS REQUIRED:
1. Identify the FIRST frame where anomalies appeared
2. Track how metrics evolved across frames
3. Determine if the situation is improving or deteriorating
4. Correlate timing of different metric changes

Provide your analysis in the specified JSON format, noting temporal patterns.`,
      });
    }

    return parts;
  }

  /**
   * Strip frame images from evidence metadata to avoid exceeding token limits.
   * Frame images are stored for UI display purposes, not for re-analysis by AI.
   */
  private stripFrameImagesFromMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    const sanitized = { ...metadata };
    // Remove large base64 image data
    delete sanitized.frameImage;
    // Keep other metadata like frameMimeType, frameTimestamp, analysisText, etc.
    return sanitized;
  }

  /**
   * Extract JSON from a potentially contaminated response
   * Handles markdown code blocks, surrounding text, and code contamination
   */
  private extractJsonFromResponse(text: string): string {
    // First, try to parse as-is (response is already clean JSON)
    const trimmed = text.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return trimmed;
    }

    // Try to extract from markdown code block
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch && codeBlockMatch[1]) {
      const extracted = codeBlockMatch[1].trim();
      if (extracted.startsWith('{')) {
        return extracted;
      }
    }

    // Try to find JSON object with "openapi" key (for OpenAPI specs)
    const openapiMatch = text.match(/\{[\s\S]*?"openapi"\s*:\s*"3\.[^"]*"[\s\S]*\}/);
    if (openapiMatch) {
      // Validate it's actually parseable JSON
      try {
        JSON.parse(openapiMatch[0]);
        return openapiMatch[0];
      } catch {
        // Continue to next extraction method
      }
    }

    // Try to find any JSON object starting from the first {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const potential = text.substring(firstBrace, lastBrace + 1);
      try {
        JSON.parse(potential);
        return potential;
      } catch {
        // Fall through to return original
      }
    }

    // Return original if no extraction worked
    return text;
  }

  /**
   * Parse JSON response with validation
   */
  private parseJsonResponse<T>(response: { text: string }): { data?: T } {
    try {
      const data = JSON.parse(response.text) as T;
      return { data };
    } catch (error) {
      this.logger.error('Failed to parse JSON response', error as Error);
      throw new GeminiError('Invalid JSON response from Gemini', 'INVALID_JSON', {
        response: response.text.substring(0, 500),
      });
    }
  }

  /**
   * Extract thought signature from response
   *
   * Gemini 3 returns thought content in candidates[0].content.parts where
   * parts with `thought: true` contain the model's reasoning process.
   * We create a signature by hashing the thought content for state continuity.
   *
   * @see https://ai.google.dev/gemini-api/docs/thinking
   */
  private extractThoughtSignature(response: unknown): string | undefined {
    try {
      const resp = response as {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              text?: string;
              thought?: boolean;
              // Gemini 3 returns thoughtSignature directly on parts
              thoughtSignature?: string;
            }>;
          };
        }>;
        // Gemini 3 may include thought_signature directly in response
        thoughtSignature?: string;
        thought_signature?: string;
      };

      // First, check if Gemini 3 returned a direct thought signature at response level
      if (resp.thoughtSignature) {
        this.logger.debug('Found direct thoughtSignature in response');
        return resp.thoughtSignature;
      }
      if (resp.thought_signature) {
        this.logger.debug('Found direct thought_signature in response');
        return resp.thought_signature;
      }

      // Extract from parts
      const parts = resp.candidates?.[0]?.content?.parts;
      if (!parts || parts.length === 0) {
        this.logger.debug('No parts found in response for thought extraction');
        return undefined;
      }

      // Log part structure for debugging
      const partSummary = parts.map((p, i) => {
        const partKeys = Object.keys(p as object);
        return {
          index: i,
          keys: partKeys,
          hasText: !!p.text,
          textLength: p.text?.length ?? 0,
          thought: p.thought,
          hasThoughtSignature: !!p.thoughtSignature,
        };
      });
      this.logger.debug({ partCount: parts.length, parts: JSON.stringify(partSummary) }, 'Response parts for thought extraction');

      // Gemini 3: Check for thoughtSignature directly on parts (this is the primary path)
      for (const part of parts) {
        if (part.thoughtSignature) {
          this.logger.debug({ signatureLength: part.thoughtSignature.length }, 'Found thoughtSignature on part');
          return part.thoughtSignature;
        }
      }

      // Fallback: Collect all thought parts (thought === true) for older API versions
      const thoughtParts = parts
        .filter((part) => part.thought === true && part.text)
        .map((part) => part.text)
        .join('\n');

      if (!thoughtParts) {
        this.logger.debug('No thought signature or thought parts found');
        return undefined;
      }

      // Create a deterministic signature from thought content
      const signature = this.createThoughtSignature(thoughtParts);
      this.logger.debug({ signatureLength: signature.length }, 'Created thought signature from thought parts');
      return signature;
    } catch (error) {
      this.logger.warn({ error: (error as Error).message }, 'Failed to extract thought signature');
      return undefined;
    }
  }

  /**
   * Create a deterministic signature from thought content
   * This allows us to reference previous reasoning state in follow-up calls
   */
  private createThoughtSignature(thoughtContent: string): string {
    // Use base64 encoding of first 2000 chars to create a reproducible signature
    // This captures the key reasoning points without being too large
    const truncated = thoughtContent.slice(0, 2000);
    return Buffer.from(truncated).toString('base64');
  }

  /**
   * Extract full thought content for debugging/logging
   */
  private extractThoughtContent(response: unknown): string | undefined {
    try {
      const resp = response as {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              text?: string;
              thought?: boolean;
            }>;
          };
        }>;
      };

      const parts = resp.candidates?.[0]?.content?.parts;
      if (!parts) return undefined;

      return parts
        .filter((part) => part.thought === true && part.text)
        .map((part) => part.text)
        .join('\n');
    } catch {
      return undefined;
    }
  }

  /**
   * Handle API errors
   */
  private handleError<T>(error: unknown): GeminiResponse<T> {
    const err = error as Error;

    if (this.isRateLimitError(error)) {
      this.logger.error('Rate limit exceeded', err);
      return {
        success: false,
        error: 'Rate limit exceeded. Please try again later.',
      };
    }

    this.logger.error('Gemini API error', err);
    return {
      success: false,
      error: err.message,
    };
  }

  /**
   * Check if error is a rate limit error
   */
  private isRateLimitError(error: unknown): boolean {
    const err = error as { status?: number; code?: string; message?: string };
    return err.status === 429 || err.code === 'RATE_LIMIT_EXCEEDED';
  }

  /**
   * Check if error is a timeout error
   * Handles various timeout error patterns from fetch, AbortController, and Gemini API
   */
  private isTimeoutError(error: unknown): boolean {
    const err = error as { name?: string; code?: string; message?: string };

    // AbortError from AbortController timeout
    if (err.name === 'AbortError') return true;

    // TimeoutError (modern browsers)
    if (err.name === 'TimeoutError') return true;

    // ECONNABORTED from HTTP clients
    if (err.code === 'ECONNABORTED') return true;

    // Check message for timeout keywords
    const message = err.message?.toLowerCase() ?? '';
    return (
      message.includes('timeout') ||
      message.includes('timed out') ||
      message.includes('etimedout') ||
      message.includes('socket hang up')
    );
  }

  /**
   * Extract retry-after delay from rate limit error
   *
   * Handles various error formats from the Gemini API:
   * - Direct retryAfter property
   * - HTTP headers (retry-after)
   * - Error message parsing
   */
  private extractRetryAfter(error: unknown): number {
    const err = error as {
      retryAfter?: number;
      headers?: Record<string, string>;
      message?: string;
      status?: number;
    };

    // Check for explicit retryAfter (in seconds, convert to ms)
    if (typeof err.retryAfter === 'number') {
      return err.retryAfter * 1000;
    }

    // Check headers (common HTTP pattern)
    const headerValue = err.headers?.['retry-after'] ?? err.headers?.['Retry-After'];
    if (headerValue) {
      const seconds = parseInt(headerValue, 10);
      if (!isNaN(seconds)) {
        return seconds * 1000;
      }
    }

    // Parse from error message if present (e.g., "retry after 60 seconds")
    if (err.message) {
      const match = err.message.match(/retry\s+(?:after\s+)?(\d+)/i);
      if (match?.[1]) {
        return parseInt(match[1], 10) * 1000;
      }
    }

    // Default: Use progressive backoff initial delay
    // This ensures rate limits without Retry-After still benefit from the backoff strategy
    const backoff = this.getProgressiveBackoffConfig();
    return backoff.enabled ? backoff.initialDelayMs : 5000;
  }

  /**
   * Delay execution with minimal additional jitter
   *
   * Adds a small jitter (5%) to handle cases where delays come from
   * Retry-After headers rather than calculateProgressiveDelay().
   * This helps prevent thundering herd when multiple clients get
   * the same Retry-After value.
   *
   * @param delayMs - Base delay in milliseconds
   */
  private delayWithJitter(delayMs: number): Promise<void> {
    // Add small 5% jitter for Retry-After cases
    const jitter = Math.random() * delayMs * 0.05;
    const totalDelay = Math.round(delayMs + jitter);
    return new Promise((resolve) => setTimeout(resolve, totalDelay));
  }
}

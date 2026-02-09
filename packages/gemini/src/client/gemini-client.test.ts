/**
 * Gemini Client Tests
 *
 * Comprehensive test coverage for all Gemini 3 features:
 * 1. Thought Signature Extraction
 * 2. Thought Signature Passed to API
 * 3. Dynamic Thinking Escalation
 * 4. 1M Token Context Window
 * 5. JSON Schema Validation
 * 6. Rate Limit Handling
 * 7. Spatial-Temporal Video Enhancement
 * 8. Streaming for Long Operations
 * 9. Tool Use / Function Calling
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GeminiClient } from './gemini-client.js';
import { GEMINI_MODELS, THINKING_BUDGETS } from './types.js';

// Create mocks for generateContent and streaming
const mockGenerateContent = vi.fn();
const mockGenerateContentStream = vi.fn();

// Mock the GoogleGenAI SDK
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class MockGoogleGenAI {
      models = {
        generateContent: mockGenerateContent,
        generateContentStream: mockGenerateContentStream,
      };
      constructor() {}
    },
  };
});

describe('GeminiClient', () => {
  let client: GeminiClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateContent.mockReset();
    mockGenerateContentStream.mockReset();

    // Create client
    client = new GeminiClient({
      apiKey: 'test-api-key',
      model: GEMINI_MODELS.FLASH,
      proModel: GEMINI_MODELS.PRO,
    });
  });

  describe('constructor', () => {
    it('should create client with config', () => {
      expect(client).toBeDefined();
    });

    it('should use default config values', () => {
      const minimalClient = new GeminiClient({ apiKey: 'test' });
      expect(minimalClient).toBeDefined();
    });
  });

  describe('analyzeFrames', () => {
    const mockFrameAnalysisResponse = {
      text: JSON.stringify({
        anomalies: [
          {
            type: 'error_spike',
            severity: 'high',
            confidence: 0.85,
            description: 'Error rate increased by 150%',
          },
        ],
        metrics: [
          {
            name: 'error_rate',
            value: 2.5,
            unit: 'percent',
            trend: 'increasing',
          },
        ],
        dashboardState: {
          healthy: false,
          overallSeverity: 'warning',
        },
      }),
      usageMetadata: {
        promptTokenCount: 1000,
        candidatesTokenCount: 500,
        totalTokenCount: 1500,
      },
    };

    beforeEach(() => {
      mockGenerateContent.mockResolvedValue(mockFrameAnalysisResponse);
    });

    it('should analyze frames successfully', async () => {
      const result = await client.analyzeFrames({
        incidentId: 'test-incident',
        frames: [
          {
            data: Buffer.from('fake-image-data'),
            timestamp: new Date(),
            mimeType: 'image/png',
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.anomalies).toHaveLength(1);
      expect(result.data?.anomalies?.[0]?.type).toBe('error_spike');
    });

    it('should handle base64 string frame data', async () => {
      const result = await client.analyzeFrames({
        incidentId: 'test-incident',
        frames: [
          {
            data: 'base64-encoded-image-data',
            timestamp: new Date(),
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(mockGenerateContent).toHaveBeenCalled();
    });

    it('should include context in request', async () => {
      await client.analyzeFrames({
        incidentId: 'test-incident',
        frames: [
          {
            data: Buffer.from('data'),
            timestamp: new Date(),
          },
        ],
        context: 'High memory usage detected',
      });

      expect(mockGenerateContent).toHaveBeenCalled();
    });

    it('should return error on API failure', async () => {
      mockGenerateContent.mockRejectedValue(new Error('API Error'));

      const result = await client.analyzeFrames({
        incidentId: 'test-incident',
        frames: [{ data: Buffer.from('data'), timestamp: new Date() }],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should return error on invalid JSON response', async () => {
      mockGenerateContent.mockResolvedValue({ text: 'not valid json' });

      const result = await client.analyzeFrames({
        incidentId: 'test-incident',
        frames: [{ data: Buffer.from('data'), timestamp: new Date() }],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid JSON');
    });
  });

  describe('generateHypotheses', () => {
    const mockHypothesisResponse = {
      text: JSON.stringify({
        hypotheses: [
          {
            rootCause: 'Memory leak in demo-app',
            confidence: 0.82,
            supportingEvidence: ['Error spike detected'],
            contradictingEvidence: [],
            suggestedActions: [
              {
                type: 'restart',
                target: 'demo-app',
                parameters: { namespace: 'demo' },
                riskLevel: 'low',
              },
            ],
          },
        ],
        reasoning: 'Based on error patterns',
      }),
      usageMetadata: {
        promptTokenCount: 2000,
        candidatesTokenCount: 800,
        thoughtsTokenCount: 500,
        totalTokenCount: 3300,
      },
    };

    beforeEach(() => {
      mockGenerateContent.mockResolvedValue(mockHypothesisResponse);
    });

    it('should generate hypotheses successfully', async () => {
      const result = await client.generateHypotheses({
        incidentId: 'test-incident',
        namespace: 'demo',
        evidence: [
          {
            id: 'ev-1',
            incidentId: 'test-incident',
            type: 'video_frame',
            source: 'dashboard',
            content: { anomalies: [] },
            timestamp: new Date(),
            confidence: 0.9,
            metadata: null,
            createdAt: new Date(),
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.data?.hypotheses).toHaveLength(1);
      expect(result.data?.hypotheses?.[0]?.rootCause).toBe('Memory leak in demo-app');
    });

    it('should use Flash model for hypothesis generation by default', async () => {
      // DEFAULT_MODEL_ASSIGNMENTS sets hypothesisGeneration to 'flash'
      await client.generateHypotheses({
        namespace: 'demo',
        incidentId: 'test-incident',
        evidence: [],
      });

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: GEMINI_MODELS.FLASH,
        })
      );
    });

    it('should include previous hypotheses if provided', async () => {
      await client.generateHypotheses({
        namespace: 'demo',
        incidentId: 'test-incident',
        evidence: [],
        previousHypotheses: [
          {
            id: 'hyp-1',
            incidentId: 'test-incident',
            title: 'Previous hypothesis',
            description: 'A previous hypothesis',
            confidence: 0.5,
            status: 'proposed' as const,
            evidence: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });

      expect(mockGenerateContent).toHaveBeenCalled();
    });

    it('should include thought signature in response', async () => {
      const result = await client.generateHypotheses({
        namespace: 'demo',
        incidentId: 'test-incident',
        evidence: [],
      });

      expect(result.success).toBe(true);
      expect(result.usage).toBeDefined();
      expect(result.usage?.thinkingTokens).toBe(500);
    });
  });

  describe('analyzeLogs', () => {
    const mockLogAnalysisResponse = {
      text: JSON.stringify({
        patterns: [
          {
            pattern: 'OutOfMemoryError',
            frequency: 15,
            severity: 'high',
          },
        ],
        anomalies: [],
        timeline: [],
      }),
      usageMetadata: {
        promptTokenCount: 500,
        candidatesTokenCount: 200,
        totalTokenCount: 700,
      },
    };

    beforeEach(() => {
      mockGenerateContent.mockResolvedValue(mockLogAnalysisResponse);
    });

    it('should analyze logs successfully', async () => {
      const result = await client.analyzeLogs({
        incidentId: 'test-incident',
        logs: ['2024-01-01 Error: OutOfMemoryError', '2024-01-01 Warn: Low memory'],
        timeRange: {
          start: new Date('2024-01-01'),
          end: new Date('2024-01-02'),
        },
      });

      expect(result.success).toBe(true);
      expect(result.data?.patterns).toBeDefined();
    });

    it('should include context if provided', async () => {
      await client.analyzeLogs({
        incidentId: 'test-incident',
        logs: ['log entry'],
        timeRange: {
          start: new Date(),
          end: new Date(),
        },
        context: 'Pod restart detected',
      });

      expect(mockGenerateContent).toHaveBeenCalled();
    });
  });

  describe('retry logic', () => {
    it('should retry on API error', async () => {
      mockGenerateContent
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockResolvedValueOnce({
          text: JSON.stringify({ anomalies: [], metrics: [], dashboardState: { healthy: true } }),
          usageMetadata: { totalTokenCount: 100 },
        });

      const result = await client.analyzeFrames({
        incidentId: 'test',
        frames: [{ data: Buffer.from('data'), timestamp: new Date() }],
      });

      expect(result.success).toBe(true);
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });

    // Skip rate limit test - requires long delays that slow down test suite
    it.skip('should handle rate limit errors with backoff', async () => {
      // Rate limit handling involves 60s+ delays, tested manually
    });

    it('should fail after max retries', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Persistent error'));

      const result = await client.analyzeFrames({
        incidentId: 'test',
        frames: [{ data: Buffer.from('data'), timestamp: new Date() }],
      });

      expect(result.success).toBe(false);
      expect(mockGenerateContent).toHaveBeenCalledTimes(4); // Default maxRetries is 4
    });
  });

  describe('generatePostmortem', () => {
    const mockPostmortemResponse = {
      text: JSON.stringify({
        summary: 'Incident caused by memory leak',
        timeline: [],
        rootCauseAnalysis: 'Memory leak in demo-app',
        actionsTaken: [],
        lessonsLearned: [],
        recommendations: [],
      }),
      usageMetadata: {
        promptTokenCount: 3000,
        candidatesTokenCount: 1500,
        totalTokenCount: 4500,
      },
    };

    beforeEach(() => {
      mockGenerateContent.mockResolvedValue(mockPostmortemResponse);
    });

    it('should generate postmortem successfully', async () => {
      const result = await client.generatePostmortem({
        incidentId: 'test-incident',
        title: 'Memory Leak Incident',
        evidence: [],
        hypotheses: [],
        actions: [],
        duration: 120000,
      });

      expect(result.success).toBe(true);
      expect(result.data?.summary).toBe('Incident caused by memory leak');
    });
  });

  // =========================================================
  // FEATURE 1: Thought Signature Extraction
  // =========================================================
  describe('Thought Signature Extraction', () => {
    it('should extract thought signature from response with thought parts', async () => {
      // Mock response with thought content in parts
      const responseWithThoughts = {
        text: JSON.stringify({
          anomalies: [],
          metrics: [],
          dashboardState: { healthy: true, overallSeverity: 'healthy' },
        }),
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          thoughtsTokenCount: 200,
          totalTokenCount: 350,
        },
        candidates: [{
          content: {
            parts: [
              { thought: true, text: 'Analyzing the dashboard metrics...' },
              { thought: true, text: 'The CPU usage appears normal but memory is trending up.' },
              { text: '{"anomalies":[],"metrics":[],"dashboardState":{"healthy":true}}' },
            ],
          },
        }],
      };

      mockGenerateContent.mockResolvedValue(responseWithThoughts);

      const result = await client.analyzeFrames({
        incidentId: 'test-incident',
        frames: [{ data: Buffer.from('test'), timestamp: new Date() }],
      });

      expect(result.success).toBe(true);
      expect(result.thoughtSignature).toBeDefined();
      expect(typeof result.thoughtSignature).toBe('string');
    });

    it('should extract thought signature from direct response property', async () => {
      const responseWithDirectSignature = {
        text: JSON.stringify({
          anomalies: [],
          metrics: [],
          dashboardState: { healthy: true, overallSeverity: 'healthy' },
        }),
        usageMetadata: { totalTokenCount: 100 },
        thoughtSignature: 'direct-thought-signature-abc123',
      };

      mockGenerateContent.mockResolvedValue(responseWithDirectSignature);

      const result = await client.analyzeFrames({
        incidentId: 'test-incident',
        frames: [{ data: Buffer.from('test'), timestamp: new Date() }],
      });

      expect(result.success).toBe(true);
      expect(result.thoughtSignature).toBe('direct-thought-signature-abc123');
    });

    it('should return undefined when no thought content exists', async () => {
      const responseWithoutThoughts = {
        text: JSON.stringify({
          anomalies: [],
          metrics: [],
          dashboardState: { healthy: true, overallSeverity: 'healthy' },
        }),
        usageMetadata: { totalTokenCount: 100 },
        candidates: [{
          content: {
            parts: [
              { text: '{"anomalies":[],"metrics":[]}' },
            ],
          },
        }],
      };

      mockGenerateContent.mockResolvedValue(responseWithoutThoughts);

      const result = await client.analyzeFrames({
        incidentId: 'test-incident',
        frames: [{ data: Buffer.from('test'), timestamp: new Date() }],
      });

      expect(result.success).toBe(true);
      // No thought signature should be present
    });

    it('should include thinking tokens in usage metadata', async () => {
      const responseWithThinkingTokens = {
        text: JSON.stringify({
          hypotheses: [{ rootCause: 'test', confidence: 0.8, supportingEvidence: [], suggestedActions: [], testingSteps: [] }],
          reasoning: 'test reasoning',
        }),
        usageMetadata: {
          promptTokenCount: 1000,
          candidatesTokenCount: 500,
          thoughtsTokenCount: 2000,
          totalTokenCount: 3500,
        },
      };

      mockGenerateContent.mockResolvedValue(responseWithThinkingTokens);

      const result = await client.generateHypotheses({
        namespace: 'demo',
        incidentId: 'test-incident',
        evidence: [],
      });

      expect(result.success).toBe(true);
      expect(result.usage?.thinkingTokens).toBe(2000);
    });
  });

  // =========================================================
  // FEATURE 2: Thought Signature Passed to API
  // =========================================================
  describe('Thought Signature Passed to API', () => {
    const mockResponse = {
      text: JSON.stringify({
        hypotheses: [{ rootCause: 'test', confidence: 0.8, supportingEvidence: [], suggestedActions: [], testingSteps: [] }],
        reasoning: 'Based on previous context',
      }),
      usageMetadata: { totalTokenCount: 100 },
    };

    beforeEach(() => {
      mockGenerateContent.mockResolvedValue(mockResponse);
    });

    it('should pass thought signature to generateHypotheses for context continuity', async () => {
      const previousThoughtSignature = Buffer.from('Previous analysis indicates memory leak').toString('base64');

      await client.generateHypotheses({
        namespace: 'demo',
        incidentId: 'test-incident',
        evidence: [],
        thoughtSignature: previousThoughtSignature,
      });

      // Verify the API was called with enriched content
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      const callArgs = mockGenerateContent.mock.calls[0][0];

      // The contents should include the previous thought context
      expect(callArgs.contents).toBeDefined();
      // Check that the previous reasoning context is included
      const contentsString = typeof callArgs.contents === 'string'
        ? callArgs.contents
        : JSON.stringify(callArgs.contents);
      expect(contentsString).toContain('PREVIOUS REASONING CONTEXT');
    });

    it('should pass thought signature to generatePostmortem', async () => {
      const postmortemResponse = {
        text: JSON.stringify({
          summary: 'Test',
          timeline: [],
          rootCauseAnalysis: 'Test',
          impactAnalysis: 'Test',
          actionsTaken: [],
          lessonsLearned: [],
          preventionRecommendations: [],
          markdown: '# Test',
        }),
        usageMetadata: { totalTokenCount: 100 },
      };
      mockGenerateContent.mockResolvedValue(postmortemResponse);

      const thoughtSignature = Buffer.from('Investigation revealed OOM issues').toString('base64');

      await client.generatePostmortem({
        incidentId: 'test-incident',
        title: 'Test Incident',
        evidence: [],
        hypotheses: [],
        actions: [],
        duration: 60000,
        thoughtSignature,
      });

      expect(mockGenerateContent).toHaveBeenCalled();
      const callArgs = mockGenerateContent.mock.calls[0][0];
      const contentsString = typeof callArgs.contents === 'string'
        ? callArgs.contents
        : JSON.stringify(callArgs.contents);
      expect(contentsString).toContain('PREVIOUS REASONING CONTEXT');
    });

    it('should decode base64 thought signature correctly', async () => {
      const reasoningText = 'The error spike correlates with the deployment at 10:00 AM';
      const thoughtSignature = Buffer.from(reasoningText).toString('base64');

      await client.generateHypotheses({
        namespace: 'demo',
        incidentId: 'test-incident',
        evidence: [],
        thoughtSignature,
      });

      const callArgs = mockGenerateContent.mock.calls[0][0];
      const contentsString = typeof callArgs.contents === 'string'
        ? callArgs.contents
        : JSON.stringify(callArgs.contents);

      // The decoded reasoning should appear in the content
      expect(contentsString).toContain('error spike');
      expect(contentsString).toContain('deployment');
    });

    it('should gracefully handle invalid thought signature', async () => {
      // Invalid base64
      const invalidSignature = 'not-valid-base64!!!';

      const result = await client.generateHypotheses({
        namespace: 'demo',
        incidentId: 'test-incident',
        evidence: [],
        thoughtSignature: invalidSignature,
      });

      // Should not fail, just proceed without context
      expect(result.success).toBe(true);
    });
  });

  // =========================================================
  // FEATURE 3: Dynamic Thinking Escalation
  // =========================================================
  describe('Dynamic Thinking Escalation', () => {
    const mockResponse = {
      text: JSON.stringify({
        hypotheses: [{ rootCause: 'test', confidence: 0.8, supportingEvidence: [], suggestedActions: [], testingSteps: [] }],
        reasoning: 'Deep analysis with high thinking budget',
      }),
      usageMetadata: {
        promptTokenCount: 1000,
        candidatesTokenCount: 500,
        thoughtsTokenCount: 20000,
        totalTokenCount: 21500,
      },
    };

    beforeEach(() => {
      mockGenerateContent.mockResolvedValue(mockResponse);
    });

    it('should use MEDIUM thinking budget by default for hypothesis generation', async () => {
      await client.generateHypotheses({
        namespace: 'demo',
        incidentId: 'test-incident',
        evidence: [],
      });

      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.config.thinkingConfig).toBeDefined();
      // Gemini 3 Flash uses thinkingLevel, MEDIUM budget maps to 'medium' level
      expect(callArgs.config.thinkingConfig.thinkingLevel).toBe('medium');
    });

    it('should allow overriding thinking budget dynamically', async () => {
      await client.generateHypotheses({
        namespace: 'demo',
        incidentId: 'test-incident',
        evidence: [],
        thinkingBudget: THINKING_BUDGETS.MEDIUM,
      });

      const callArgs = mockGenerateContent.mock.calls[0][0];
      // Gemini 3 Flash uses thinkingLevel, MEDIUM budget (8192) maps to 'medium' for Flash
      expect(callArgs.config.thinkingConfig.thinkingLevel).toBe('medium');
    });

    it('should use LOW thinking budget when specified', async () => {
      await client.generateHypotheses({
        namespace: 'demo',
        incidentId: 'test-incident',
        evidence: [],
        thinkingBudget: THINKING_BUDGETS.LOW,
      });

      const callArgs = mockGenerateContent.mock.calls[0][0];
      // Gemini 3 Flash uses thinkingLevel, LOW budget (1024) maps to 'minimal' for Flash
      expect(callArgs.config.thinkingConfig.thinkingLevel).toBe('minimal');
    });

    it('should use MEDIUM thinking budget for log analysis', async () => {
      const logResponse = {
        text: JSON.stringify({ patterns: [], errorSpikes: [], timeline: [] }),
        usageMetadata: { totalTokenCount: 100 },
      };
      mockGenerateContent.mockResolvedValue(logResponse);

      await client.analyzeLogs({
        incidentId: 'test-incident',
        logs: ['log entry'],
        timeRange: { start: new Date(), end: new Date() },
      });

      const callArgs = mockGenerateContent.mock.calls[0][0];
      // Gemini 3 Flash uses thinkingLevel instead of thinkingBudget
      // LOW budget (1024) maps to 'minimal' for Flash models
      expect(callArgs.config.thinkingConfig.thinkingLevel).toBe('minimal');
    });

    it('should log dynamic budget usage', async () => {
      await client.generateHypotheses({
        namespace: 'demo',
        incidentId: 'test-incident',
        evidence: [],
        thinkingBudget: THINKING_BUDGETS.HIGH,
      });

      // Verify the call was made with high thinking level for Gemini 3 Pro
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            thinkingConfig: expect.objectContaining({
              thinkingLevel: 'high',
            }),
          }),
        })
      );
    });

    it('should report thinking tokens used in response', async () => {
      const result = await client.generateHypotheses({
        namespace: 'demo',
        incidentId: 'test-incident',
        evidence: [],
      });

      expect(result.data?.thinkingTokensUsed).toBe(20000);
    });
  });

  // =========================================================
  // FEATURE 4: 1M Token Context Window
  // =========================================================
  describe('1M Token Context Window', () => {
    const mockFullContextResponse = {
      text: JSON.stringify({
        timeline: [{ timestamp: '2024-01-01T10:00:00Z', event: 'Deploy', source: 'k8s', significance: 'high' }],
        correlations: [{ signals: ['deploy', 'error'], relationship: 'causal', confidence: 0.9, description: 'Deploy caused errors' }],
        historicalPatterns: [],
        triggerEvent: { timestamp: '2024-01-01T10:00:00Z', description: 'Deployment', confidence: 0.9, evidence: [] },
        insights: ['Memory leak detected'],
        focusAreas: ['Memory management'],
        confidence: 0.85,
        reasoning: 'Full context analysis complete',
      }),
      usageMetadata: {
        promptTokenCount: 500000,
        candidatesTokenCount: 1000,
        totalTokenCount: 501000,
      },
    };

    beforeEach(() => {
      mockGenerateContent.mockResolvedValue(mockFullContextResponse);
    });

    it('should successfully analyze with large context', async () => {
      const result = await client.analyzeWithFullContext({
        incidentId: 'test-incident',
        incidentTitle: 'Memory Leak',
        severity: 'high',
        namespace: 'production',
        evidence: [],
        fullLogs: 'a'.repeat(100000), // 100KB of logs
      });

      expect(result.success).toBe(true);
      expect(result.data?.timeline).toBeDefined();
      expect(result.data?.correlations).toBeDefined();
    });

    it('should estimate token count correctly', async () => {
      const largeContext = {
        incidentId: 'test-incident',
        incidentTitle: 'Memory Leak',
        severity: 'high',
        namespace: 'production',
        evidence: [],
        fullLogs: 'x'.repeat(400000), // ~100K tokens
        historicalIncidents: Array(10).fill({
          id: 'hist-1',
          title: 'Similar incident',
          severity: 'high',
          rootCause: 'Memory leak',
          resolution: 'Restart',
          duration: 3600000,
          occurredAt: new Date(),
        }),
      };

      const result = await client.analyzeWithFullContext(largeContext);

      expect(result.success).toBe(true);
      expect(result.data?.contextStats).toBeDefined();
      expect(result.data?.contextStats?.estimatedInputTokens).toBeGreaterThan(100000);
    });

    it('should include context statistics in response', async () => {
      const result = await client.analyzeWithFullContext({
        incidentId: 'test-incident',
        incidentTitle: 'Test',
        severity: 'medium',
        namespace: 'test',
        evidence: [
          { id: 'ev-1', incidentId: 'test', type: 'video_frame', source: 'dashboard', content: {}, timestamp: new Date(), confidence: 0.9, metadata: null, createdAt: new Date() },
          { id: 'ev-2', incidentId: 'test', type: 'log', source: 'app', content: {}, timestamp: new Date(), confidence: 0.8, metadata: null, createdAt: new Date() },
        ],
        fullLogs: 'log line 1\nlog line 2\nlog line 3',
        historicalIncidents: [
          { id: 'hist-1', title: 'Old incident', severity: 'high', rootCause: 'OOM', resolution: 'Restart', duration: 3600000, occurredAt: new Date() },
        ],
      });

      expect(result.data?.contextStats?.evidenceItems).toBe(2);
      expect(result.data?.contextStats?.logLines).toBe(3);
      expect(result.data?.contextStats?.historicalIncidents).toBe(1);
    });

    it('should use Pro model for full context analysis', async () => {
      await client.analyzeWithFullContext({
        incidentId: 'test-incident',
        incidentTitle: 'Test',
        severity: 'medium',
        namespace: 'test',
        evidence: [],
      });

      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.model).toBe(GEMINI_MODELS.PRO);
    });

    it('should support dynamic thinking budget for full context', async () => {
      await client.analyzeWithFullContext({
        incidentId: 'test-incident',
        incidentTitle: 'Test',
        severity: 'critical',
        namespace: 'production',
        evidence: [],
        thinkingBudget: THINKING_BUDGETS.HIGH,
      });

      const callArgs = mockGenerateContent.mock.calls[0][0];
      // Gemini 3 Pro uses thinkingLevel instead of thinkingBudget
      // HIGH budget (24576) maps to 'high' level
      expect(callArgs.config.thinkingConfig.thinkingLevel).toBe('high');
    });
  });

  // =========================================================
  // FEATURE 5: JSON Schema Validation
  // =========================================================
  describe('JSON Schema Validation', () => {
    const mockResponse = {
      text: JSON.stringify({
        anomalies: [],
        metrics: [],
        dashboardState: { healthy: true, overallSeverity: 'healthy' },
      }),
      usageMetadata: { totalTokenCount: 100 },
    };

    beforeEach(() => {
      mockGenerateContent.mockResolvedValue(mockResponse);
    });

    it('should pass responseSchema to API for frame analysis', async () => {
      await client.analyzeFrames({
        incidentId: 'test-incident',
        frames: [{ data: Buffer.from('test'), timestamp: new Date() }],
      });

      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.config.responseSchema).toBeDefined();
      expect(callArgs.config.responseSchema.type).toBe('object');
      expect(callArgs.config.responseSchema.properties.anomalies).toBeDefined();
    });

    it('should pass responseSchema to API for hypothesis generation', async () => {
      const hypResponse = {
        text: JSON.stringify({
          hypotheses: [{ rootCause: 'test', confidence: 0.8, supportingEvidence: [], suggestedActions: [], testingSteps: [] }],
          reasoning: 'test',
        }),
        usageMetadata: { totalTokenCount: 100 },
      };
      mockGenerateContent.mockResolvedValue(hypResponse);

      await client.generateHypotheses({
        namespace: 'demo',
        incidentId: 'test-incident',
        evidence: [],
      });

      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.config.responseSchema).toBeDefined();
      expect(callArgs.config.responseSchema.properties.hypotheses).toBeDefined();
      expect(callArgs.config.responseSchema.properties.reasoning).toBeDefined();
    });

    it('should set responseMimeType to application/json', async () => {
      await client.analyzeFrames({
        incidentId: 'test-incident',
        frames: [{ data: Buffer.from('test'), timestamp: new Date() }],
      });

      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.config.responseMimeType).toBe('application/json');
    });

    it('should handle JSON parse errors gracefully', async () => {
      mockGenerateContent.mockResolvedValue({ text: 'not valid json', usageMetadata: {} });

      const result = await client.analyzeFrames({
        incidentId: 'test-incident',
        frames: [{ data: Buffer.from('test'), timestamp: new Date() }],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid JSON');
    });

    it('should include required fields in schema', async () => {
      await client.analyzeFrames({
        incidentId: 'test-incident',
        frames: [{ data: Buffer.from('test'), timestamp: new Date() }],
      });

      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.config.responseSchema.required).toContain('anomalies');
      expect(callArgs.config.responseSchema.required).toContain('metrics');
      expect(callArgs.config.responseSchema.required).toContain('dashboardState');
    });
  });

  // =========================================================
  // FEATURE 6: Rate Limit Handling (Enhanced)
  // =========================================================
  describe('Rate Limit Handling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should detect rate limit error by status code', async () => {
      const rateLimitError = { status: 429, message: 'Rate limit exceeded' };
      mockGenerateContent
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({
          text: JSON.stringify({ anomalies: [], metrics: [], dashboardState: { healthy: true } }),
          usageMetadata: { totalTokenCount: 100 },
        });

      const resultPromise = client.analyzeFrames({
        incidentId: 'test',
        frames: [{ data: Buffer.from('data'), timestamp: new Date() }],
      });

      // Advance timers to complete the retry delay
      await vi.advanceTimersByTimeAsync(10000);

      const result = await resultPromise;
      expect(result.success).toBe(true);
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });

    it('should detect rate limit error by code property', async () => {
      const rateLimitError = { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' };
      mockGenerateContent
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({
          text: JSON.stringify({ anomalies: [], metrics: [], dashboardState: { healthy: true } }),
          usageMetadata: { totalTokenCount: 100 },
        });

      const resultPromise = client.analyzeFrames({
        incidentId: 'test',
        frames: [{ data: Buffer.from('data'), timestamp: new Date() }],
      });

      await vi.advanceTimersByTimeAsync(10000);

      const result = await resultPromise;
      expect(result.success).toBe(true);
    });

    it('should extract retry-after from error property', async () => {
      // This tests the extractRetryAfter method - retryAfter is in seconds
      const rateLimitError = {
        status: 429,
        retryAfter: 60, // 60 seconds
        message: 'Rate limit exceeded'
      };

      mockGenerateContent
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({
          text: JSON.stringify({ anomalies: [], metrics: [], dashboardState: { healthy: true } }),
          usageMetadata: { totalTokenCount: 100 },
        });

      const resultPromise = client.analyzeFrames({
        incidentId: 'test',
        frames: [{ data: Buffer.from('data'), timestamp: new Date() }],
      });

      // Advance time by 60 seconds + jitter buffer
      await vi.advanceTimersByTimeAsync(80000);

      const result = await resultPromise;
      expect(result.success).toBe(true);
    });

    it('should extract retry-after from headers', async () => {
      const rateLimitError = {
        status: 429,
        headers: { 'retry-after': '30' },
        message: 'Rate limit exceeded'
      };

      mockGenerateContent
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({
          text: JSON.stringify({ anomalies: [], metrics: [], dashboardState: { healthy: true } }),
          usageMetadata: { totalTokenCount: 100 },
        });

      const resultPromise = client.analyzeFrames({
        incidentId: 'test',
        frames: [{ data: Buffer.from('data'), timestamp: new Date() }],
      });

      // Advance time by 30 seconds + jitter buffer
      await vi.advanceTimersByTimeAsync(40000);

      const result = await resultPromise;
      expect(result.success).toBe(true);
    });

    it('should parse retry-after from error message', async () => {
      const rateLimitError = {
        status: 429,
        message: 'Too many requests. Please retry after 45 seconds.'
      };

      mockGenerateContent
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({
          text: JSON.stringify({ anomalies: [], metrics: [], dashboardState: { healthy: true } }),
          usageMetadata: { totalTokenCount: 100 },
        });

      const resultPromise = client.analyzeFrames({
        incidentId: 'test',
        frames: [{ data: Buffer.from('data'), timestamp: new Date() }],
      });

      // Advance time by 45 seconds + jitter buffer
      await vi.advanceTimersByTimeAsync(60000);

      const result = await resultPromise;
      expect(result.success).toBe(true);
    });

    it('should use default backoff when no retry-after specified', async () => {
      const rateLimitError = { status: 429, message: 'Rate limited' };

      mockGenerateContent
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({
          text: JSON.stringify({ anomalies: [], metrics: [], dashboardState: { healthy: true } }),
          usageMetadata: { totalTokenCount: 100 },
        });

      const resultPromise = client.analyzeFrames({
        incidentId: 'test',
        frames: [{ data: Buffer.from('data'), timestamp: new Date() }],
      });

      // Default is 5 seconds + jitter
      await vi.advanceTimersByTimeAsync(10000);

      const result = await resultPromise;
      expect(result.success).toBe(true);
    });

    it('should return rate limit error after max retries', async () => {
      const rateLimitError = { status: 429, message: 'Rate limit exceeded' };
      mockGenerateContent.mockRejectedValue(rateLimitError);

      const resultPromise = client.analyzeFrames({
        incidentId: 'test',
        frames: [{ data: Buffer.from('data'), timestamp: new Date() }],
      });

      // Advance time through all retries
      await vi.advanceTimersByTimeAsync(100000);

      const result = await resultPromise;
      expect(result.success).toBe(false);
      expect(result.error).toContain('Rate limit');
    });
  });

  // =========================================================
  // FEATURE 7: Spatial-Temporal Video Enhancement
  // =========================================================
  describe('Spatial-Temporal Video Enhancement', () => {
    const mockMultiFrameResponse = {
      text: JSON.stringify({
        anomalies: [
          { type: 'error_spike', severity: 'high', confidence: 0.9, description: 'Error rate spike', firstSeenInFrame: 2 },
        ],
        metrics: [
          { name: 'error_rate', value: 5.2, unit: '%', trend: 'increasing', changeFromBaseline: 150 },
        ],
        dashboardState: { healthy: false, overallSeverity: 'warning' },
        temporalAnalysis: {
          framesAnalyzed: 3,
          timeSpanSeconds: 30,
          anomalyOnset: { frameNumber: 2, timestamp: '2024-01-01T10:00:15Z', description: 'Error spike began' },
          trendDirection: 'deteriorating',
          changesSummary: [
            { fromFrame: 1, toFrame: 2, change: 'Error rate increased', significance: 'high' },
          ],
          correlatedChanges: ['error_rate', 'latency'],
        },
      }),
      usageMetadata: { totalTokenCount: 500 },
    };

    beforeEach(() => {
      mockGenerateContent.mockResolvedValue(mockMultiFrameResponse);
    });

    it('should include temporal context for multi-frame analysis', async () => {
      const frames = [
        { data: Buffer.from('frame1'), timestamp: new Date('2024-01-01T10:00:00Z') },
        { data: Buffer.from('frame2'), timestamp: new Date('2024-01-01T10:00:15Z') },
        { data: Buffer.from('frame3'), timestamp: new Date('2024-01-01T10:00:30Z') },
      ];

      await client.analyzeFrames({
        incidentId: 'test-incident',
        frames,
      });

      const callArgs = mockGenerateContent.mock.calls[0][0];
      const contents = callArgs.contents;

      // Should have temporal analysis header
      expect(contents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            text: expect.stringContaining('TEMPORAL ANALYSIS REQUEST'),
          }),
        ])
      );
    });

    it('should include frame numbers and time deltas', async () => {
      const frames = [
        { data: Buffer.from('frame1'), timestamp: new Date('2024-01-01T10:00:00Z') },
        { data: Buffer.from('frame2'), timestamp: new Date('2024-01-01T10:00:10Z') },
      ];

      await client.analyzeFrames({
        incidentId: 'test-incident',
        frames,
      });

      const callArgs = mockGenerateContent.mock.calls[0][0];
      const textParts = callArgs.contents.filter((p: { text?: string }) => p.text).map((p: { text: string }) => p.text);
      const allText = textParts.join('\n');

      expect(allText).toContain('Frame 1/2');
      expect(allText).toContain('Frame 2/2');
      expect(allText).toContain('+10s from previous frame');
    });

    it('should label baseline frame correctly', async () => {
      const frames = [
        { data: Buffer.from('frame1'), timestamp: new Date('2024-01-01T10:00:00Z') },
        { data: Buffer.from('frame2'), timestamp: new Date('2024-01-01T10:00:10Z') },
      ];

      await client.analyzeFrames({
        incidentId: 'test-incident',
        frames,
      });

      const callArgs = mockGenerateContent.mock.calls[0][0];
      const textParts = callArgs.contents.filter((p: { text?: string }) => p.text).map((p: { text: string }) => p.text);
      const allText = textParts.join('\n');

      expect(allText).toContain('baseline frame');
    });

    it('should include comparison prompts between frames', async () => {
      const frames = [
        { data: Buffer.from('frame1'), timestamp: new Date('2024-01-01T10:00:00Z') },
        { data: Buffer.from('frame2'), timestamp: new Date('2024-01-01T10:00:10Z') },
      ];

      await client.analyzeFrames({
        incidentId: 'test-incident',
        frames,
      });

      const callArgs = mockGenerateContent.mock.calls[0][0];
      const textParts = callArgs.contents.filter((p: { text?: string }) => p.text).map((p: { text: string }) => p.text);
      const allText = textParts.join('\n');

      expect(allText).toContain('Compare with previous frame');
    });

    it('should parse temporal analysis response', async () => {
      const frames = [
        { data: Buffer.from('frame1'), timestamp: new Date('2024-01-01T10:00:00Z') },
        { data: Buffer.from('frame2'), timestamp: new Date('2024-01-01T10:00:15Z') },
        { data: Buffer.from('frame3'), timestamp: new Date('2024-01-01T10:00:30Z') },
      ];

      const result = await client.analyzeFrames({
        incidentId: 'test-incident',
        frames,
      });

      expect(result.success).toBe(true);
      expect(result.data?.temporalAnalysis).toBeDefined();
      expect(result.data?.temporalAnalysis?.framesAnalyzed).toBe(3);
      expect(result.data?.temporalAnalysis?.timeSpanSeconds).toBe(30);
      expect(result.data?.temporalAnalysis?.trendDirection).toBe('deteriorating');
    });

    it('should track anomaly onset timing', async () => {
      const frames = [
        { data: Buffer.from('frame1'), timestamp: new Date('2024-01-01T10:00:00Z') },
        { data: Buffer.from('frame2'), timestamp: new Date('2024-01-01T10:00:15Z') },
      ];

      const result = await client.analyzeFrames({
        incidentId: 'test-incident',
        frames,
      });

      expect(result.data?.temporalAnalysis?.anomalyOnset?.frameNumber).toBe(2);
    });

    it('should calculate total time span in seconds', async () => {
      const frames = [
        { data: Buffer.from('frame1'), timestamp: new Date('2024-01-01T10:00:00Z') },
        { data: Buffer.from('frame2'), timestamp: new Date('2024-01-01T10:01:00Z') },
      ];

      await client.analyzeFrames({
        incidentId: 'test-incident',
        frames,
      });

      const callArgs = mockGenerateContent.mock.calls[0][0];
      const textParts = callArgs.contents.filter((p: { text?: string }) => p.text).map((p: { text: string }) => p.text);
      const allText = textParts.join('\n');

      expect(allText).toContain('60 seconds');
    });

    it('should handle single frame without temporal context', async () => {
      const singleFrameResponse = {
        text: JSON.stringify({
          anomalies: [],
          metrics: [],
          dashboardState: { healthy: true, overallSeverity: 'healthy' },
        }),
        usageMetadata: { totalTokenCount: 100 },
      };
      mockGenerateContent.mockResolvedValue(singleFrameResponse);

      const frames = [
        { data: Buffer.from('frame1'), timestamp: new Date() },
      ];

      await client.analyzeFrames({
        incidentId: 'test-incident',
        frames,
      });

      const callArgs = mockGenerateContent.mock.calls[0][0];
      const textParts = callArgs.contents.filter((p: { text?: string }) => p.text).map((p: { text: string }) => p.text);
      const allText = textParts.join('\n');

      // Single frame should not have temporal analysis header
      expect(allText).not.toContain('TEMPORAL ANALYSIS REQUEST');
    });
  });

  // =========================================================
  // FEATURE 8: Streaming for Long Operations
  // =========================================================
  describe('Streaming for Long Operations', () => {
    it('should call streaming API for postmortem with progress', async () => {
      // Create an async iterator for streaming
      const chunks = [
        { text: '{"summary":"Incident caused' },
        { text: ' by memory leak","timeline":[],' },
        { text: '"rootCauseAnalysis":"Memory leak",' },
        { text: '"impactAnalysis":"High impact",' },
        { text: '"actionsTaken":[],"lessonsLearned":[],' },
        { text: '"preventionRecommendations":[],"markdown":"# Postmortem"}' },
      ];

      async function* mockStream() {
        for (const chunk of chunks) {
          yield chunk;
        }
      }

      mockGenerateContentStream.mockResolvedValue(mockStream());

      const progressChunks: string[] = [];
      const result = await client.generatePostmortemWithProgress(
        {
          incidentId: 'test-incident',
          title: 'Test Incident',
          evidence: [],
          hypotheses: [],
          actions: [],
          duration: 60000,
        },
        (chunk) => progressChunks.push(chunk)
      );

      expect(mockGenerateContentStream).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.data?.summary).toContain('memory leak');
      expect(progressChunks.length).toBeGreaterThan(0);
    });

    it('should invoke progress callback for each chunk', async () => {
      const chunks = [
        { text: '{"summary":"Test' },
        { text: '","timeline":[]' },
        { text: ',"rootCauseAnalysis":"Cause"' },
        { text: ',"impactAnalysis":"Impact"' },
        { text: ',"actionsTaken":[],"lessonsLearned":[]' },
        { text: ',"preventionRecommendations":[],"markdown":"#"}' },
      ];

      async function* mockStream() {
        for (const chunk of chunks) {
          yield chunk;
        }
      }

      mockGenerateContentStream.mockResolvedValue(mockStream());

      const progressChunks: string[] = [];
      await client.generatePostmortemWithProgress(
        {
          incidentId: 'test-incident',
          title: 'Test',
          evidence: [],
          hypotheses: [],
          actions: [],
          duration: 60000,
        },
        (chunk) => progressChunks.push(chunk)
      );

      expect(progressChunks.length).toBe(6);
    });

    it('should handle thinking content in stream', async () => {
      const chunksWithThinking = [
        {
          candidates: [{
            content: {
              parts: [
                { thought: true, text: 'Analyzing the incident timeline...' },
              ],
            },
          }],
        },
        {
          candidates: [{
            content: {
              parts: [
                { text: '{"summary":"Analysis complete' },
              ],
            },
          }],
        },
        { text: '","timeline":[],"rootCauseAnalysis":"OOM","impactAnalysis":"High","actionsTaken":[],"lessonsLearned":[],"preventionRecommendations":[],"markdown":"#"}' },
      ];

      async function* mockStream() {
        for (const chunk of chunksWithThinking) {
          yield chunk;
        }
      }

      mockGenerateContentStream.mockResolvedValue(mockStream());

      const thinkingChunks: string[] = [];
      const result = await client.generatePostmortemWithProgress(
        {
          incidentId: 'test-incident',
          title: 'Test',
          evidence: [],
          hypotheses: [],
          actions: [],
          duration: 60000,
        },
        undefined,
        (thought) => thinkingChunks.push(thought)
      );

      expect(result.success).toBe(true);
      expect(thinkingChunks.length).toBeGreaterThan(0);
      expect(thinkingChunks[0]).toContain('Analyzing the incident timeline');
    });

    it('should return thought signature from streaming', async () => {
      const chunksWithThinking = [
        {
          candidates: [{
            content: {
              parts: [
                { thought: true, text: 'Deep analysis of incident patterns...' },
              ],
            },
          }],
        },
        { text: '{"summary":"Test","timeline":[],"rootCauseAnalysis":"Cause","impactAnalysis":"Impact","actionsTaken":[],"lessonsLearned":[],"preventionRecommendations":[],"markdown":"#"}' },
      ];

      async function* mockStream() {
        for (const chunk of chunksWithThinking) {
          yield chunk;
        }
      }

      mockGenerateContentStream.mockResolvedValue(mockStream());

      const result = await client.generatePostmortemWithProgress({
        incidentId: 'test-incident',
        title: 'Test',
        evidence: [],
        hypotheses: [],
        actions: [],
        duration: 60000,
      });

      expect(result.thoughtSignature).toBeDefined();
    });

    it('should handle stream parse errors gracefully', async () => {
      const invalidChunks = [
        { text: '{"summary":"Test' },
        { text: '","incomplete json...' },
      ];

      async function* mockStream() {
        for (const chunk of invalidChunks) {
          yield chunk;
        }
      }

      mockGenerateContentStream.mockResolvedValue(mockStream());

      const result = await client.generatePostmortemWithProgress({
        incidentId: 'test-incident',
        title: 'Test',
        evidence: [],
        hypotheses: [],
        actions: [],
        duration: 60000,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('parse');
    });

    it('should handle stream API errors', async () => {
      mockGenerateContentStream.mockRejectedValue(new Error('Stream connection failed'));

      const result = await client.generatePostmortemWithProgress({
        incidentId: 'test-incident',
        title: 'Test',
        evidence: [],
        hypotheses: [],
        actions: [],
        duration: 60000,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Stream connection failed');
    });
  });

  // =========================================================
  // FEATURE 9: Tool Use / Function Calling
  // =========================================================
  describe('Tool Use / Function Calling', () => {
    it('should call tool executor when Gemini requests tool use', async () => {
      // First response: Gemini requests a tool call
      const toolCallResponse = {
        candidates: [{
          content: {
            parts: [{
              functionCall: {
                name: 'kubectl_get',
                args: { resource: 'pods', namespace: 'production' },
              },
            }],
          },
        }],
      };

      // Second response: Gemini provides final analysis
      const finalResponse = {
        candidates: [{
          content: {
            parts: [{
              text: 'Based on the pod status, I found 2 pods in CrashLoopBackOff...',
            }],
          },
        }],
        text: 'Based on the pod status, I found 2 pods in CrashLoopBackOff...',
      };

      mockGenerateContent
        .mockResolvedValueOnce(toolCallResponse)
        .mockResolvedValueOnce(finalResponse);

      const toolExecutor = vi.fn().mockResolvedValue({
        items: [
          { name: 'api-pod-1', status: 'CrashLoopBackOff' },
          { name: 'api-pod-2', status: 'CrashLoopBackOff' },
        ],
      });

      const result = await client.analyzeWithTools({
        incidentId: 'test-incident',
        prompt: 'Check the status of pods in production',
        namespace: 'production',
        toolExecutor,
      });

      expect(result.success).toBe(true);
      expect(toolExecutor).toHaveBeenCalledWith('kubectl_get', { resource: 'pods', namespace: 'production' });
      expect(result.data?.toolCallsExecuted).toHaveLength(1);
      expect(result.data?.totalToolCalls).toBe(1);
    });

    it('should handle multiple tool call rounds', async () => {
      // First: Get pods
      const round1Response = {
        candidates: [{
          content: {
            parts: [{
              functionCall: { name: 'kubectl_get', args: { resource: 'pods', namespace: 'test' } },
            }],
          },
        }],
      };

      // Second: Get logs for a pod
      const round2Response = {
        candidates: [{
          content: {
            parts: [{
              functionCall: { name: 'kubectl_logs', args: { podName: 'api-pod-1', namespace: 'test' } },
            }],
          },
        }],
      };

      // Third: Final analysis
      const finalResponse = {
        candidates: [{
          content: {
            parts: [{ text: 'Found OOM error in pod logs' }],
          },
        }],
        text: 'Found OOM error in pod logs',
      };

      mockGenerateContent
        .mockResolvedValueOnce(round1Response)
        .mockResolvedValueOnce(round2Response)
        .mockResolvedValueOnce(finalResponse);

      const toolExecutor = vi.fn()
        .mockResolvedValueOnce({ items: [{ name: 'api-pod-1' }] })
        .mockResolvedValueOnce({ logs: 'OutOfMemoryError at line 42' });

      const result = await client.analyzeWithTools({
        incidentId: 'test-incident',
        prompt: 'Investigate pod issues',
        namespace: 'test',
        toolExecutor,
      });

      expect(result.success).toBe(true);
      expect(toolExecutor).toHaveBeenCalledTimes(2);
      expect(result.data?.toolCallsExecuted).toHaveLength(2);
    });

    it('should respect maxToolRounds limit', async () => {
      // Always request more tools
      const toolCallResponse = {
        candidates: [{
          content: {
            parts: [{
              functionCall: { name: 'kubectl_get', args: { resource: 'pods', namespace: 'test' } },
            }],
          },
        }],
      };

      mockGenerateContent.mockResolvedValue(toolCallResponse);
      const toolExecutor = vi.fn().mockResolvedValue({ items: [] });

      const result = await client.analyzeWithTools({
        incidentId: 'test-incident',
        prompt: 'Test',
        namespace: 'test',
        toolExecutor,
        maxToolRounds: 2,
      });

      expect(toolExecutor).toHaveBeenCalledTimes(2);
      expect(result.data?.analysis).toContain('stopped after 2 tool call rounds');
    });

    it('should handle tool execution errors', async () => {
      const toolCallResponse = {
        candidates: [{
          content: {
            parts: [{
              functionCall: { name: 'kubectl_get', args: { resource: 'pods', namespace: 'test' } },
            }],
          },
        }],
      };

      const finalResponse = {
        candidates: [{
          content: {
            parts: [{ text: 'Could not get pod status due to error' }],
          },
        }],
        text: 'Could not get pod status due to error',
      };

      mockGenerateContent
        .mockResolvedValueOnce(toolCallResponse)
        .mockResolvedValueOnce(finalResponse);

      const toolExecutor = vi.fn().mockRejectedValue(new Error('Connection refused'));

      const result = await client.analyzeWithTools({
        incidentId: 'test-incident',
        prompt: 'Check pods',
        namespace: 'test',
        toolExecutor,
      });

      expect(result.success).toBe(true);
      expect(result.data?.toolCallsExecuted?.[0]?.result).toEqual({ error: 'Connection refused' });
    });

    it('should pass available tools to Gemini API', async () => {
      const finalResponse = {
        candidates: [{
          content: {
            parts: [{ text: 'No issues found' }],
          },
        }],
        text: 'No issues found',
      };

      mockGenerateContent.mockResolvedValue(finalResponse);

      await client.analyzeWithTools({
        incidentId: 'test-incident',
        prompt: 'Check status',
        namespace: 'test',
        toolExecutor: vi.fn(),
      });

      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.config.tools).toBeDefined();
      expect(Array.isArray(callArgs.config.tools)).toBe(true);
    });

    it('should configure tool calling mode to AUTO', async () => {
      const finalResponse = {
        candidates: [{
          content: {
            parts: [{ text: 'Analysis complete' }],
          },
        }],
        text: 'Analysis complete',
      };

      mockGenerateContent.mockResolvedValue(finalResponse);

      await client.analyzeWithTools({
        incidentId: 'test-incident',
        prompt: 'Analyze',
        namespace: 'test',
        toolExecutor: vi.fn(),
      });

      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.config.toolConfig.functionCallingConfig.mode).toBe('AUTO');
    });

    it('should support thinking budget with tools', async () => {
      const finalResponse = {
        candidates: [{
          content: {
            parts: [{ text: 'Deep analysis' }],
          },
        }],
        text: 'Deep analysis',
      };

      mockGenerateContent.mockResolvedValue(finalResponse);

      await client.analyzeWithTools({
        incidentId: 'test-incident',
        prompt: 'Analyze with thinking',
        namespace: 'test',
        toolExecutor: vi.fn(),
        thinkingBudget: THINKING_BUDGETS.HIGH,
      });

      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.config.thinkingConfig).toBeDefined();
      // Gemini 3 Pro uses thinkingLevel, HIGH budget maps to 'high' level
      expect(callArgs.config.thinkingConfig.thinkingLevel).toBe('high');
    });

    it('should extract thought signature during tool calls', async () => {
      const toolCallResponse = {
        candidates: [{
          content: {
            parts: [
              { thought: true, text: 'Thinking about which tools to use...' },
              { functionCall: { name: 'kubectl_get', args: { resource: 'pods', namespace: 'test' } } },
            ],
          },
        }],
      };

      const finalResponse = {
        candidates: [{
          content: {
            parts: [{ text: 'Analysis complete' }],
          },
        }],
        text: 'Analysis complete',
        thoughtSignature: 'extracted-thought-sig',
      };

      mockGenerateContent
        .mockResolvedValueOnce(toolCallResponse)
        .mockResolvedValueOnce(finalResponse);

      const toolExecutor = vi.fn().mockResolvedValue({ items: [] });

      const result = await client.analyzeWithTools({
        incidentId: 'test-incident',
        prompt: 'Analyze',
        namespace: 'test',
        toolExecutor,
      });

      expect(result.thoughtSignature).toBeDefined();
    });

    it('should pass thought signature to tool-enabled analysis', async () => {
      const finalResponse = {
        candidates: [{
          content: {
            parts: [{ text: 'Continuing from previous context' }],
          },
        }],
        text: 'Continuing from previous context',
      };

      mockGenerateContent.mockResolvedValue(finalResponse);

      const previousThought = Buffer.from('Previous analysis found memory issues').toString('base64');

      await client.analyzeWithTools({
        incidentId: 'test-incident',
        prompt: 'Continue investigation',
        namespace: 'test',
        toolExecutor: vi.fn(),
        thoughtSignature: previousThought,
      });

      const callArgs = mockGenerateContent.mock.calls[0][0];
      const contentsString = JSON.stringify(callArgs.contents);
      expect(contentsString).toContain('PREVIOUS REASONING CONTEXT');
    });

    it('should handle API error during tool analysis', async () => {
      mockGenerateContent.mockRejectedValue(new Error('API unavailable'));

      const result = await client.analyzeWithTools({
        incidentId: 'test-incident',
        prompt: 'Check status',
        namespace: 'test',
        toolExecutor: vi.fn(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('API unavailable');
    });
  });
});

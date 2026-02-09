/**
 * MSW handlers for mocking Gemini API
 */
import { http, HttpResponse } from 'msw';

// Mock frame analysis response
const mockFrameAnalysisResponse = {
  candidates: [
    {
      content: {
        parts: [
          {
            text: JSON.stringify({
              anomalies: [
                {
                  type: 'error_spike',
                  severity: 'high',
                  confidence: 0.85,
                  description: 'Error rate increased by 150%',
                  location: 'API Gateway',
                  timestamp: new Date().toISOString(),
                },
              ],
              metrics: [
                {
                  name: 'error_rate',
                  value: 2.5,
                  unit: 'percent',
                  trend: 'increasing',
                  timestamp: new Date().toISOString(),
                },
              ],
              dashboardState: {
                healthy: false,
                panelStates: [
                  { name: 'Error Rate', status: 'error', description: 'Above threshold' },
                ],
                overallSeverity: 'warning',
              },
            }),
          },
        ],
      },
    },
  ],
  usageMetadata: {
    promptTokenCount: 1000,
    candidatesTokenCount: 500,
    totalTokenCount: 1500,
  },
};

// Mock hypothesis generation response
const mockHypothesisResponse = {
  candidates: [
    {
      content: {
        parts: [
          {
            text: JSON.stringify({
              hypotheses: [
                {
                  rootCause: 'Memory leak in demo-app causing increased error rates',
                  confidence: 0.82,
                  supportingEvidence: ['Error spike detected', 'Memory usage increasing'],
                  contradictingEvidence: [],
                  suggestedActions: [
                    {
                      type: 'restart',
                      target: 'demo-app',
                      parameters: { namespace: 'demo' },
                      riskLevel: 'low',
                    },
                  ],
                  testingSteps: ['Restart deployment', 'Monitor error rates'],
                },
              ],
              reasoning: 'Based on error spike and memory patterns, a restart should resolve the issue.',
            }),
          },
        ],
      },
    },
  ],
  usageMetadata: {
    promptTokenCount: 2000,
    candidatesTokenCount: 800,
    thoughtsTokenCount: 500,
    totalTokenCount: 3300,
  },
};

// Mock healthy dashboard response (for verification)
const mockHealthyDashboardResponse = {
  candidates: [
    {
      content: {
        parts: [
          {
            text: JSON.stringify({
              anomalies: [],
              metrics: [
                {
                  name: 'error_rate',
                  value: 0.1,
                  unit: 'percent',
                  trend: 'stable',
                  timestamp: new Date().toISOString(),
                },
              ],
              dashboardState: {
                healthy: true,
                panelStates: [
                  { name: 'Error Rate', status: 'normal', description: 'Within threshold' },
                ],
                overallSeverity: 'healthy',
              },
            }),
          },
        ],
      },
    },
  ],
  usageMetadata: {
    promptTokenCount: 1000,
    candidatesTokenCount: 400,
    totalTokenCount: 1400,
  },
};

// Track call count for stateful responses
let frameAnalysisCallCount = 0;

export const geminiHandlers = [
  // Frame analysis endpoint
  http.post('https://generativelanguage.googleapis.com/*/models/gemini-3-flash-preview:generateContent', () => {
    frameAnalysisCallCount++;

    // Return healthy response on verification calls (3rd+ call)
    if (frameAnalysisCallCount >= 3) {
      return HttpResponse.json(mockHealthyDashboardResponse);
    }

    return HttpResponse.json(mockFrameAnalysisResponse);
  }),

  // Hypothesis generation endpoint (Pro model)
  http.post('https://generativelanguage.googleapis.com/*/models/gemini-3-pro-preview:generateContent', () => {
    return HttpResponse.json(mockHypothesisResponse);
  }),

  // Fallback for any other model
  http.post('https://generativelanguage.googleapis.com/*/models/*:generateContent', () => {
    return HttpResponse.json(mockFrameAnalysisResponse);
  }),
];

// Helper to reset call count between tests
export function resetGeminiMocks() {
  frameAnalysisCallCount = 0;
}

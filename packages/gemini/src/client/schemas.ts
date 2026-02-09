/**
 * JSON Schemas for Gemini structured output
 *
 * These schemas guarantee the response structure from Gemini API.
 * When responseSchema is provided, Gemini validates output against it.
 *
 * @see https://ai.google.dev/gemini-api/docs/structured-output
 */

import type { JsonSchema } from './types.js';

/**
 * Schema for frame/dashboard analysis response
 *
 * Includes temporal analysis fields for multi-frame analysis:
 * - temporalAnalysis: Changes detected across frames
 * - anomalyOnset: When issues first appeared
 * - trendDirection: Overall situation trajectory
 */
export const FRAME_ANALYSIS_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    anomalies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['error_spike', 'latency_increase', 'resource_exhaustion', 'deployment_event', 'traffic_anomaly'],
          },
          severity: {
            type: 'string',
            enum: ['low', 'medium', 'high', 'critical'],
          },
          confidence: { type: 'number' },
          description: { type: 'string' },
          location: { type: 'string' },
          timestamp: { type: 'string' },
          firstSeenInFrame: { type: 'number', description: 'Frame number where anomaly first appeared (1-indexed)' },
        },
        required: ['type', 'severity', 'confidence', 'description'],
      },
    },
    metrics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          value: { type: 'number' },
          unit: { type: 'string' },
          trend: {
            type: 'string',
            enum: ['increasing', 'decreasing', 'stable', 'volatile'],
          },
          timestamp: { type: 'string' },
          changeFromBaseline: { type: 'number', description: 'Percentage change from first frame' },
        },
        required: ['name', 'value', 'unit', 'trend'],
      },
    },
    // Temporal analysis section for multi-frame analysis
    temporalAnalysis: {
      type: 'object',
      properties: {
        framesAnalyzed: { type: 'number' },
        timeSpanSeconds: { type: 'number' },
        anomalyOnset: {
          type: 'object',
          properties: {
            frameNumber: { type: 'number', description: 'First frame where issues appeared' },
            timestamp: { type: 'string' },
            description: { type: 'string' },
          },
        },
        trendDirection: {
          type: 'string',
          enum: ['improving', 'deteriorating', 'stable', 'fluctuating'],
        },
        changesSummary: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              fromFrame: { type: 'number' },
              toFrame: { type: 'number' },
              change: { type: 'string' },
              significance: { type: 'string', enum: ['low', 'medium', 'high'] },
            },
            required: ['fromFrame', 'toFrame', 'change', 'significance'],
          },
        },
        correlatedChanges: {
          type: 'array',
          items: { type: 'string' },
          description: 'Metrics that changed together, suggesting correlation',
        },
      },
    },
    dashboardState: {
      type: 'object',
      properties: {
        healthy: { type: 'boolean' },
        panelStates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              status: {
                type: 'string',
                enum: ['normal', 'warning', 'error', 'unknown'],
              },
              description: { type: 'string' },
            },
            required: ['name', 'status'],
          },
        },
        overallSeverity: {
          type: 'string',
          enum: ['healthy', 'warning', 'critical'],
        },
      },
      required: ['healthy', 'overallSeverity'],
    },
  },
  required: ['anomalies', 'metrics', 'dashboardState'],
};

/**
 * Schema for log analysis response
 */
export const LOG_ANALYSIS_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    patterns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          count: { type: 'number' },
          severity: {
            type: 'string',
            enum: ['info', 'warning', 'error'],
          },
          samples: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['pattern', 'count', 'severity', 'samples'],
      },
    },
    errorSpikes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          errorType: { type: 'string' },
          count: { type: 'number' },
          startTime: { type: 'string' },
          endTime: { type: 'string' },
          affectedServices: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['errorType', 'count', 'startTime', 'endTime', 'affectedServices'],
      },
    },
    timeline: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          timestamp: { type: 'string' },
          event: { type: 'string' },
          type: {
            type: 'string',
            enum: ['error', 'warning', 'info', 'deployment', 'config_change'],
          },
          source: { type: 'string' },
        },
        required: ['timestamp', 'event', 'type', 'source'],
      },
    },
  },
  required: ['patterns', 'errorSpikes', 'timeline'],
};

/**
 * Schema for hypothesis generation response
 */
export const HYPOTHESIS_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    hypotheses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rootCause: { type: 'string' },
          confidence: { type: 'number' },
          supportingEvidence: {
            type: 'array',
            items: { type: 'string' },
          },
          contradictingEvidence: {
            type: 'array',
            items: { type: 'string' },
          },
          suggestedActions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['rollback', 'restart', 'scale', 'code_fix'],
                  description: 'Action type. Use code_fix only when operational actions (rollback/restart/scale) are unlikely to resolve the issue (e.g., actual bug in code, not infra issue)',
                },
                target: { type: 'string' },
                parameters: {
                  type: 'object',
                  properties: {
                    replicas: { type: 'number', description: 'Number of replicas for scale action' },
                    revision: { type: 'string', description: 'Revision for rollback action' },
                  },
                },
                riskLevel: {
                  type: 'string',
                  enum: ['low', 'medium', 'high'],
                },
                // code_fix specific fields
                affectedComponent: {
                  type: 'string',
                  description: 'For code_fix: Component/file that needs modification (e.g., "api/handlers/auth.ts")',
                },
                fixDescription: {
                  type: 'string',
                  description: 'For code_fix: Detailed description of what code change is needed',
                },
                codeFixReason: {
                  type: 'string',
                  description: 'For code_fix: Why operational fixes (rollback/restart/scale) won\'t resolve this issue',
                },
              },
              required: ['type', 'target', 'riskLevel'],
            },
          },
          testingSteps: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['rootCause', 'confidence', 'supportingEvidence', 'suggestedActions', 'testingSteps'],
      },
    },
    reasoning: { type: 'string' },
  },
  required: ['hypotheses', 'reasoning'],
};

/**
 * Schema for postmortem generation response
 */
export const POSTMORTEM_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    timeline: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          timestamp: { type: 'string' },
          event: { type: 'string' },
          phase: { type: 'string' },
        },
        required: ['timestamp', 'event', 'phase'],
      },
    },
    rootCauseAnalysis: { type: 'string' },
    impactAnalysis: { type: 'string' },
    actionsTaken: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          result: { type: 'string' },
          duration: { type: 'number' },
        },
        required: ['action', 'result', 'duration'],
      },
    },
    lessonsLearned: {
      type: 'array',
      items: { type: 'string' },
    },
    preventionRecommendations: {
      type: 'array',
      items: { type: 'string' },
    },
    markdown: { type: 'string' },
  },
  required: ['summary', 'timeline', 'rootCauseAnalysis', 'impactAnalysis', 'actionsTaken', 'lessonsLearned', 'preventionRecommendations', 'markdown'],
};

/**
 * Schema for full context analysis response
 */
export const FULL_CONTEXT_ANALYSIS_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    timeline: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          timestamp: { type: 'string' },
          event: { type: 'string' },
          source: {
            type: 'string',
            enum: ['logs', 'metrics', 'k8s', 'evidence', 'historical'],
          },
          significance: {
            type: 'string',
            enum: ['low', 'medium', 'high', 'critical'],
          },
        },
        required: ['timestamp', 'event', 'source', 'significance'],
      },
    },
    correlations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          signals: {
            type: 'array',
            items: { type: 'string' },
          },
          relationship: {
            type: 'string',
            enum: ['causal', 'temporal', 'symptomatic'],
          },
          confidence: { type: 'number' },
          description: { type: 'string' },
        },
        required: ['signals', 'relationship', 'confidence', 'description'],
      },
    },
    historicalPatterns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          incidentId: { type: 'string' },
          similarity: { type: 'number' },
          matchedSignals: {
            type: 'array',
            items: { type: 'string' },
          },
          previousRootCause: { type: 'string' },
          previousResolution: { type: 'string' },
          applicability: {
            type: 'string',
            enum: ['high', 'medium', 'low'],
          },
        },
        required: ['incidentId', 'similarity', 'matchedSignals', 'previousRootCause', 'previousResolution', 'applicability'],
      },
    },
    triggerEvent: {
      type: 'object',
      properties: {
        timestamp: { type: 'string' },
        description: { type: 'string' },
        confidence: { type: 'number' },
        evidence: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['timestamp', 'description', 'confidence', 'evidence'],
    },
    insights: {
      type: 'array',
      items: { type: 'string' },
    },
    focusAreas: {
      type: 'array',
      items: { type: 'string' },
    },
    confidence: { type: 'number' },
    reasoning: { type: 'string' },
  },
  required: ['timeline', 'correlations', 'historicalPatterns', 'triggerEvent', 'insights', 'focusAreas', 'confidence', 'reasoning'],
};

// ===========================================
// Development / Self-Regenerating Schemas
// ===========================================

/**
 * Schema for requirement analysis response
 */
export const REQUIREMENT_ANALYSIS_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: ['feature', 'bugfix', 'refactor', 'infrastructure'],
    },
    title: { type: 'string' },
    description: { type: 'string' },
    acceptanceCriteria: {
      type: 'array',
      items: { type: 'string' },
    },
    estimatedComplexity: {
      type: 'string',
      enum: ['low', 'medium', 'high'],
    },
    suggestedApproach: { type: 'string' },
    requiredCapabilities: {
      type: 'array',
      items: { type: 'string' },
    },
    potentialRisks: {
      type: 'array',
      items: { type: 'string' },
    },
    relatedPatterns: {
      type: 'array',
      items: { type: 'string' },
    },
    targetFiles: {
      type: 'array',
      items: { type: 'string' },
    },
    suggestedDependencies: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['type', 'title', 'description', 'acceptanceCriteria', 'estimatedComplexity', 'suggestedApproach', 'requiredCapabilities', 'potentialRisks', 'relatedPatterns'],
};

/**
 * Schema for architecture design response
 */
export const ARCHITECTURE_DESIGN_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    overview: { type: 'string' },
    components: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: {
            type: 'string',
            enum: ['service', 'repository', 'controller', 'middleware', 'route', 'model', 'util'],
          },
          purpose: { type: 'string' },
          suggestedPath: { type: 'string' },
          interface: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                parameters: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      type: { type: 'string' },
                      optional: { type: 'boolean' },
                      description: { type: 'string' },
                    },
                    required: ['name', 'type', 'optional', 'description'],
                  },
                },
                returnType: { type: 'string' },
                async: { type: 'boolean' },
              },
              required: ['name', 'description', 'parameters', 'returnType', 'async'],
            },
          },
          internalState: {
            type: 'array',
            items: { type: 'string' },
          },
          errorHandling: { type: 'string' },
          dependsOn: {
            type: 'array',
            items: { type: 'string' },
          },
          testRequirements: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['name', 'type', 'purpose', 'suggestedPath', 'interface', 'errorHandling'],
      },
    },
    dependencies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          type: {
            type: 'string',
            enum: ['uses', 'extends', 'implements'],
          },
        },
        required: ['from', 'to', 'type'],
      },
    },
    externalDependencies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          version: { type: 'string' },
          purpose: { type: 'string' },
          devOnly: { type: 'boolean' },
        },
        required: ['name', 'version', 'purpose', 'devOnly'],
      },
    },
    dataFlow: { type: 'string' },
    securityConsiderations: {
      type: 'array',
      items: { type: 'string' },
    },
    performanceConsiderations: {
      type: 'array',
      items: { type: 'string' },
    },
    testingStrategy: { type: 'string' },
  },
  required: ['overview', 'components', 'dependencies', 'externalDependencies', 'dataFlow', 'securityConsiderations', 'performanceConsiderations'],
};

/**
 * Schema for code generation response
 */
export const CODE_GENERATION_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    files: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
          language: {
            type: 'string',
            enum: ['typescript', 'javascript', 'json', 'yaml', 'dockerfile', 'markdown'],
          },
          purpose: { type: 'string' },
          isNew: { type: 'boolean' },
        },
        required: ['path', 'content', 'language', 'purpose', 'isNew'],
      },
    },
    dependencies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          version: { type: 'string' },
          purpose: { type: 'string' },
          devOnly: { type: 'boolean' },
        },
        required: ['name', 'version', 'purpose', 'devOnly'],
      },
    },
    explanation: { type: 'string' },
    integrationNotes: { type: 'string' },
  },
  required: ['files', 'dependencies', 'explanation'],
};

/**
 * Schema for code fix response
 */
export const CODE_FIX_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    fixedCode: { type: 'string' },
    explanation: { type: 'string' },
    allErrorsFixed: { type: 'boolean' },
    remainingErrors: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['fixedCode', 'explanation', 'allErrorsFixed'],
};

/**
 * Schema for test generation response
 */
export const TEST_GENERATION_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    files: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
          language: { type: 'string' },
          purpose: { type: 'string' },
          isNew: { type: 'boolean' },
          covers: {
            type: 'array',
            items: { type: 'string' },
          },
          framework: {
            type: 'string',
            enum: ['vitest', 'jest'],
          },
          testCount: { type: 'number' },
          testTypes: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['unit', 'integration', 'e2e'],
            },
          },
        },
        required: ['path', 'content', 'language', 'purpose', 'isNew', 'covers', 'framework', 'testCount', 'testTypes'],
      },
    },
    testCount: { type: 'number' },
    explanation: { type: 'string' },
  },
  required: ['files', 'testCount', 'explanation'],
};

/**
 * Schema for incident reconstruction response
 */
export const INCIDENT_RECONSTRUCTION_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    timeline: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          timestamp: { type: 'string' },
          event: { type: 'string' },
          service: { type: 'string' },
          severity: {
            type: 'string',
            enum: ['info', 'warning', 'error', 'critical'],
          },
          evidence: { type: 'string' },
          isKeyEvent: { type: 'boolean' },
        },
        required: ['timestamp', 'event', 'service', 'severity', 'evidence'],
      },
    },
    causalChain: {
      type: 'array',
      description: 'Ordered list of events in the causal chain. Each event must have both causedBy and event fields with meaningful non-empty values. For the root cause event, use "Root Cause" or "Initial Trigger" as causedBy.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for this event' },
          event: { type: 'string', description: 'Description of what happened (must not be empty)' },
          causedBy: { type: 'string', description: 'What event or condition caused this. For the first event in the chain (root cause), use "Root Cause" or "Initial Trigger". Never null or empty.' },
          causedEvents: {
            type: 'array',
            description: 'List of events directly caused by this event',
            items: { type: 'string' },
          },
          relationship: {
            type: 'string',
            description: 'Type of causal relationship',
            enum: ['direct', 'cascading', 'contributing'],
          },
        },
        required: ['id', 'event', 'causedBy', 'causedEvents', 'relationship'],
      },
    },
    rootCause: {
      type: 'object',
      properties: {
        description: { type: 'string' },
        confidence: { type: 'number' },
        evidence: {
          type: 'array',
          items: { type: 'string' },
        },
        differentFromSymptoms: { type: 'string' },
      },
      required: ['description', 'confidence', 'evidence', 'differentFromSymptoms'],
    },
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          priority: {
            type: 'string',
            enum: ['high', 'medium', 'low'],
          },
          category: {
            type: 'string',
            enum: ['prevention', 'detection', 'response', 'architecture'],
          },
          action: { type: 'string' },
          rationale: { type: 'string' },
          implementation: { type: 'string' },
        },
        required: ['priority', 'category', 'action', 'rationale', 'implementation'],
      },
    },
    narrative: { type: 'string' },
    dataQuality: {
      type: 'object',
      properties: {
        completeness: { type: 'number' },
        gaps: {
          type: 'array',
          items: { type: 'string' },
        },
        recommendations: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['completeness', 'gaps', 'recommendations'],
    },
  },
  required: ['timeline', 'causalChain', 'rootCause', 'recommendations', 'narrative', 'dataQuality'],
};

/**
 * Schema for pattern learning response
 */
export const PATTERN_LEARNING_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    patterns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['detection', 'diagnostic', 'resolution', 'prevention'],
          },
          name: { type: 'string' },
          description: { type: 'string' },
          triggerConditions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                signal: { type: 'string' },
                threshold: { type: 'string' },
                source: {
                  type: 'string',
                  enum: ['logs', 'metrics', 'events', 'visual'],
                },
              },
              required: ['signal', 'threshold', 'source'],
            },
          },
          recommendedActions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                action: { type: 'string' },
                when: { type: 'string' },
                expectedOutcome: { type: 'string' },
              },
              required: ['action', 'when', 'expectedOutcome'],
            },
          },
          confidence: { type: 'number' },
          applicability: { type: 'string' },
          exceptions: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['type', 'name', 'description', 'triggerConditions', 'recommendedActions', 'confidence', 'applicability', 'exceptions'],
      },
    },
    insights: {
      type: 'array',
      items: { type: 'string' },
    },
    improvementSuggestions: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['patterns', 'insights', 'improvementSuggestions'],
};

/**
 * Schema for AI-enhanced OpenAPI spec generation
 * 
 * This schema ensures Gemini returns a properly structured OpenAPI 3.0 spec
 * with complete security schemes, parameters, request bodies, and response schemas.
 * 
 * Note: Simplified to match JsonSchema interface limitations.
 * The actual OpenAPI spec structure is enforced by the prompt instructions.
 */
export const OPENAPI_SPEC_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    openapi: { type: 'string', description: 'OpenAPI version, should be 3.0.0' },
    info: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        version: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['title', 'version', 'description'],
    },
    paths: {
      type: 'object',
      description: 'OpenAPI paths object - keys are path strings, values are path item objects with HTTP methods',
    },
    components: {
      type: 'object',
      properties: {
        schemas: {
          type: 'object',
          description: 'Schema definitions for request/response bodies',
        },
        securitySchemes: {
          type: 'object',
          description: 'Security scheme definitions (Bearer, API Key, etc.)',
        },
      },
    },
    security: {
      type: 'array',
      description: 'Global security requirements',
      items: { type: 'object' },
    },
    tags: {
      type: 'array',
      description: 'API tags for grouping endpoints',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['name'],
      },
    },
    enhancementNotes: {
      type: 'string',
      description: 'Brief explanation of what was enhanced/added to the OpenAPI spec',
    },
  },
  required: ['openapi', 'info', 'paths'],
};

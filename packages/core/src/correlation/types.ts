/**
 * Correlation Layer Types
 * Types for multi-modal signal correlation and causal analysis
 */

import type { NormalizedLog, Metric, MetricAnomaly, InfraEvent } from '../ingestion/types.js';

// ===========================================
// Signal Types
// ===========================================

export type SignalType = 'visual' | 'log' | 'metric' | 'event';

export interface Signal {
  id: string;
  type: SignalType;
  timestamp: Date;
  source: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  data: unknown;
  confidence?: number;
}

export interface VisualSignal extends Signal {
  type: 'visual';
  data: {
    frameId: string;
    systemState: 'healthy' | 'degraded' | 'critical';
    anomalies: Array<{
      type: string;
      description: string;
      severity: string;
      location?: string;
    }>;
    metrics: Array<{
      name: string;
      value: number;
      unit: string;
      status: string;
    }>;
  };
}

export interface LogSignal extends Signal {
  type: 'log';
  data: NormalizedLog;
}

export interface MetricSignal extends Signal {
  type: 'metric';
  data: Metric | MetricAnomaly;
}

export interface EventSignal extends Signal {
  type: 'event';
  data: InfraEvent;
}

// ===========================================
// Aligned Data Types
// ===========================================

export interface TimeWindow {
  start: Date;
  end: Date;
}

export interface AlignedData {
  timestamp: Date;
  window: TimeWindow;
  visual: VisualSignal[];
  logs: LogSignal[];
  metrics: MetricSignal[];
  events: EventSignal[];
  signalCount: number;
  dominantSignalType?: SignalType;
}

// ===========================================
// Correlation Types
// ===========================================

export type CorrelationType = 'causal' | 'temporal' | 'symptomatic' | 'sequential';

export interface Correlation {
  id: string;
  timestamp: Date;
  signals: Signal[];
  type: CorrelationType;
  confidence: number;
  description: string;
  reasoning: string;
  timeSpan: {
    start: Date;
    end: Date;
    durationMs: number;
  };
}

export interface CausalChain {
  id: string;
  rootCause: Signal;
  effects: Signal[];
  intermediateSteps: Array<{
    signal: Signal;
    relationship: string;
    confidence: number;
  }>;
  confidence: number;
  reasoning: string;
  timeline: Array<{
    timestamp: Date;
    signal: Signal;
    relationship: string;
  }>;
}

// ===========================================
// Correlation Result Types
// ===========================================

export interface CorrelationResult {
  alignedData: AlignedData[];
  correlations: Correlation[];
  causalChain: CausalChain | null;
  triggerEvent: Signal | null;
  rootCauseHypotheses: Array<{
    signal: Signal;
    confidence: number;
    supporting: Signal[];
    reasoning: string;
  }>;
  summary: {
    totalSignals: number;
    timeWindows: number;
    correlationsFound: number;
    hasCausalChain: boolean;
    confidenceScore: number;
  };
}

// ===========================================
// Correlation Engine Config
// ===========================================

export interface CorrelationEngineConfig {
  windowMs: number;              // Time window for alignment (default: 30s)
  minCorrelationConfidence: number;  // Min confidence to include correlation
  maxCorrelations: number;       // Max correlations to return
  enableGeminiCorrelation: boolean;  // Use Gemini for correlation analysis
  causalityTimeThreshold: number;    // Max time for cause->effect (ms)
}

// ===========================================
// Gemini Correlation Types
// ===========================================

export interface GeminiCorrelationRequest {
  incidentId: string;
  alignedData: AlignedData[];
  previousCorrelations?: Correlation[];
  thoughtSignature?: string;
}

export interface GeminiCorrelationResponse {
  correlations: Array<{
    signalIds: string[];
    type: CorrelationType;
    confidence: number;
    description: string;
    reasoning: string;
  }>;
  rootCauseSignalId?: string;
  causalChain?: {
    steps: Array<{
      signalId: string;
      relationship: string;
      confidence: number;
    }>;
  };
  thoughtSignature?: string;
}

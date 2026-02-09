/**
 * @chronosops/core
 * OODA state machine and orchestration for ChronosOps
 */

// State machine
export * from './state-machine/index.js';

// Orchestrator
export * from './orchestrator/index.js';

// Observers
export { VideoWatcher, createVideoWatcherFromEnv } from './observers/video-watcher.js';
export type { VideoWatcherConfig, FrameForAnalysis, CapturedFrame } from './observers/video-watcher.js';

// Executors
export * from './agents/executor/index.js';

// Services
export { ConfigService, configService } from './services/config-service.js';
export type { KubernetesExecutorConfig } from './services/config-service.js';

// Detection
export * from './detection/index.js';

// ============================================
// Autonomous Components
// ============================================

// Ingestion Layer - Log, Metric, and Event processing
export * from './ingestion/index.js';

// Correlation Layer - Multi-modal signal correlation
export * from './correlation/index.js';

// Reasoning Layer - Thought state management
export * from './reasoning/index.js';

// Verification Layer - Action verification
export * from './verification/index.js';

// Timeline Layer - Investigation timeline
export * from './timeline/index.js';

// Rollback Layer - Rollback management
export * from './rollback/index.js';

// ============================================
// Self-Regenerating App Ecosystem
// ============================================

// Code Generation Pipeline
export * from './generation/index.js';

// Build Pipeline
export * from './build/index.js';

// ============================================
// Universal Intelligence
// ============================================

// Incident Reconstruction, Pattern Learning, Knowledge Base
export * from './intelligence/index.js';

// ============================================
// Code Editing and Evolution
// ============================================

// Edit Lock Management
export * from './lock/index.js';

// Code Evolution Engine
export * from './evolution/index.js';

// ============================================
// Self-Healing Integration
// ============================================

// Monitoring Configuration (auto-registration for Prometheus)
export * from './monitoring/index.js';

// ============================================
// Unified Vision Stream
// ============================================

// Vision Service - Server-side rendering & MJPEG streaming
export * from './vision/index.js';

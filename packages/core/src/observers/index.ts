/**
 * Observers Module
 * Provides observation capabilities for the OODA loop
 */

export type {
  CapturedFrame,
  FrameForAnalysis,
  VideoWatcherConfig,
} from './video-watcher.js';

export { VideoWatcher, createVideoWatcherFromEnv } from './video-watcher.js';

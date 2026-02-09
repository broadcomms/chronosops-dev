/**
 * Video Watcher
 * Fetches live dashboard frames from the screen-capture service
 * Used in the OODA loop's Observe phase for real-time monitoring
 */

import { createChildLogger } from '@chronosops/shared';

const logger = createChildLogger({ component: 'VideoWatcher' });

/**
 * Frame data from screen-capture service
 */
export interface CapturedFrame {
  id: string;
  base64: string;
  timestamp: string;
  width: number;
  height: number;
  sizeBytes: number;
}

/**
 * Frame analysis input for Gemini
 */
export interface FrameForAnalysis {
  data: string; // base64
  timestamp: Date;
  mimeType: 'image/png' | 'image/jpeg';
}

/**
 * Video watcher configuration
 */
export interface VideoWatcherConfig {
  screenCaptureUrl: string;
  pollIntervalMs: number;
  maxFramesPerBatch: number;
  enabled: boolean;
}

const DEFAULT_CONFIG: VideoWatcherConfig = {
  screenCaptureUrl: 'http://localhost:4000',
  pollIntervalMs: 10000, // Poll every 10 seconds (respects Gemini rate limits)
  maxFramesPerBatch: 5, // Batch 5 frames per API call
  enabled: true,
};

/**
 * Service status from screen-capture
 */
interface ScreenCaptureStatus {
  status: string;
  initialized: boolean;
  isCapturing: boolean;
  captureCount: number;
  bufferStats: {
    frameCount: number;
    capacity: number;
    oldestFrame: string | null;
    newestFrame: string | null;
    totalSizeBytes: number;
    avgSizeBytes: number;
  };
  lastError: string | null;
}

/**
 * VideoWatcher - Observes dashboard via screen capture
 */
export class VideoWatcher {
  private config: VideoWatcherConfig;
  private pollInterval: NodeJS.Timeout | null = null;
  private onNewFrames: ((frames: FrameForAnalysis[]) => void) | null = null;

  constructor(config: Partial<VideoWatcherConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if screen-capture service is available
   */
  async isAvailable(): Promise<boolean> {
    if (!this.config.enabled) {
      return false;
    }

    try {
      const response = await fetch(`${this.config.screenCaptureUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      const data = (await response.json()) as ScreenCaptureStatus;
      return response.ok && data.initialized && data.isCapturing;
    } catch {
      return false;
    }
  }

  /**
   * Get service status
   */
  async getStatus(): Promise<ScreenCaptureStatus | null> {
    try {
      const response = await fetch(`${this.config.screenCaptureUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return (await response.json()) as ScreenCaptureStatus;
    } catch {
      return null;
    }
  }

  /**
   * Get the latest captured frame
   */
  async getLatestFrame(): Promise<FrameForAnalysis | null> {
    try {
      const response = await fetch(`${this.config.screenCaptureUrl}/frame/latest`, {
        method: 'GET',
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        logger.error({ status: response.status }, 'Failed to get latest frame');
        return null;
      }

      const data = (await response.json()) as CapturedFrame;

      return {
        data: data.base64,
        timestamp: new Date(data.timestamp),
        mimeType: 'image/png',
      };
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Error fetching latest frame');
      return null;
    }
  }

  /**
   * Get recent frames for batch analysis
   */
  async getRecentFrames(count?: number): Promise<FrameForAnalysis[]> {
    const frameCount = count ?? this.config.maxFramesPerBatch;

    try {
      const response = await fetch(
        `${this.config.screenCaptureUrl}/frames/recent?count=${frameCount}`,
        {
          method: 'GET',
          signal: AbortSignal.timeout(15000),
        }
      );

      if (!response.ok) {
        logger.error({ status: response.status }, 'Failed to get recent frames');
        return [];
      }

      const data = (await response.json()) as { count: number; frames: CapturedFrame[] };

      return data.frames.map((frame) => ({
        data: frame.base64,
        timestamp: new Date(frame.timestamp),
        mimeType: 'image/png' as const,
      }));
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Error fetching recent frames');
      return [];
    }
  }

  /**
   * Start polling for new frames
   * Callback is invoked when new frames are available
   */
  startPolling(onNewFrames: (frames: FrameForAnalysis[]) => void): void {
    if (this.pollInterval) {
      logger.warn('Already polling');
      return;
    }

    if (!this.config.enabled) {
      logger.info('Disabled, not starting polling');
      return;
    }

    this.onNewFrames = onNewFrames;
    logger.info({ pollIntervalMs: this.config.pollIntervalMs }, 'Starting polling');

    this.pollInterval = setInterval(() => {
      void this.pollForNewFrames();
    }, this.config.pollIntervalMs);

    // Initial poll
    void this.pollForNewFrames();
  }

  /**
   * Stop polling
   */
  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.onNewFrames = null;
    logger.info('Stopped polling');
  }

  /**
   * Poll for new frames
   */
  private async pollForNewFrames(): Promise<void> {
    try {
      const frames = await this.getRecentFrames();

      if (frames.length === 0) {
        return;
      }

      // Check if we have new frames since last poll
      // For simplicity, always send frames (the OODA loop will handle deduplication)
      if (this.onNewFrames) {
        this.onNewFrames(frames);
      }
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Poll error');
    }
  }

  /**
   * Manually trigger a single frame capture
   */
  async captureNow(): Promise<FrameForAnalysis | null> {
    try {
      const response = await fetch(`${this.config.screenCaptureUrl}/capture/once`, {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        logger.error({ status: response.status }, 'Failed to capture frame');
        return null;
      }

      const data = (await response.json()) as { success: boolean; frame: CapturedFrame };

      if (!data.success) {
        return null;
      }

      return {
        data: data.frame.base64,
        timestamp: new Date(data.frame.timestamp),
        mimeType: 'image/png',
      };
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Error capturing frame');
      return null;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): VideoWatcherConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<VideoWatcherConfig>): void {
    const wasPolling = this.pollInterval !== null;
    const callback = this.onNewFrames;

    if (wasPolling) {
      this.stopPolling();
    }

    this.config = { ...this.config, ...newConfig };

    if (wasPolling && callback && this.config.enabled) {
      this.startPolling(callback);
    }
  }
}

/**
 * Create VideoWatcher from environment variables
 */
export function createVideoWatcherFromEnv(): VideoWatcher {
  return new VideoWatcher({
    screenCaptureUrl: process.env.SCREEN_CAPTURE_URL ?? 'http://localhost:4000',
    pollIntervalMs: parseInt(process.env.VIDEO_POLL_INTERVAL_MS ?? '10000', 10),
    maxFramesPerBatch: parseInt(process.env.VIDEO_MAX_FRAMES_PER_BATCH ?? '5', 10),
    enabled: process.env.VIDEO_WATCHER_ENABLED !== 'false',
  });
}

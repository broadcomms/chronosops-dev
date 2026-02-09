/**
 * Video processing types
 */

export interface VideoMetadata {
  duration: number; // seconds
  width: number;
  height: number;
  fps: number;
  codec: string;
  format: string;
  bitrate?: number;
  size?: number; // bytes
}

export interface ExtractedFrame {
  data: Buffer;
  timestamp: number; // seconds from start
  timestampDate: Date;
  width: number;
  height: number;
  index: number;
}

export interface FrameExtractionOptions {
  /** Frames per second to extract (default: 1) */
  fps?: number;
  /** Start time in seconds (default: 0) */
  startTime?: number;
  /** End time in seconds (default: video duration) */
  endTime?: number;
  /** Output format (default: 'png') */
  format?: 'png' | 'jpeg' | 'webp';
  /** JPEG/WebP quality 1-100 (default: 90) */
  quality?: number;
  /** Max width (maintains aspect ratio) */
  maxWidth?: number;
  /** Max height (maintains aspect ratio) */
  maxHeight?: number;
  /** Specific timestamps to extract (overrides fps) */
  timestamps?: number[];
}

export interface FrameExtractionResult {
  frames: ExtractedFrame[];
  metadata: VideoMetadata;
  extractionDuration: number; // ms
}

export interface VideoProcessorConfig {
  /** Path to FFmpeg binary (default: 'ffmpeg' - uses PATH) */
  ffmpegPath?: string;
  /** Path to FFprobe binary (default: 'ffprobe' - uses PATH) */
  ffprobePath?: string;
  /** Temporary directory for frame extraction */
  tempDir?: string;
  /** Default extraction options */
  defaultOptions?: Partial<FrameExtractionOptions>;
}

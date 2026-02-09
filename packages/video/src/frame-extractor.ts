/**
 * Video Frame Extractor
 * Uses FFmpeg to extract frames from dashboard recordings
 */

import ffmpeg from 'fluent-ffmpeg';
import sharp from 'sharp';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createChildLogger } from '@chronosops/shared';
import type {
  VideoMetadata,
  ExtractedFrame,
  FrameExtractionOptions,
  FrameExtractionResult,
  VideoProcessorConfig,
} from './types.js';

const DEFAULT_OPTIONS: FrameExtractionOptions = {
  fps: 1,
  startTime: 0,
  format: 'png',
  quality: 90,
};

export class FrameExtractor {
  private config: VideoProcessorConfig;
  private logger = createChildLogger({ component: 'FrameExtractor' });

  constructor(config: VideoProcessorConfig = {}) {
    this.config = config;

    // Set FFmpeg paths if provided
    if (config.ffmpegPath) {
      ffmpeg.setFfmpegPath(config.ffmpegPath);
    }
    if (config.ffprobePath) {
      ffmpeg.setFfprobePath(config.ffprobePath);
    }
  }

  /**
   * Get video metadata
   */
  async getMetadata(videoPath: string): Promise<VideoMetadata> {
    this.logger.debug('Getting video metadata', { videoPath });

    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          this.logger.error('Failed to get video metadata', err);
          reject(err);
          return;
        }

        const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
        if (!videoStream) {
          reject(new Error('No video stream found'));
          return;
        }

        const fps = this.parseFps(videoStream.r_frame_rate ?? '0/1');

        resolve({
          duration: Number(metadata.format.duration) || 0,
          width: videoStream.width ?? 0,
          height: videoStream.height ?? 0,
          fps,
          codec: videoStream.codec_name ?? 'unknown',
          format: metadata.format.format_name ?? 'unknown',
          bitrate: Number(metadata.format.bit_rate) || undefined,
          size: Number(metadata.format.size) || undefined,
        });
      });
    });
  }

  /**
   * Extract frames from video
   */
  async extractFrames(
    videoPath: string,
    options: FrameExtractionOptions = {},
    videoStartTime?: Date
  ): Promise<FrameExtractionResult> {
    const startMs = Date.now();
    const opts = { ...DEFAULT_OPTIONS, ...this.config.defaultOptions, ...options };

    this.logger.info('Extracting frames', { videoPath, options: opts });

    // Get metadata first
    const metadata = await this.getMetadata(videoPath);

    // Create temp directory for frames
    const tempDir = this.config.tempDir ?? tmpdir();
    const sessionId = randomUUID();
    const outputDir = join(tempDir, `chronosops-frames-${sessionId}`);
    await fs.mkdir(outputDir, { recursive: true });

    try {
      // Extract frames to temp directory
      await this.runExtraction(videoPath, outputDir, metadata, opts);

      // Read and process extracted frames
      const frames = await this.readExtractedFrames(
        outputDir,
        metadata,
        opts,
        videoStartTime
      );

      const extractionDuration = Date.now() - startMs;

      this.logger.info('Frame extraction complete', {
        frameCount: frames.length,
        duration: extractionDuration,
      });

      return {
        frames,
        metadata,
        extractionDuration,
      };
    } finally {
      // Cleanup temp directory
      await this.cleanup(outputDir);
    }
  }

  /**
   * Extract specific timestamps from video
   */
  async extractAtTimestamps(
    videoPath: string,
    timestamps: number[],
    options: Omit<FrameExtractionOptions, 'timestamps' | 'fps'> = {},
    videoStartTime?: Date
  ): Promise<FrameExtractionResult> {
    return this.extractFrames(
      videoPath,
      { ...options, timestamps },
      videoStartTime
    );
  }

  /**
   * Run FFmpeg extraction
   */
  private runExtraction(
    inputPath: string,
    outputDir: string,
    metadata: VideoMetadata,
    options: FrameExtractionOptions
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let command = ffmpeg(inputPath);

      // Set start and end times
      if (options.startTime && options.startTime > 0) {
        command = command.setStartTime(options.startTime);
      }

      const endTime = options.endTime ?? metadata.duration;
      if (endTime < metadata.duration) {
        command = command.setDuration(endTime - (options.startTime ?? 0));
      }

      // Build video filters
      const filters: string[] = [];

      // FPS filter (unless using specific timestamps)
      if (!options.timestamps) {
        filters.push(`fps=${options.fps}`);
      }

      // Scale filter for max dimensions
      if (options.maxWidth || options.maxHeight) {
        const width = options.maxWidth ?? -1;
        const height = options.maxHeight ?? -1;
        filters.push(`scale=${width}:${height}:force_original_aspect_ratio=decrease`);
      }

      if (filters.length > 0) {
        command = command.videoFilters(filters);
      }

      // Output format and options
      const extension = options.format ?? 'png';
      const outputPattern = join(outputDir, `frame-%04d.${extension}`);

      command = command.output(outputPattern);

      // Set format-specific options
      if (options.format === 'jpeg' || options.format === 'webp') {
        command = command.outputOptions([`-q:v ${Math.round((100 - (options.quality ?? 90)) / 3)}`]);
      }

      command
        .on('start', (cmd) => {
          this.logger.debug('FFmpeg command', { cmd });
        })
        .on('progress', (progress) => {
          this.logger.debug('Extraction progress', progress);
        })
        .on('error', (err) => {
          this.logger.error('FFmpeg error', err);
          reject(err);
        })
        .on('end', () => {
          resolve();
        })
        .run();
    });
  }

  /**
   * Read extracted frames from temp directory
   */
  private async readExtractedFrames(
    outputDir: string,
    _metadata: VideoMetadata,
    options: FrameExtractionOptions,
    videoStartTime?: Date
  ): Promise<ExtractedFrame[]> {
    const files = await fs.readdir(outputDir);
    const frameFiles = files.filter((f) => f.startsWith('frame-')).sort();

    const frames: ExtractedFrame[] = [];
    const fps = options.fps ?? 1;
    const startTime = options.startTime ?? 0;
    const baseTime = videoStartTime ?? new Date();

    for (let i = 0; i < frameFiles.length; i++) {
      const frameFile = frameFiles[i];
      if (!frameFile) continue;
      const filePath = join(outputDir, frameFile);
      const data = await fs.readFile(filePath);

      // Calculate timestamp
      let timestamp: number;
      const timestampFromOptions = options.timestamps?.[i];
      if (timestampFromOptions !== undefined) {
        timestamp = timestampFromOptions;
      } else {
        timestamp = startTime + i / fps;
      }

      // Get frame dimensions
      const imageMetadata = await sharp(data).metadata();

      frames.push({
        data,
        timestamp,
        timestampDate: new Date(baseTime.getTime() + timestamp * 1000),
        width: imageMetadata.width ?? 0,
        height: imageMetadata.height ?? 0,
        index: i,
      });
    }

    return frames;
  }

  /**
   * Parse FPS string (e.g., "30000/1001" or "30")
   */
  private parseFps(fpsString: string): number {
    if (fpsString.includes('/')) {
      const parts = fpsString.split('/').map(Number);
      const num = parts[0] ?? 0;
      const den = parts[1] ?? 1;
      return num / den;
    }
    return Number(fpsString);
  }

  /**
   * Cleanup temp directory
   */
  private async cleanup(dir: string): Promise<void> {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (err) {
      this.logger.warn('Failed to cleanup temp directory', { dir, error: (err as Error).message });
    }
  }
}

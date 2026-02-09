/**
 * Recording Service - Frame-based recording with optional video export
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { createChildLogger } from '@chronosops/shared';
import type { Recording, RecordingStatus, FrameData } from '../types.js';

const logger = createChildLogger({ component: 'RecordingService' });

/**
 * Recording Service Configuration
 */
export interface RecordingConfig {
  /** Output directory for recordings */
  outputDir: string;
  /** FPS for output video */
  fps: number;
}

const DEFAULT_CONFIG: RecordingConfig = {
  outputDir: './data/recordings',
  fps: 2,
};

/**
 * Active recording state
 */
interface ActiveRecording extends Recording {
  frames: Buffer[];
  tempDir: string;
}

/**
 * Recording Service - Manages video recordings
 */
export class RecordingService {
  private config: RecordingConfig;
  private recordings: Map<string, Recording> = new Map();
  private activeRecordings: Map<string, ActiveRecording> = new Map();

  constructor(config: Partial<RecordingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Ensure output directory exists
    fs.mkdirSync(this.config.outputDir, { recursive: true });
  }

  /**
   * Start a new recording
   */
  startRecording(serviceName: string, incidentId?: string): string {
    // Check if already recording this service
    const existingId = this.getActiveRecordingId(serviceName);
    if (existingId) {
      throw new Error(`Already recording service ${serviceName}`);
    }

    const recordingId = `rec_${Date.now()}_${serviceName.replace(/[^a-z0-9]/gi, '_')}`;
    const tempDir = path.join(this.config.outputDir, 'temp', recordingId);

    // Create temp directory
    fs.mkdirSync(tempDir, { recursive: true });

    const recording: ActiveRecording = {
      id: recordingId,
      serviceName,
      incidentId,
      startedAt: new Date(),
      frameCount: 0,
      status: 'recording',
      frames: [],
      tempDir,
    };

    this.activeRecordings.set(recordingId, recording);
    this.recordings.set(recordingId, {
      id: recordingId,
      serviceName,
      incidentId,
      startedAt: recording.startedAt,
      frameCount: 0,
      status: 'recording',
    });

    logger.info({ recordingId, serviceName }, 'Started recording');

    return recordingId;
  }

  /**
   * Add a frame to an active recording
   */
  addFrame(recordingId: string, frame: Buffer): void {
    const recording = this.activeRecordings.get(recordingId);
    if (!recording || recording.status !== 'recording') {
      return;
    }

    recording.frames.push(frame);
    recording.frameCount++;

    // Update metadata
    const metadata = this.recordings.get(recordingId);
    if (metadata) {
      metadata.frameCount = recording.frameCount;
    }
  }

  /**
   * Add a frame from FrameData
   */
  addFrameData(recordingId: string, frameData: FrameData): void {
    this.addFrame(recordingId, frameData.frame);
  }

  /**
   * Stop recording and save frames
   */
  async stopRecording(recordingId: string): Promise<Recording> {
    const recording = this.activeRecordings.get(recordingId);
    if (!recording) {
      throw new Error(`Recording ${recordingId} not found`);
    }

    if (recording.status !== 'recording') {
      throw new Error(`Recording ${recordingId} is not active`);
    }

    // Update status
    recording.status = 'processing';
    this.updateRecordingStatus(recordingId, 'processing');

    logger.info(
      { recordingId, frameCount: recording.frameCount },
      'Stopping recording, saving frames'
    );

    try {
      const outputPath = await this.processRecording(recording);

      // Update status
      recording.status = 'complete';
      recording.endedAt = new Date();

      const metadata = this.recordings.get(recordingId);
      if (metadata) {
        metadata.status = 'complete';
        metadata.endedAt = recording.endedAt;
        metadata.outputPath = outputPath;
      }

      // Clear frames from memory
      recording.frames = [];

      // Remove from active recordings
      this.activeRecordings.delete(recordingId);

      logger.info({ recordingId, outputPath }, 'Recording saved');

      return this.getRecording(recordingId)!;
    } catch (error) {
      recording.status = 'failed';
      this.updateRecordingStatus(recordingId, 'failed', (error as Error).message);

      // Cleanup
      this.cleanupTempDir(recording.tempDir);
      this.activeRecordings.delete(recordingId);

      throw error;
    }
  }

  /**
   * Process frames - save as image sequence and optionally convert to MP4
   */
  private async processRecording(recording: ActiveRecording): Promise<string> {
    // Generate output directory
    const timestamp = recording.startedAt.toISOString().replace(/[:.]/g, '-');
    const outputDirName = `${recording.serviceName}_${timestamp}`;
    const outputDir = path.join(this.config.outputDir, outputDirName);

    // Create output directory
    fs.mkdirSync(outputDir, { recursive: true });

    // Save frames as JPEG files
    for (let i = 0; i < recording.frames.length; i++) {
      const framePath = path.join(
        outputDir,
        `frame_${i.toString().padStart(6, '0')}.jpg`
      );
      fs.writeFileSync(framePath, recording.frames[i]!);
    }

    // Write metadata
    const metadataPath = path.join(outputDir, 'metadata.json');
    fs.writeFileSync(
      metadataPath,
      JSON.stringify(
        {
          id: recording.id,
          serviceName: recording.serviceName,
          incidentId: recording.incidentId,
          startedAt: recording.startedAt,
          endedAt: new Date(),
          frameCount: recording.frameCount,
          fps: this.config.fps,
        },
        null,
        2
      )
    );

    // Try to create MP4 using ffmpeg if available
    const mp4Path = path.join(this.config.outputDir, `${outputDirName}.mp4`);
    try {
      await this.createMp4(outputDir, mp4Path, recording.frameCount);
      // Cleanup frame directory if MP4 was created
      this.cleanupTempDir(outputDir);
      return mp4Path;
    } catch {
      // FFmpeg not available, return directory path
      logger.info({ outputDir }, 'FFmpeg not available, saved as frame sequence');
      return outputDir;
    }
  }

  /**
   * Create MP4 using ffmpeg command line
   */
  private createMp4(inputDir: string, outputPath: string, frameCount: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (frameCount === 0) {
        reject(new Error('No frames to encode'));
        return;
      }

      const ffmpeg = spawn('ffmpeg', [
        '-y',
        '-framerate', String(this.config.fps),
        '-i', path.join(inputDir, 'frame_%06d.jpg'),
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-preset', 'fast',
        '-crf', '23',
        outputPath,
      ]);

      let stderr = '';
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg failed: ${stderr}`));
        }
      });

      ffmpeg.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Cancel an active recording without saving
   */
  cancelRecording(recordingId: string): void {
    const recording = this.activeRecordings.get(recordingId);
    if (!recording) {
      return;
    }

    // Cleanup
    this.cleanupTempDir(recording.tempDir);
    this.activeRecordings.delete(recordingId);

    // Update metadata
    const metadata = this.recordings.get(recordingId);
    if (metadata) {
      metadata.status = 'failed';
      metadata.error = 'Recording cancelled';
    }

    logger.info({ recordingId }, 'Recording cancelled');
  }

  /**
   * Get recording metadata by ID
   */
  getRecording(recordingId: string): Recording | undefined {
    return this.recordings.get(recordingId);
  }

  /**
   * Get all recordings
   */
  listRecordings(): Recording[] {
    return Array.from(this.recordings.values());
  }

  /**
   * Get recordings for a specific service
   */
  getRecordingsByService(serviceName: string): Recording[] {
    return Array.from(this.recordings.values()).filter(
      (r) => r.serviceName === serviceName
    );
  }

  /**
   * Get recordings for a specific incident
   */
  getRecordingsByIncident(incidentId: string): Recording[] {
    return Array.from(this.recordings.values()).filter(
      (r) => r.incidentId === incidentId
    );
  }

  /**
   * Check if actively recording a service
   */
  isRecording(serviceName: string): boolean {
    return this.getActiveRecordingId(serviceName) !== undefined;
  }

  /**
   * Get active recording ID for a service
   */
  getActiveRecordingId(serviceName: string): string | undefined {
    for (const [id, recording] of this.activeRecordings.entries()) {
      if (recording.serviceName === serviceName && recording.status === 'recording') {
        return id;
      }
    }
    return undefined;
  }

  /**
   * Delete a recording and its files
   */
  deleteRecording(recordingId: string): boolean {
    const recording = this.recordings.get(recordingId);
    if (!recording) {
      return false;
    }

    // Delete output file/directory if exists
    if (recording.outputPath && fs.existsSync(recording.outputPath)) {
      const stat = fs.statSync(recording.outputPath);
      if (stat.isDirectory()) {
        fs.rmSync(recording.outputPath, { recursive: true });
      } else {
        fs.unlinkSync(recording.outputPath);
      }
    }

    // Remove from maps
    this.recordings.delete(recordingId);
    this.activeRecordings.delete(recordingId);

    return true;
  }

  /**
   * Get output path for a recording
   */
  getOutputPath(recordingId: string): string | undefined {
    return this.recordings.get(recordingId)?.outputPath;
  }

  /**
   * Update recording status
   */
  private updateRecordingStatus(
    recordingId: string,
    status: RecordingStatus,
    error?: string
  ): void {
    const metadata = this.recordings.get(recordingId);
    if (metadata) {
      metadata.status = status;
      if (error) {
        metadata.error = error;
      }
    }
  }

  /**
   * Cleanup temporary directory
   */
  private cleanupTempDir(tempDir: string): void {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true });
      }
    } catch (error) {
      logger.error({ tempDir, error }, 'Failed to cleanup temp dir');
    }
  }

  /**
   * Get recording statistics
   */
  getStats(): { total: number; active: number; completed: number; failed: number } {
    let active = 0;
    let completed = 0;
    let failed = 0;

    for (const recording of this.recordings.values()) {
      if (recording.status === 'recording' || recording.status === 'processing') {
        active++;
      } else if (recording.status === 'complete') {
        completed++;
      } else if (recording.status === 'failed') {
        failed++;
      }
    }

    return {
      total: this.recordings.size,
      active,
      completed,
      failed,
    };
  }
}

/**
 * Frame Buffer - Circular buffer for storing recent frames
 */

import type { FrameData } from '../types.js';

/**
 * Circular buffer configuration
 */
export interface FrameBufferConfig {
  /** Maximum number of frames to store */
  maxSize: number;
}

const DEFAULT_CONFIG: FrameBufferConfig = {
  maxSize: 60, // Store last 60 frames (30 seconds at 2 FPS)
};

/**
 * Circular buffer for frame storage
 */
export class FrameBuffer {
  private buffer: FrameData[] = [];
  private config: FrameBufferConfig;

  constructor(config: Partial<FrameBufferConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Add a frame to the buffer
   */
  push(frame: FrameData): void {
    this.buffer.push(frame);

    // Remove oldest frames if over capacity
    while (this.buffer.length > this.config.maxSize) {
      this.buffer.shift();
    }
  }

  /**
   * Get the latest frame
   */
  getLatest(): FrameData | undefined {
    return this.buffer[this.buffer.length - 1];
  }

  /**
   * Get the N most recent frames
   */
  getRecent(count: number): FrameData[] {
    const start = Math.max(0, this.buffer.length - count);
    return this.buffer.slice(start);
  }

  /**
   * Get all frames in the buffer
   */
  getAll(): FrameData[] {
    return [...this.buffer];
  }

  /**
   * Get frame at specific index (0 = oldest)
   */
  get(index: number): FrameData | undefined {
    return this.buffer[index];
  }

  /**
   * Get current buffer size
   */
  size(): number {
    return this.buffer.length;
  }

  /**
   * Get maximum buffer size
   */
  maxSize(): number {
    return this.config.maxSize;
  }

  /**
   * Clear all frames from the buffer
   */
  clear(): void {
    this.buffer = [];
  }

  /**
   * Get frames within a time range
   */
  getByTimeRange(startTime: Date, endTime: Date): FrameData[] {
    return this.buffer.filter(
      frame => frame.timestamp >= startTime && frame.timestamp <= endTime
    );
  }

  /**
   * Get all frame buffers (raw image data)
   */
  getFrameBuffers(): Buffer[] {
    return this.buffer.map(f => f.frame);
  }

  /**
   * Iterator support
   */
  *[Symbol.iterator](): Iterator<FrameData> {
    for (const frame of this.buffer) {
      yield frame;
    }
  }
}

/**
 * Per-service frame buffer manager
 */
export class FrameBufferManager {
  private buffers: Map<string, FrameBuffer> = new Map();
  private config: FrameBufferConfig;

  constructor(config: Partial<FrameBufferConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get or create buffer for a service
   */
  getBuffer(serviceName: string): FrameBuffer {
    let buffer = this.buffers.get(serviceName);
    if (!buffer) {
      buffer = new FrameBuffer(this.config);
      this.buffers.set(serviceName, buffer);
    }
    return buffer;
  }

  /**
   * Push frame to service buffer
   */
  push(serviceName: string, frame: FrameData): void {
    this.getBuffer(serviceName).push(frame);
  }

  /**
   * Get latest frame for service
   */
  getLatest(serviceName: string): FrameData | undefined {
    return this.buffers.get(serviceName)?.getLatest();
  }

  /**
   * Clear buffer for service
   */
  clear(serviceName: string): void {
    this.buffers.get(serviceName)?.clear();
  }

  /**
   * Clear all buffers
   */
  clearAll(): void {
    for (const buffer of this.buffers.values()) {
      buffer.clear();
    }
  }

  /**
   * Remove buffer for service
   */
  remove(serviceName: string): void {
    this.buffers.delete(serviceName);
  }

  /**
   * Get all service names
   */
  getServiceNames(): string[] {
    return Array.from(this.buffers.keys());
  }

  /**
   * Check if service has buffer
   */
  has(serviceName: string): boolean {
    return this.buffers.has(serviceName);
  }
}

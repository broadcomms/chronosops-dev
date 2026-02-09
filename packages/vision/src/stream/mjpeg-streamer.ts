/**
 * MJPEG Streamer - Multipart JPEG streaming for browser video display
 */

import EventEmitter from 'eventemitter3';
import type { ServerResponse } from 'node:http';
import { createCanvas } from '@napi-rs/canvas';
import { createChildLogger } from '@chronosops/shared';
import { FrameBufferManager } from './frame-buffer.js';
import type { FrameData, AIAnnotation, StreamClient } from '../types.js';

const logger = createChildLogger({ component: 'MJPEGStreamer' });

// Pre-generated placeholder frame cache
let placeholderFrameCache: Buffer | null = null;

/**
 * Events emitted by the MJPEG streamer
 */
export interface MJPEGStreamerEvents {
  /** Frame generated for a service */
  frame: (data: FrameData) => void;
  /** Client connected */
  clientConnected: (client: StreamClient) => void;
  /** Client disconnected */
  clientDisconnected: (clientId: string) => void;
  /** Service stream started */
  streamStarted: (serviceName: string) => void;
  /** Service stream stopped */
  streamStopped: (serviceName: string) => void;
  /** Error occurred */
  error: (error: Error) => void;
}

/**
 * MJPEG Streamer configuration
 */
export interface MJPEGStreamerConfig {
  /** Frames per second */
  fps: number;
  /** JPEG quality (0-100) */
  quality: number;
  /** Frame boundary string */
  boundary: string;
}

const DEFAULT_CONFIG: MJPEGStreamerConfig = {
  fps: 2,
  quality: 85,
  boundary: 'frame',
};

/**
 * Internal client connection
 */
interface ClientConnection extends StreamClient {
  response: ServerResponse;
  isWritable: boolean;
}

/**
 * MJPEG Streamer - Streams frames to connected clients
 */
export class MJPEGStreamer extends EventEmitter<MJPEGStreamerEvents> {
  private config: MJPEGStreamerConfig;
  private clients: Map<string, ClientConnection> = new Map();
  private frameBuffers: FrameBufferManager;
  private serviceAnnotations: Map<string, AIAnnotation[]> = new Map();
  private serviceMessages: Map<string, string> = new Map();
  private clientIdCounter: number = 0;

  constructor(config: Partial<MJPEGStreamerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.frameBuffers = new FrameBufferManager();
  }

  /**
   * Generate a placeholder "Loading..." frame for clients connecting before data is ready
   */
  private generatePlaceholderFrame(serviceName: string): Buffer {
    // Use cached placeholder if available (for performance)
    if (placeholderFrameCache) {
      return placeholderFrameCache;
    }

    const width = 1280;
    const height = 720;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Dark background
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, width, height);

    // Subtle grid pattern
    ctx.strokeStyle = 'rgba(48, 54, 61, 0.5)';
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Loading spinner circles
    const centerX = width / 2;
    const centerY = height / 2 - 40;
    const numDots = 8;
    const radius = 40;
    const dotRadius = 6;
    const time = Date.now() / 200;

    for (let i = 0; i < numDots; i++) {
      const angle = (i / numDots) * Math.PI * 2 - Math.PI / 2;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      const alpha = (Math.sin(time + i * 0.5) + 1) / 2 * 0.8 + 0.2;

      ctx.fillStyle = `rgba(88, 166, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Loading text
    ctx.fillStyle = '#8b949e';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Loading Dashboard...', centerX, centerY + 50);

    // Service name
    ctx.fillStyle = '#58a6ff';
    ctx.font = '16px Arial';
    ctx.fillText(serviceName, centerX, centerY + 85);

    // Info text
    ctx.fillStyle = '#6e7681';
    ctx.font = '14px Arial';
    ctx.fillText('Fetching metrics from Prometheus...', centerX, centerY + 120);

    // ChronosOps branding
    ctx.fillStyle = '#30363d';
    ctx.font = 'bold 12px Arial';
    ctx.fillText('ChronosOps Vision', centerX, height - 20);

    // Cache the frame for reuse (without service name for caching simplicity)
    const buffer = canvas.toBuffer('image/jpeg', this.config.quality);
    placeholderFrameCache = buffer;

    return buffer;
  }

  /**
   * Add a new streaming client
   */
  addClient(response: ServerResponse, serviceName: string): string {
    const clientId = `client_${++this.clientIdCounter}_${Date.now()}`;

    // Set MJPEG headers
    response.writeHead(200, {
      'Content-Type': `multipart/x-mixed-replace; boundary=${this.config.boundary}`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const client: ClientConnection = {
      id: clientId,
      serviceName,
      connectedAt: new Date(),
      response,
      isWritable: true,
    };

    this.clients.set(clientId, client);

    // Handle client disconnect
    response.on('close', () => {
      this.removeClient(clientId);
    });

    response.on('error', () => {
      this.removeClient(clientId);
    });

    this.emit('clientConnected', {
      id: clientId,
      serviceName,
      connectedAt: client.connectedAt,
    });

    logger.info({ clientId, serviceName }, 'Client connected to stream');

    // Send the latest frame immediately if available, otherwise send placeholder
    const latestFrame = this.frameBuffers.getLatest(serviceName);
    if (latestFrame) {
      this.sendFrameToClient(client, latestFrame.frame);
    } else {
      // No frame available yet - send a loading placeholder
      // This prevents the browser from showing nothing/error while waiting
      logger.debug({ clientId, serviceName }, 'No frames available, sending placeholder');
      const placeholder = this.generatePlaceholderFrame(serviceName);
      this.sendFrameToClient(client, placeholder);
    }

    return clientId;
  }

  /**
   * Remove a streaming client
   */
  removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.isWritable = false;
      this.clients.delete(clientId);

      this.emit('clientDisconnected', clientId);
      logger.info({ clientId }, 'Client disconnected');

      // End the response
      try {
        client.response.end();
      } catch {
        // Response may already be closed
      }
    }
  }

  /**
   * Broadcast a frame to all clients watching a service
   */
  broadcastFrame(serviceName: string, frameData: FrameData): void {
    // Store in buffer
    this.frameBuffers.push(serviceName, frameData);

    // Emit frame event for recording and analysis
    this.emit('frame', frameData);

    // Send to all clients watching this service
    for (const client of this.clients.values()) {
      if (client.serviceName === serviceName && client.isWritable) {
        this.sendFrameToClient(client, frameData.frame);
      }
    }
  }

  /**
   * Send a frame to a specific client
   */
  private sendFrameToClient(client: ClientConnection, frame: Buffer): void {
    try {
      if (!client.isWritable) return;

      const header = [
        `--${this.config.boundary}`,
        'Content-Type: image/jpeg',
        `Content-Length: ${frame.length}`,
        '',
        '',
      ].join('\r\n');

      client.response.write(header);
      client.response.write(frame);
      client.response.write('\r\n');
    } catch (error) {
      // Client disconnected, mark as not writable
      client.isWritable = false;
      this.removeClient(client.id);
    }
  }

  /**
   * Set AI annotations for a service
   */
  setAnnotations(serviceName: string, annotations: AIAnnotation[]): void {
    this.serviceAnnotations.set(serviceName, annotations);
  }

  /**
   * Get current annotations for a service
   */
  getAnnotations(serviceName: string): AIAnnotation[] {
    return this.serviceAnnotations.get(serviceName) || [];
  }

  /**
   * Clear annotations for a service
   */
  clearAnnotations(serviceName: string): void {
    this.serviceAnnotations.delete(serviceName);
  }

  /**
   * Set AI message for a service
   */
  setAIMessage(serviceName: string, message: string): void {
    this.serviceMessages.set(serviceName, message);
  }

  /**
   * Get current AI message for a service
   */
  getAIMessage(serviceName: string): string | undefined {
    return this.serviceMessages.get(serviceName);
  }

  /**
   * Clear AI message for a service
   */
  clearAIMessage(serviceName: string): void {
    this.serviceMessages.delete(serviceName);
  }

  /**
   * Get frame buffer for a service
   */
  getFrameBuffer(serviceName: string): Buffer[] {
    return this.frameBuffers.getBuffer(serviceName).getFrameBuffers();
  }

  /**
   * Get latest frame for a service
   */
  getLatestFrame(serviceName: string): FrameData | undefined {
    return this.frameBuffers.getLatest(serviceName);
  }

  /**
   * Get recent frames for a service
   */
  getRecentFrames(serviceName: string, count: number): FrameData[] {
    return this.frameBuffers.getBuffer(serviceName).getRecent(count);
  }

  /**
   * Get connected client count
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get clients for a specific service
   */
  getServiceClients(serviceName: string): StreamClient[] {
    return Array.from(this.clients.values())
      .filter(c => c.serviceName === serviceName)
      .map(({ id, serviceName, connectedAt }) => ({ id, serviceName, connectedAt }));
  }

  /**
   * Get all connected services
   */
  getConnectedServices(): string[] {
    const services = new Set<string>();
    for (const client of this.clients.values()) {
      services.add(client.serviceName);
    }
    return Array.from(services);
  }

  /**
   * Clear frame buffer for a service
   */
  clearFrameBuffer(serviceName: string): void {
    this.frameBuffers.clear(serviceName);
  }

  /**
   * Get FPS configuration
   */
  getFps(): number {
    return this.config.fps;
  }

  /**
   * Close all connections
   */
  close(): void {
    for (const clientId of this.clients.keys()) {
      this.removeClient(clientId);
    }
  }
}

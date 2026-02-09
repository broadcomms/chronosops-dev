/**
 * Frame Compositor - Combines dashboard, annotations, and overlays into a single frame
 */

import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';

type CanvasRenderingContext2D = SKRSContext2D;
import { renderServiceDashboard } from '../chart/chart-renderer.js';
import { drawAnnotations } from './ai-annotations.js';
import type { CompositorConfig, ServiceMetrics, AIAnnotation } from '../types.js';

const DEFAULT_CONFIG: CompositorConfig = {
  width: 1280,
  height: 720,
  fps: 2,
  showTimestamp: true,
  showRecordingIndicator: true,
  quality: 85,
};

/**
 * Frame Compositor - Creates unified vision frames
 */
export class FrameCompositor {
  private config: CompositorConfig;
  private frameCount: number = 0;
  private isRecording: boolean = false;
  private recordingStartTime: Date | null = null;

  constructor(config: Partial<CompositorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Composite a complete frame with dashboard, annotations, and overlays
   */
  async compositeFrame(
    metrics: ServiceMetrics,
    annotations: AIAnnotation[] = [],
    aiMessage?: string
  ): Promise<Buffer> {
    const canvas = createCanvas(this.config.width, this.config.height);
    const ctx = canvas.getContext('2d');

    // 1. Draw background
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, this.config.width, this.config.height);

    // 2. Draw main dashboard (no header bar needed)
    const dashboardHeight = this.config.height - 20 - (aiMessage ? 60 : 0);
    const dashboard = renderServiceDashboard(metrics, {
      width: this.config.width - 20,
      height: dashboardHeight,
    });
    ctx.drawImage(dashboard, 10, 10);

    // 3. Draw health status badge in top-right corner
    this.drawHealthBadge(ctx, metrics.healthStatus);

    // 4. Draw AI annotations on top
    if (annotations.length > 0) {
      // Offset annotations to account for padding
      const offsetAnnotations = annotations.map(a => ({
        ...a,
        position: {
          x: a.position.x + 10,
          y: a.position.y + 10,
        },
      }));
      drawAnnotations(ctx, offsetAnnotations);
    }

    // 5. Draw timestamp
    if (this.config.showTimestamp) {
      this.drawTimestamp(ctx);
    }

    // 6. Draw recording indicator
    if (this.isRecording && this.config.showRecordingIndicator) {
      this.drawRecordingIndicator(ctx);
    }

    // 7. Draw AI message bar at bottom
    if (aiMessage) {
      this.drawAIMessageBar(ctx, aiMessage);
    }

    this.frameCount++;

    // Return as JPEG buffer (quality is 0-100)
    return canvas.toBuffer('image/jpeg', this.config.quality);
  }

  /**
   * Draw a health status badge centered in the empty space of the side panel
   */
  private drawHealthBadge(
    ctx: CanvasRenderingContext2D,
    status: 'healthy' | 'degraded' | 'critical' | 'unknown'
  ): void {
    const statusConfig = {
      healthy: { color: '#3fb950', bgColor: 'rgba(63, 185, 80, 0.25)', text: 'HEALTHY' },
      degraded: { color: '#d29922', bgColor: 'rgba(210, 153, 34, 0.25)', text: 'DEGRADED' },
      critical: { color: '#f85149', bgColor: 'rgba(248, 81, 73, 0.25)', text: 'CRITICAL' },
      unknown: { color: '#8b949e', bgColor: 'rgba(139, 148, 158, 0.25)', text: 'UNKNOWN' },
    };

    const config = statusConfig[status];
    const badgeWidth = 130;
    const badgeHeight = 40;
    // Position in the side panel area (right 25% of screen), centered in the empty space below stats
    const sidePanelX = this.config.width * 0.75 + 10;
    const sidePanelWidth = this.config.width * 0.25 - 30;
    const badgeX = sidePanelX + (sidePanelWidth - badgeWidth) / 2;
    // Position badge in the lower portion of the side panel (below the stats list)
    const badgeY = this.config.height * 0.65;

    // Badge background with rounded corners
    ctx.fillStyle = config.bgColor;
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, 10);
    ctx.fill();

    // Badge border with glow
    ctx.shadowColor = config.color;
    ctx.shadowBlur = 10;
    ctx.strokeStyle = config.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Status dot with glow
    ctx.shadowColor = config.color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = config.color;
    ctx.beginPath();
    ctx.arc(badgeX + 22, badgeY + badgeHeight / 2, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Status text
    ctx.fillStyle = config.color;
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(config.text, badgeX + 40, badgeY + badgeHeight / 2 + 6);
  }

  /**
   * Draw timestamp overlay
   */
  private drawTimestamp(ctx: CanvasRenderingContext2D): void {
    const now = new Date();
    const timestamp = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

    // Background
    ctx.fillStyle = 'rgba(13, 17, 23, 0.8)';
    ctx.font = '12px monospace';
    const textWidth = ctx.measureText(timestamp).width;
    ctx.fillRect(this.config.width - textWidth - 20, this.config.height - 35, textWidth + 10, 20);

    // Text
    ctx.fillStyle = '#8b949e';
    ctx.textAlign = 'right';
    ctx.fillText(timestamp, this.config.width - 15, this.config.height - 20);
    ctx.textAlign = 'left';
  }

  /**
   * Draw recording indicator
   */
  private drawRecordingIndicator(ctx: CanvasRenderingContext2D): void {
    const x = 20;
    const y = this.config.height - 35;

    // Background
    ctx.fillStyle = 'rgba(218, 54, 51, 0.9)';
    ctx.beginPath();
    ctx.roundRect(x, y, 100, 24, 4);
    ctx.fill();

    // Blinking red dot
    const blink = Math.floor(this.frameCount / 2) % 2 === 0;
    if (blink) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x + 14, y + 12, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Recording text with duration
    let text = 'REC';
    if (this.recordingStartTime) {
      const duration = Math.floor((Date.now() - this.recordingStartTime.getTime()) / 1000);
      const minutes = Math.floor(duration / 60).toString().padStart(2, '0');
      const seconds = (duration % 60).toString().padStart(2, '0');
      text = `REC ${minutes}:${seconds}`;
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(text, x + 26, y + 16);
  }

  /**
   * Draw AI message bar at the bottom
   */
  private drawAIMessageBar(ctx: CanvasRenderingContext2D, message: string): void {
    const barHeight = 55;
    const y = this.config.height - barHeight;

    // Background
    ctx.fillStyle = 'rgba(22, 27, 34, 0.95)';
    ctx.fillRect(0, y, this.config.width, barHeight);

    // Top border
    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(this.config.width, y);
    ctx.stroke();

    // AI icon background
    ctx.fillStyle = '#238636';
    ctx.beginPath();
    ctx.roundRect(15, y + 12, 32, 32, 6);
    ctx.fill();

    // AI text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('AI', 31, y + 34);
    ctx.textAlign = 'left';

    // Message
    ctx.fillStyle = '#e6edf3';
    ctx.font = '14px Arial';

    // Truncate message if too long
    const maxWidth = this.config.width - 80;
    let displayMessage = message;
    while (ctx.measureText(displayMessage).width > maxWidth && displayMessage.length > 0) {
      displayMessage = displayMessage.slice(0, -1);
    }
    if (displayMessage !== message) {
      displayMessage = displayMessage.slice(0, -3) + '...';
    }

    ctx.fillText(displayMessage, 58, y + 34);
  }

  /**
   * Start recording mode
   */
  startRecording(): void {
    this.isRecording = true;
    this.recordingStartTime = new Date();
  }

  /**
   * Stop recording mode
   */
  stopRecording(): void {
    this.isRecording = false;
    this.recordingStartTime = null;
  }

  /**
   * Check if currently recording
   */
  getIsRecording(): boolean {
    return this.isRecording;
  }

  /**
   * Get current frame count
   */
  getFrameCount(): number {
    return this.frameCount;
  }

  /**
   * Reset frame counter
   */
  resetFrameCount(): void {
    this.frameCount = 0;
  }

  /**
   * Get configuration
   */
  getConfig(): CompositorConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CompositorConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

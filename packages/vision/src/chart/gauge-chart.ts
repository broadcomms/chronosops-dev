/**
 * Gauge Chart Renderer - Renders single values with status indicators
 */

import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';

type CanvasRenderingContext2D = SKRSContext2D;

export interface GaugeConfig {
  width: number;
  height: number;
  backgroundColor: string;
  textColor: string;
  padding: number;
}

export interface GaugeOptions extends Partial<GaugeConfig> {
  /** Title text */
  title: string;
  /** Current value */
  value: number;
  /** Unit suffix */
  unit?: string;
  /** Maximum value for percentage calculation */
  maxValue?: number;
  /** Warning threshold */
  warningThreshold?: number;
  /** Critical threshold */
  criticalThreshold?: number;
  /** Color mapping */
  colors?: {
    normal: string;
    warning: string;
    critical: string;
  };
  /** Show as percentage bar */
  showBar?: boolean;
  /** Format as percentage */
  formatAsPercent?: boolean;
}

const DEFAULT_GAUGE_CONFIG: GaugeConfig = {
  width: 150,
  height: 80,
  backgroundColor: '#161b22',
  textColor: '#8b949e',
  padding: 10,
};

const DEFAULT_COLORS = {
  normal: '#3fb950',
  warning: '#d29922',
  critical: '#f85149',
};

/**
 * Renders a gauge/stat panel
 */
export function renderGauge(options: GaugeOptions): Canvas {
  const config: GaugeConfig = { ...DEFAULT_GAUGE_CONFIG, ...options };
  const colors = { ...DEFAULT_COLORS, ...options.colors };

  const canvas = createCanvas(config.width, config.height);
  const ctx = canvas.getContext('2d');

  // Draw background
  ctx.fillStyle = config.backgroundColor;
  ctx.fillRect(0, 0, config.width, config.height);

  // Draw title
  ctx.fillStyle = config.textColor;
  ctx.font = '11px Arial';
  ctx.textAlign = 'left';
  ctx.fillText(options.title, config.padding, 18);

  // Determine status color
  const statusColor = getStatusColor(options.value, options, colors);

  // Format value
  const displayValue = formatGaugeValue(options.value, options);

  // Draw main value
  ctx.fillStyle = statusColor;
  ctx.font = 'bold 24px Arial';
  ctx.textAlign = 'left';
  ctx.fillText(displayValue, config.padding, 50);

  // Draw unit if provided
  if (options.unit) {
    ctx.font = '12px Arial';
    ctx.fillStyle = config.textColor;
    const valueWidth = ctx.measureText(displayValue).width;
    ctx.fillText(options.unit, config.padding + valueWidth + 4, 50);
  }

  // Draw progress bar if enabled
  if (options.showBar && options.maxValue) {
    drawProgressBar(ctx, options.value, options.maxValue, statusColor, config);
  }

  return canvas;
}

/**
 * Renders a status indicator (healthy/degraded/critical)
 */
export function renderStatusIndicator(
  status: 'healthy' | 'degraded' | 'critical' | 'unknown',
  options: { width?: number; height?: number; label?: string } = {}
): Canvas {
  const width = options.width || 120;
  const height = options.height || 40;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#161b22';
  ctx.fillRect(0, 0, width, height);

  // Status colors and icons
  const statusConfig = {
    healthy: { color: '#3fb950', icon: '●', text: 'Healthy' },
    degraded: { color: '#d29922', icon: '●', text: 'Degraded' },
    critical: { color: '#f85149', icon: '●', text: 'Critical' },
    unknown: { color: '#8b949e', icon: '○', text: 'Unknown' },
  };

  const { color, icon, text } = statusConfig[status];

  // Draw status dot
  ctx.fillStyle = color;
  ctx.font = '18px Arial';
  ctx.textAlign = 'left';
  ctx.fillText(icon, 10, 28);

  // Draw status text
  ctx.fillStyle = '#e6edf3';
  ctx.font = 'bold 14px Arial';
  ctx.fillText(options.label || text, 32, 26);

  return canvas;
}

/**
 * Renders a pod count indicator
 */
export function renderPodCount(
  count: number,
  options: { width?: number; height?: number; label?: string } = {}
): Canvas {
  const width = options.width || 100;
  const height = options.height || 60;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#161b22';
  ctx.fillRect(0, 0, width, height);

  // Label
  ctx.fillStyle = '#8b949e';
  ctx.font = '10px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(options.label || 'Pods', width / 2, 15);

  // Count
  ctx.fillStyle = '#58a6ff';
  ctx.font = 'bold 28px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(count.toString(), width / 2, 48);

  return canvas;
}

function getStatusColor(
  value: number,
  options: GaugeOptions,
  colors: typeof DEFAULT_COLORS
): string {
  // Handle NaN and Infinity - show as unknown/gray
  if (value === undefined || value === null || isNaN(value) || !isFinite(value)) {
    return '#8b949e'; // Gray for unknown
  }
  if (options.criticalThreshold !== undefined && value >= options.criticalThreshold) {
    return colors.critical;
  }
  if (options.warningThreshold !== undefined && value >= options.warningThreshold) {
    return colors.warning;
  }
  return colors.normal;
}

function formatGaugeValue(value: number, options: GaugeOptions): string {
  // Handle NaN, Infinity, and undefined values
  if (value === undefined || value === null || isNaN(value) || !isFinite(value)) {
    return 'N/A';
  }

  if (options.formatAsPercent) {
    return `${Math.round(value)}%`;
  }

  if (value >= 1000000) {
    return (value / 1000000).toFixed(1) + 'M';
  }
  if (value >= 1000) {
    return (value / 1000).toFixed(1) + 'K';
  }
  if (Number.isInteger(value)) {
    return value.toString();
  }
  return value.toFixed(1);
}

function drawProgressBar(
  ctx: CanvasRenderingContext2D,
  value: number,
  maxValue: number,
  color: string,
  config: GaugeConfig
): void {
  const barY = config.height - 15;
  const barHeight = 6;
  const barWidth = config.width - config.padding * 2;
  const fillWidth = Math.min((value / maxValue) * barWidth, barWidth);

  // Background bar
  ctx.fillStyle = '#30363d';
  ctx.fillRect(config.padding, barY, barWidth, barHeight);

  // Fill bar
  ctx.fillStyle = color;
  ctx.fillRect(config.padding, barY, fillWidth, barHeight);
}

export interface CircularGaugeOptions {
  value: number;
  maxValue: number;
  size: number;
  title: string;
  unit?: string;
  color: string;
  trackColor: string;
}

/**
 * Renders a modern circular gauge with gradient and glow effects
 * Returns a canvas that can be drawn onto the main dashboard
 */
export function renderCircularGauge(options: CircularGaugeOptions): Canvas {
  const { value, maxValue, size, title, unit, color, trackColor } = options;
  
  const canvas = createCanvas(size, size + 20);
  const ctx = canvas.getContext('2d');

  // Handle NaN and division by zero
  const percentage = (isNaN(value) || isNaN(maxValue) || maxValue === 0)
    ? 0
    : Math.min(value / maxValue, 1);
  const centerX = size / 2;
  const centerY = size / 2;
  const radius = size / 2 - 12;
  const lineWidth = 8;

  // Draw background track
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.strokeStyle = trackColor;
  ctx.lineWidth = lineWidth;
  ctx.stroke();

  // Draw progress arc with glow
  if (percentage > 0) {
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + (Math.PI * 2 * percentage);

    // Glow effect
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();

    // Draw end cap dot
    const endX = centerX + radius * Math.cos(endAngle);
    const endY = centerY + radius * Math.sin(endAngle);
    ctx.beginPath();
    ctx.arc(endX, endY, lineWidth / 2 + 2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  // Draw center value
  // Handle NaN and Infinity values gracefully
  let displayValue: string;
  if (value === undefined || value === null || isNaN(value) || !isFinite(value)) {
    displayValue = 'N/A';
  } else {
    displayValue = value >= 100 ? Math.round(value).toString() : value.toFixed(1);
  }
  const valueText = unit && displayValue !== 'N/A' ? `${displayValue}${unit}` : displayValue;

  ctx.fillStyle = '#e6edf3';
  ctx.font = `bold ${size / 4}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(valueText, centerX, centerY);

  // Draw label below the gauge
  ctx.fillStyle = '#7d8590';
  ctx.font = `${size / 8}px Arial`;
  ctx.textBaseline = 'top';
  ctx.fillText(title, centerX, size + 4);

  return canvas;
}


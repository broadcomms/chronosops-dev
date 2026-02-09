/**
 * Line Chart Renderer - Modern time series visualization
 * Premium design with gradients, smooth curves, and glow effects
 */

import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';

type CanvasRenderingContext2D = SKRSContext2D;
import type { ChartConfig, MetricSeries, MetricValue } from '../types.js';

const DEFAULT_CHART_CONFIG: ChartConfig = {
  width: 300,
  height: 150,
  backgroundColor: '#12171f',
  gridColor: '#1e2733',
  textColor: '#7d8590',
  lineColor: '#58a6ff',
  lineWidth: 2.5,
  padding: { top: 35, right: 18, bottom: 28, left: 55 },
  showGrid: true,
  showLabels: true,
};

export interface LineChartOptions extends Partial<ChartConfig> {
  /** Chart title */
  title?: string;
  /** Line color */
  lineColor?: string;
  /** Fill area under line */
  fill?: boolean;
  /** Fill color (with alpha) */
  fillColor?: string;
  /** Show current value */
  showCurrentValue?: boolean;
  /** Unit suffix (e.g., '%', 'ms', 'req/s') */
  unit?: string;
  /** Threshold for warning color */
  warningThreshold?: number;
  /** Threshold for critical color */
  criticalThreshold?: number;
  /** Warning color */
  warningColor?: string;
  /** Critical color */
  criticalColor?: string;
  /** Border radius for panel */
  borderRadius?: number;
}

/**
 * Draw a rounded rectangle
 */
function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Renders a line chart from metric series data with modern styling
 */
export function renderLineChart(
  series: MetricSeries,
  options: LineChartOptions = {}
): Canvas {
  const config: ChartConfig = { ...DEFAULT_CHART_CONFIG, ...options };
  const borderRadius = options.borderRadius || 12;
  const canvas = createCanvas(config.width, config.height);
  const ctx = canvas.getContext('2d');

  // Draw rounded background with border
  drawRoundedRect(ctx, 0, 0, config.width, config.height, borderRadius);
  ctx.fillStyle = config.backgroundColor;
  ctx.fill();
  ctx.strokeStyle = '#1e2733';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Draw title if provided
  if (options.title) {
    drawTitle(ctx, options.title, config);
  }

  // Calculate chart area
  const chartArea = {
    x: config.padding.left,
    y: config.padding.top,
    width: config.width - config.padding.left - config.padding.right,
    height: config.height - config.padding.top - config.padding.bottom,
  };

  // Draw grid with gradient fade
  if (config.showGrid) {
    drawGrid(ctx, chartArea, config);
  }

  // Draw Y-axis labels
  if (config.showLabels) {
    drawYAxisLabels(ctx, chartArea, series, config, options.unit);
  }

  // Get line color based on thresholds
  const lineColor = getLineColor(series.current, options);

  // Fill area under line first (so line is on top)
  if (options.fill) {
    drawGradientFill(ctx, chartArea, series.values, series.min, series.max, lineColor);
  }

  // Draw the line with smooth curves and glow
  drawSmoothLine(ctx, chartArea, series.values, series.min, series.max, lineColor, config.lineWidth);

  // Draw current value with badge
  if (options.showCurrentValue) {
    drawCurrentValue(ctx, series.current, config, options.unit, lineColor);
  }

  return canvas;
}

function drawTitle(ctx: CanvasRenderingContext2D, title: string, config: ChartConfig): void {
  ctx.fillStyle = '#7d8590';
  ctx.font = 'bold 13px Arial';
  ctx.textAlign = 'left';
  ctx.fillText(title, config.padding.left, 22);
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  area: { x: number; y: number; width: number; height: number },
  config: ChartConfig
): void {
  // Use subtle gradient lines
  ctx.strokeStyle = config.gridColor;
  ctx.lineWidth = 0.5;

  // Horizontal grid lines (5 lines) with varying opacity
  for (let i = 0; i <= 4; i++) {
    const y = area.y + (area.height / 4) * i;
    ctx.globalAlpha = i === 2 ? 0.4 : 0.2; // Middle line slightly more visible
    ctx.beginPath();
    ctx.moveTo(area.x, y);
    ctx.lineTo(area.x + area.width, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Draw baseline with accent
  ctx.strokeStyle = '#2d333b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(area.x, area.y + area.height);
  ctx.lineTo(area.x + area.width, area.y + area.height);
  ctx.stroke();
}

function drawYAxisLabels(
  ctx: CanvasRenderingContext2D,
  area: { x: number; y: number; width: number; height: number },
  series: MetricSeries,
  _config: ChartConfig,
  unit?: string
): void {
  ctx.fillStyle = '#484f58';
  ctx.font = '10px Arial';
  ctx.textAlign = 'right';

  const range = series.max - series.min || 1;
  const suffix = unit || '';

  for (let i = 0; i <= 4; i++) {
    const y = area.y + (area.height / 4) * i;
    const value = series.max - (range / 4) * i;
    const label = formatValue(value) + suffix;
    ctx.fillText(label, area.x - 8, y + 3);
  }
}

/**
 * Draw smooth line with bezier curves and glow effect
 */
function drawSmoothLine(
  ctx: CanvasRenderingContext2D,
  area: { x: number; y: number; width: number; height: number },
  values: MetricValue[],
  min: number,
  max: number,
  color: string,
  lineWidth: number
): void {
  if (values.length < 2) return;

  const range = max - min || 1;
  const points: { x: number; y: number }[] = [];

  // Calculate points
  for (let i = 0; i < values.length; i++) {
    const x = area.x + (area.width / (values.length - 1)) * i;
    const normalizedValue = (values[i]!.value - min) / range;
    const y = area.y + area.height - normalizedValue * area.height;
    points.push({ x, y });
  }

  // Draw glow effect
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);

  // Use bezier curves for smooth line
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const cpx = (prev.x + curr.x) / 2;
    ctx.quadraticCurveTo(prev.x, prev.y, cpx, (prev.y + curr.y) / 2);
  }
  
  // Connect to last point
  const last = points[points.length - 1]!;
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
  ctx.restore();

  // Draw dot at current value (last point)
  ctx.beginPath();
  ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#12171f';
  ctx.lineWidth = 2;
  ctx.stroke();
}

/**
 * Draw gradient fill under the line
 */
function drawGradientFill(
  ctx: CanvasRenderingContext2D,
  area: { x: number; y: number; width: number; height: number },
  values: MetricValue[],
  min: number,
  max: number,
  color: string
): void {
  if (values.length < 2) return;

  const range = max - min || 1;
  const points: { x: number; y: number }[] = [];

  for (let i = 0; i < values.length; i++) {
    const x = area.x + (area.width / (values.length - 1)) * i;
    const normalizedValue = (values[i]!.value - min) / range;
    const y = area.y + area.height - normalizedValue * area.height;
    points.push({ x, y });
  }

  // Create gradient fill
  const gradient = ctx.createLinearGradient(0, area.y, 0, area.y + area.height);
  gradient.addColorStop(0, hexToRgba(color, 0.25));
  gradient.addColorStop(0.5, hexToRgba(color, 0.1));
  gradient.addColorStop(1, hexToRgba(color, 0.02));

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(area.x, area.y + area.height);

  // Draw smooth path
  for (let i = 0; i < points.length; i++) {
    if (i === 0) {
      ctx.lineTo(points[i]!.x, points[i]!.y);
    } else {
      const prev = points[i - 1]!;
      const curr = points[i]!;
      const cpx = (prev.x + curr.x) / 2;
      ctx.quadraticCurveTo(prev.x, prev.y, cpx, (prev.y + curr.y) / 2);
    }
  }
  
  const last = points[points.length - 1]!;
  ctx.lineTo(last.x, last.y);
  ctx.lineTo(area.x + area.width, area.y + area.height);
  ctx.closePath();
  ctx.fill();
}

function drawCurrentValue(
  ctx: CanvasRenderingContext2D,
  value: number,
  config: ChartConfig,
  unit?: string,
  color?: string
): void {
  const text = formatValue(value) + (unit || '');
  ctx.fillStyle = color || '#e6edf3';
  ctx.font = 'bold 16px Arial';
  ctx.textAlign = 'right';
  ctx.fillText(text, config.width - config.padding.right, 22);
}

function getLineColor(current: number, options: LineChartOptions): string {
  if (options.criticalThreshold !== undefined && current >= options.criticalThreshold) {
    return options.criticalColor || '#f85149';
  }
  if (options.warningThreshold !== undefined && current >= options.warningThreshold) {
    return options.warningColor || '#d29922';
  }
  return options.lineColor || DEFAULT_CHART_CONFIG.lineColor;
}

/**
 * Convert hex color to rgba
 */
function hexToRgba(hex: string, alpha: number): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result) {
    const r = parseInt(result[1]!, 16);
    const g = parseInt(result[2]!, 16);
    const b = parseInt(result[3]!, 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return hex;
}

function formatValue(value: number): string {
  if (value >= 1000000) {
    return (value / 1000000).toFixed(1) + 'M';
  }
  if (value >= 1000) {
    return (value / 1000).toFixed(1) + 'K';
  }
  if (value < 0.01 && value > 0) {
    return value.toExponential(1);
  }
  if (Number.isInteger(value)) {
    return value.toString();
  }
  return value.toFixed(2);
}

/**
 * Chart Renderer - Premium Dashboard Layout
 * Renders a beautiful, modern dashboard for AI Vision and frontend streaming
 */

import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import { renderLineChart } from './line-chart.js';
import { renderCircularGauge } from './gauge-chart.js';
import type { ServiceMetrics } from '../types.js';

type CanvasContext = SKRSContext2D;

export interface DashboardConfig {
  /** Total width */
  width: number;
  /** Total height */
  height: number;
  /** Background color */
  backgroundColor: string;
  /** Panel background color */
  panelBackgroundColor: string;
  /** Grid gap between panels */
  gridGap: number;
  /** Outer padding */
  padding: number;
  /** Border radius for panels */
  borderRadius: number;
}

const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = {
  width: 1240,
  height: 560,
  backgroundColor: '#0a0e14',
  panelBackgroundColor: '#12171f',
  gridGap: 10,
  padding: 12,
  borderRadius: 12,
};

// Premium color palette
const COLORS = {
  background: '#0a0e14',
  panelBg: '#12171f',
  panelBorder: '#1e2733',
  text: {
    primary: '#e6edf3',
    secondary: '#7d8590',
    muted: '#484f58',
  },
  accent: {
    blue: '#58a6ff',
    purple: '#a371f7',
    green: '#3fb950',
    yellow: '#d29922',
    red: '#f85149',
    cyan: '#39c5cf',
  },
  gradients: {
    blue: ['#1158c7', '#58a6ff'],
    purple: ['#6e40c9', '#a371f7'],
    green: ['#238636', '#3fb950'],
    red: ['#b62324', '#f85149'],
  },
};

/**
 * Draw a rounded rectangle with optional gradient border
 */
function drawRoundedRect(
  ctx: CanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fillColor: string,
  borderColor?: string,
  borderWidth: number = 1
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

  ctx.fillStyle = fillColor;
  ctx.fill();

  if (borderColor) {
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = borderWidth;
    ctx.stroke();
  }
}

/**
 * Renders a complete service dashboard with premium design
 */
export function renderServiceDashboard(
  metrics: ServiceMetrics,
  config: Partial<DashboardConfig> = {}
): Canvas {
  const dashConfig: DashboardConfig = { ...DEFAULT_DASHBOARD_CONFIG, ...config };
  const canvas = createCanvas(dashConfig.width, dashConfig.height);
  const ctx = canvas.getContext('2d');

  // Fill background with subtle gradient
  const bgGradient = ctx.createLinearGradient(0, 0, dashConfig.width, dashConfig.height);
  bgGradient.addColorStop(0, '#0a0e14');
  bgGradient.addColorStop(0.5, '#0d1218');
  bgGradient.addColorStop(1, '#0a0e14');
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, dashConfig.width, dashConfig.height);

  // Calculate panel sizes
  const mainWidth = dashConfig.width * 0.75 - dashConfig.padding;
  const sideWidth = dashConfig.width * 0.25 - dashConfig.gridGap - dashConfig.padding;
  const panelWidth = (mainWidth - dashConfig.gridGap) / 2;
  const panelHeight = (dashConfig.height - dashConfig.gridGap - dashConfig.padding * 2) / 2;

  // Render error rate chart (top-left)
  const errorRateChart = renderLineChart(metrics.errorRate, {
    width: panelWidth,
    height: panelHeight,
    title: 'Error Rate',
    lineColor: COLORS.accent.red,
    fill: true,
    fillColor: 'rgba(248, 81, 73, 0.15)',
    showCurrentValue: true,
    unit: '%',
    warningThreshold: 1,
    criticalThreshold: 5,
    borderRadius: dashConfig.borderRadius,
  });
  ctx.drawImage(errorRateChart, dashConfig.padding, dashConfig.padding);

  // Render request rate chart (top-right)
  const requestRateChart = renderLineChart(metrics.requestRate, {
    width: panelWidth,
    height: panelHeight,
    title: 'Request Rate',
    lineColor: COLORS.accent.blue,
    fill: true,
    fillColor: 'rgba(88, 166, 255, 0.15)',
    showCurrentValue: true,
    unit: ' req/s',
    borderRadius: dashConfig.borderRadius,
  });
  ctx.drawImage(requestRateChart, dashConfig.padding + panelWidth + dashConfig.gridGap, dashConfig.padding);

  // Render latency chart (bottom-left)
  const latencyChart = renderLineChart(metrics.latency, {
    width: panelWidth,
    height: panelHeight,
    title: 'Response Latency (P95)',
    lineColor: COLORS.accent.purple,
    fill: true,
    fillColor: 'rgba(163, 113, 247, 0.15)',
    showCurrentValue: true,
    unit: 'ms',
    warningThreshold: 500,
    criticalThreshold: 1000,
    borderRadius: dashConfig.borderRadius,
  });
  ctx.drawImage(latencyChart, dashConfig.padding, dashConfig.padding + panelHeight + dashConfig.gridGap);

  // Render resources panel (bottom-right) - Modern circular gauges
  const resourcesPanel = renderResourcesPanel(
    metrics.cpuUsage,
    metrics.memoryUsage,
    {
      width: panelWidth,
      height: panelHeight,
      borderRadius: dashConfig.borderRadius,
    }
  );
  ctx.drawImage(
    resourcesPanel,
    dashConfig.padding + panelWidth + dashConfig.gridGap,
    dashConfig.padding + panelHeight + dashConfig.gridGap
  );

  // Render side panel (status, pods, stats)
  const sidePanel = renderSidePanel(metrics, {
    width: sideWidth,
    height: dashConfig.height - dashConfig.padding * 2,
    borderRadius: dashConfig.borderRadius,
  });
  ctx.drawImage(sidePanel, mainWidth + dashConfig.gridGap + dashConfig.padding, dashConfig.padding);

  return canvas;
}

/**
 * Renders a modern resources panel with circular gauges
 */
function renderResourcesPanel(
  cpuUsage: number,
  memoryUsage: number,
  options: { width: number; height: number; borderRadius: number }
): Canvas {
  const canvas = createCanvas(options.width, options.height);
  const ctx = canvas.getContext('2d');

  // Panel background with border
  drawRoundedRect(ctx, 0, 0, options.width, options.height, options.borderRadius, COLORS.panelBg, COLORS.panelBorder);

  // Title with icon
  ctx.fillStyle = COLORS.text.secondary;
  ctx.font = 'bold 13px Arial';
  ctx.textAlign = 'left';
  ctx.fillText('⚡ Resources', 18, 28);

  // Divider line
  ctx.strokeStyle = COLORS.panelBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(15, 42);
  ctx.lineTo(options.width - 15, 42);
  ctx.stroke();

  const gaugeSize = 100;
  const gaugeY = 60;
  const cpuX = options.width / 4 - gaugeSize / 2 + 10;
  const memX = (options.width * 3) / 4 - gaugeSize / 2 - 10;

  // CPU Circular Gauge
  const cpuGauge = renderCircularGauge({
    value: cpuUsage,
    maxValue: 100,
    size: gaugeSize,
    title: 'CPU',
    unit: '%',
    color: cpuUsage > 90 ? COLORS.accent.red : cpuUsage > 70 ? COLORS.accent.yellow : COLORS.accent.cyan,
    trackColor: '#1e2733',
  });
  ctx.drawImage(cpuGauge, cpuX, gaugeY);

  // Memory Circular Gauge
  const memGauge = renderCircularGauge({
    value: memoryUsage,
    maxValue: 100,
    size: gaugeSize,
    title: 'Memory',
    unit: '%',
    color: memoryUsage > 90 ? COLORS.accent.red : memoryUsage > 75 ? COLORS.accent.yellow : COLORS.accent.purple,
    trackColor: '#1e2733',
  });
  ctx.drawImage(memGauge, memX, gaugeY);

  // Usage bars at bottom
  const barY = options.height - 50;
  const barHeight = 8;
  const barWidth = (options.width - 60) / 2 - 10;

  // CPU bar
  drawUsageBar(ctx, 20, barY, barWidth, barHeight, cpuUsage, COLORS.accent.cyan, 'CPU');

  // Memory bar
  drawUsageBar(ctx, options.width / 2 + 10, barY, barWidth, barHeight, memoryUsage, COLORS.accent.purple, 'MEM');

  return canvas;
}

/**
 * Draw a usage bar with label
 */
function drawUsageBar(
  ctx: CanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  percentage: number,
  color: string,
  label: string
): void {
  // Label
  ctx.fillStyle = COLORS.text.muted;
  ctx.font = '9px Arial';
  ctx.textAlign = 'left';
  ctx.fillText(label, x, y - 4);

  // Track
  drawRoundedRect(ctx, x, y, width, height, height / 2, '#1e2733');

  // Fill
  const fillWidth = (width * Math.min(percentage, 100)) / 100;
  if (fillWidth > 0) {
    const gradient = ctx.createLinearGradient(x, y, x + fillWidth, y);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, adjustColorBrightness(color, 30));
    
    ctx.beginPath();
    ctx.moveTo(x + height / 2, y);
    ctx.lineTo(x + Math.max(fillWidth - height / 2, 0), y);
    if (fillWidth > height) {
      ctx.quadraticCurveTo(x + fillWidth, y, x + fillWidth, y + height / 2);
      ctx.quadraticCurveTo(x + fillWidth, y + height, x + fillWidth - height / 2, y + height);
    }
    ctx.lineTo(x + height / 2, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height / 2);
    ctx.quadraticCurveTo(x, y, x + height / 2, y);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  // Percentage text
  ctx.fillStyle = COLORS.text.primary;
  ctx.font = 'bold 9px Arial';
  ctx.textAlign = 'right';
  ctx.fillText(`${percentage.toFixed(0)}%`, x + width, y - 4);
}

/**
 * Renders the side panel with status and metrics summary
 */
function renderSidePanel(
  metrics: ServiceMetrics,
  options: { width: number; height: number; borderRadius: number }
): Canvas {
  const canvas = createCanvas(options.width, options.height);
  const ctx = canvas.getContext('2d');

  // Panel background
  drawRoundedRect(ctx, 0, 0, options.width, options.height, options.borderRadius, COLORS.panelBg, COLORS.panelBorder);

  // Service name header with gradient highlight
  const headerHeight = 70;
  const headerGradient = ctx.createLinearGradient(0, 0, 0, headerHeight);
  headerGradient.addColorStop(0, 'rgba(88, 166, 255, 0.08)');
  headerGradient.addColorStop(1, 'transparent');
  
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(options.borderRadius, 0);
  ctx.lineTo(options.width - options.borderRadius, 0);
  ctx.quadraticCurveTo(options.width, 0, options.width, options.borderRadius);
  ctx.lineTo(options.width, headerHeight);
  ctx.lineTo(0, headerHeight);
  ctx.lineTo(0, options.borderRadius);
  ctx.quadraticCurveTo(0, 0, options.borderRadius, 0);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = headerGradient;
  ctx.fillRect(0, 0, options.width, headerHeight);
  ctx.restore();

  // Service name (truncate if too long)
  ctx.fillStyle = COLORS.text.primary;
  ctx.font = 'bold 13px Arial';
  ctx.textAlign = 'center';
  const serviceName = truncateText(ctx, metrics.serviceName, options.width - 30);
  ctx.fillText(serviceName, options.width / 2, 28);

  // Namespace badge
  ctx.fillStyle = COLORS.text.secondary;
  ctx.font = '10px Arial';
  ctx.fillText(metrics.namespace, options.width / 2, 46);

  // Status indicator section
  const statusY = 80;
  const statusColor = getStatusColor(metrics.healthStatus);
  
  // Status glow
  ctx.beginPath();
  ctx.arc(options.width / 2 - 50, statusY + 12, 6, 0, Math.PI * 2);
  ctx.fillStyle = statusColor;
  ctx.shadowColor = statusColor;
  ctx.shadowBlur = 8;
  ctx.fill();
  ctx.shadowBlur = 0;

  // Status text
  ctx.fillStyle = statusColor;
  ctx.font = 'bold 12px Arial';
  ctx.textAlign = 'left';
  ctx.fillText(getStatusLabel(metrics.healthStatus), options.width / 2 - 38, statusY + 16);

  // Divider
  drawDivider(ctx, 15, statusY + 35, options.width - 30);

  // Pod count with modern display
  const podY = statusY + 55;
  ctx.fillStyle = COLORS.text.muted;
  ctx.font = '10px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('Running Pods', options.width / 2, podY);

  ctx.fillStyle = COLORS.accent.blue;
  ctx.font = 'bold 36px Arial';
  ctx.fillText(metrics.podCount.toString(), options.width / 2, podY + 42);

  // Divider
  drawDivider(ctx, 15, podY + 60, options.width - 30);

  // Stats list with modern styling
  const statsY = podY + 85;
  // Format request rate - show decimals for small values
  const reqsValue = metrics.requestRate.current < 1 
    ? metrics.requestRate.current.toFixed(2) 
    : metrics.requestRate.current.toFixed(0);
  const stats = [
    { label: 'Error Rate', value: `${metrics.errorRate.current.toFixed(2)}%`, color: metrics.errorRate.current > 1 ? COLORS.accent.red : COLORS.text.primary },
    { label: 'Req/s', value: reqsValue, color: COLORS.text.primary },
    { label: 'P95 Latency', value: `${metrics.latency.current.toFixed(0)}ms`, color: metrics.latency.current > 500 ? COLORS.accent.yellow : COLORS.text.primary },
    { label: 'CPU', value: `${metrics.cpuUsage.toFixed(0)}%`, color: metrics.cpuUsage > 80 ? COLORS.accent.yellow : COLORS.text.primary },
    { label: 'Memory', value: `${metrics.memoryUsage.toFixed(0)}%`, color: metrics.memoryUsage > 80 ? COLORS.accent.yellow : COLORS.text.primary },
  ];

  let y = statsY;
  for (const stat of stats) {
    // Label
    ctx.fillStyle = COLORS.text.secondary;
    ctx.font = '11px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(stat.label, 18, y);

    // Value
    ctx.fillStyle = stat.color;
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'right';
    ctx.fillText(stat.value, options.width - 18, y);

    y += 24;
  }

  return canvas;
}

/**
 * Draw a horizontal divider
 */
function drawDivider(ctx: CanvasContext, x: number, y: number, width: number): void {
  const gradient = ctx.createLinearGradient(x, y, x + width, y);
  gradient.addColorStop(0, 'transparent');
  gradient.addColorStop(0.5, COLORS.panelBorder);
  gradient.addColorStop(1, 'transparent');
  
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + width, y);
  ctx.stroke();
}

/**
 * Truncate text to fit within width
 */
function truncateText(ctx: CanvasContext, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }
  
  let truncated = text;
  while (ctx.measureText(truncated + '...').width > maxWidth && truncated.length > 0) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + '...';
}

/**
 * Get status color
 */
function getStatusColor(status: 'healthy' | 'degraded' | 'critical' | 'unknown'): string {
  const colors = {
    healthy: COLORS.accent.green,
    degraded: COLORS.accent.yellow,
    critical: COLORS.accent.red,
    unknown: COLORS.text.muted,
  };
  return colors[status];
}

/**
 * Get status label
 */
function getStatusLabel(status: 'healthy' | 'degraded' | 'critical' | 'unknown'): string {
  const labels = {
    healthy: 'All Systems Normal',
    degraded: 'Performance Degraded',
    critical: 'Critical Issues',
    unknown: 'Status Unknown',
  };
  return labels[status];
}

/**
 * Adjust color brightness
 */
function adjustColorBrightness(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.min(255, Math.max(0, (num >> 16) + amt));
  const G = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + amt));
  const B = Math.min(255, Math.max(0, (num & 0x0000ff) + amt));
  return `#${(0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1)}`;
}

export { renderLineChart } from './line-chart.js';
export { renderGauge, renderStatusIndicator, renderPodCount, renderCircularGauge } from './gauge-chart.js';

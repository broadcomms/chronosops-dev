/**
 * AI Annotations - Draw AI-generated annotations on frames
 */

import type { SKRSContext2D } from '@napi-rs/canvas';

type CanvasRenderingContext2D = SKRSContext2D;
import type { AIAnnotation } from '../types.js';

/**
 * Default colors for annotations
 */
const ANNOTATION_COLORS = {
  highlight: '#ff6b6b',
  arrow: '#ffd93d',
  box: '#ff6b6b',
  text: '#ffd93d',
};

/**
 * Draw all annotations on a canvas context
 */
export function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: AIAnnotation[]
): void {
  for (const annotation of annotations) {
    ctx.save();
    drawAnnotation(ctx, annotation);
    ctx.restore();
  }
}

/**
 * Draw a single annotation
 */
function drawAnnotation(ctx: CanvasRenderingContext2D, annotation: AIAnnotation): void {
  const color = annotation.data.color || ANNOTATION_COLORS[annotation.type];

  switch (annotation.type) {
    case 'highlight':
      drawHighlight(ctx, annotation, color);
      break;
    case 'arrow':
      drawArrow(ctx, annotation, color);
      break;
    case 'box':
      drawBox(ctx, annotation, color);
      break;
    case 'text':
      drawText(ctx, annotation, color);
      break;
  }
}

/**
 * Draw a highlight circle (pulsing effect simulated with dashed line)
 */
function drawHighlight(
  ctx: CanvasRenderingContext2D,
  annotation: AIAnnotation,
  color: string
): void {
  const { x, y } = annotation.position;
  const radius = annotation.data.radius || 30;

  // Outer glow
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 4]);

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();

  // Inner highlight
  ctx.setLineDash([]);
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.arc(x, y, radius + 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * Draw an arrow pointing to an issue
 */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  annotation: AIAnnotation,
  color: string
): void {
  const { x, y } = annotation.position;
  const fromX = annotation.data.fromX ?? x - 50;
  const fromY = annotation.data.fromY ?? y - 50;

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;

  // Draw line
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(x, y);
  ctx.stroke();

  // Draw arrowhead
  const headLen = 12;
  const angle = Math.atan2(y - fromY, x - fromX);

  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(
    x - headLen * Math.cos(angle - Math.PI / 6),
    y - headLen * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    x - headLen * Math.cos(angle + Math.PI / 6),
    y - headLen * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();

  // Draw label if provided
  if (annotation.data.label) {
    ctx.font = 'bold 12px Arial';
    ctx.fillText(annotation.data.label, fromX, fromY - 8);
  }
}

/**
 * Draw a bounding box around an area
 */
function drawBox(
  ctx: CanvasRenderingContext2D,
  annotation: AIAnnotation,
  color: string
): void {
  const { x, y } = annotation.position;
  const width = annotation.data.width || 100;
  const height = annotation.data.height || 50;

  // Draw box
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 3]);
  ctx.strokeRect(x, y, width, height);
  ctx.setLineDash([]);

  // Draw corner brackets
  const bracketLen = 10;
  ctx.lineWidth = 3;

  // Top-left
  ctx.beginPath();
  ctx.moveTo(x, y + bracketLen);
  ctx.lineTo(x, y);
  ctx.lineTo(x + bracketLen, y);
  ctx.stroke();

  // Top-right
  ctx.beginPath();
  ctx.moveTo(x + width - bracketLen, y);
  ctx.lineTo(x + width, y);
  ctx.lineTo(x + width, y + bracketLen);
  ctx.stroke();

  // Bottom-left
  ctx.beginPath();
  ctx.moveTo(x, y + height - bracketLen);
  ctx.lineTo(x, y + height);
  ctx.lineTo(x + bracketLen, y + height);
  ctx.stroke();

  // Bottom-right
  ctx.beginPath();
  ctx.moveTo(x + width - bracketLen, y + height);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x + width, y + height - bracketLen);
  ctx.stroke();

  // Draw label if provided
  if (annotation.data.label) {
    ctx.fillStyle = color;
    ctx.font = 'bold 12px Arial';
    ctx.fillText(annotation.data.label, x, y - 6);
  }
}

/**
 * Draw text annotation
 */
function drawText(
  ctx: CanvasRenderingContext2D,
  annotation: AIAnnotation,
  color: string
): void {
  const { x, y } = annotation.position;
  const text = annotation.data.text || '';

  // Background for text
  ctx.font = 'bold 13px Arial';
  const textWidth = ctx.measureText(text).width;
  const padding = 6;

  ctx.fillStyle = 'rgba(22, 27, 34, 0.9)';
  ctx.fillRect(x - padding, y - 14, textWidth + padding * 2, 20);

  // Border
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(x - padding, y - 14, textWidth + padding * 2, 20);

  // Text
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/**
 * Create a pulse animation offset (for animated annotations)
 * Returns a value between 0 and 1 based on frame number
 */
export function getPulseOffset(frameNumber: number, frequency: number = 0.5): number {
  return (Math.sin(frameNumber * frequency) + 1) / 2;
}

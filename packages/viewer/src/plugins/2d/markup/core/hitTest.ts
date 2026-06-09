/**
 * Pure CSS-space hit-testing for committed markup, so clicking a shape selects
 * its topic. Kept renderer-independent (no three.js) — the core feeds in the
 * already-projected CSS points it used to render each shape.
 *
 * Test per tool: rect/cloud = inside the 2-corner box (filled select) or near an
 * edge; arrow/freehand = near the polyline; text = inside the estimated label
 * box (same `TEXT_SIZE_FRAC` the text plugin draws with, so they stay in sync).
 */

import type { Pt } from '../../measure/math.js';
import type { MarkupTool } from '../types.js';
import { TEXT_SIZE_FRAC } from './draw.js';

export interface HitShape {
  topicId: string;
  tool: MarkupTool;
  /** CSS-px points: 2 corners (rect/cloud), 1 anchor (text), or a polyline. */
  css: Pt[];
  text?: string;
}

/** Distance from point (px,py) to segment a→b. */
function pointToSegment(px: number, py: number, a: Pt, b: Pt): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const wx = px - a[0];
  const wy = py - a[1];
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  const cx = a[0] + t * vx;
  const cy = a[1] + t * vy;
  return Math.hypot(px - cx, py - cy);
}

function nearPolyline(css: Pt[], x: number, y: number, threshold: number): boolean {
  for (let i = 0; i < css.length - 1; i += 1) {
    if (pointToSegment(x, y, css[i]!, css[i + 1]!) <= threshold) return true;
  }
  // Single-point degenerate path.
  if (css.length === 1) return Math.hypot(x - css[0]![0], y - css[0]![1]) <= threshold;
  return false;
}

/** Inside (or near the edge of) the box spanned by two opposite corners. */
function inBox(css: Pt[], x: number, y: number, threshold: number): boolean {
  if (css.length < 2) return false;
  const minX = Math.min(css[0]![0], css[1]![0]) - threshold;
  const maxX = Math.max(css[0]![0], css[1]![0]) + threshold;
  const minY = Math.min(css[0]![1], css[1]![1]) - threshold;
  const maxY = Math.max(css[0]![1], css[1]![1]) + threshold;
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}

/** Estimated label box for a text annotation anchored at its top-left corner. */
function inTextBox(css: Pt[], text: string, pageH: number, x: number, y: number): boolean {
  if (css.length < 1) return false;
  const fontPx = Math.max(8, pageH * TEXT_SIZE_FRAC);
  const w = Math.max(fontPx, text.length * fontPx * 0.6);
  const h = fontPx * 1.3;
  const ax = css[0]![0];
  const ay = css[0]![1];
  return x >= ax && x <= ax + w && y >= ay && y <= ay + h;
}

function testShape(s: HitShape, x: number, y: number, pageH: number, threshold: number): boolean {
  switch (s.tool) {
    case 'rect':
    case 'cloud':
      return inBox(s.css, x, y, threshold);
    case 'arrow':
    case 'freehand':
      return nearPolyline(s.css, x, y, threshold);
    case 'text':
      return inTextBox(s.css, s.text ?? '', pageH, x, y);
    default:
      return false;
  }
}

/** Returns the topmost (last-drawn) topicId hit at (x, y), or null. */
export function hitTestCommitted(
  x: number,
  y: number,
  shapes: HitShape[],
  pageH: number,
  threshold = 6,
): string | null {
  for (let i = shapes.length - 1; i >= 0; i -= 1) {
    if (testShape(shapes[i]!, x, y, pageH, threshold)) return shapes[i]!.topicId;
  }
  return null;
}

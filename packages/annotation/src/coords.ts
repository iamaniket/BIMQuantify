/**
 * Pure coordinate helpers. The annotation model stores points NORMALIZED to the
 * image box (0..1, top-left, Y-down). These convert to/from the displayed pixel
 * rect and back — no DOM, no React, fully unit-testable.
 */

import type { Annotation2D } from './types.js';
import { REFERENCE_EXTENT } from './types.js';

/** A point in normalized image space: `[nx, ny]`, each in `0..1`. */
export type NormPoint = [number, number];

/** A point in displayed pixel space (relative to the rendered image rect). */
export type PxPoint = [number, number];

/** A rendered image rectangle in client coordinates. */
export interface ImageRect {
  /** Client X of the rect's left edge. */
  left: number;
  /** Client Y of the rect's top edge. */
  top: number;
  /** Rendered width in px. */
  width: number;
  /** Rendered height in px. */
  height: number;
}

export function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** Client pointer coords → normalized image point (clamped to the image box). */
export function clientToNorm(clientX: number, clientY: number, rect: ImageRect): NormPoint {
  const nx = rect.width === 0 ? 0 : (clientX - rect.left) / rect.width;
  const ny = rect.height === 0 ? 0 : (clientY - rect.top) / rect.height;
  return [clamp01(nx), clamp01(ny)];
}

/** Normalized point → pixel point within a rect of the given size. */
export function normToPx([nx, ny]: NormPoint, width: number, height: number): PxPoint {
  return [nx * width, ny * height];
}

/** Batch {@link normToPx}. */
export function normPointsToPx(points: NormPoint[], width: number, height: number): PxPoint[] {
  return points.map((p) => normToPx(p, width, height));
}

/**
 * Convert an authored stroke width (in {@link REFERENCE_EXTENT} units) to device
 * px for a render box whose longest edge is `longestEdgePx`.
 */
export function strokeWidthToPx(strokeWidth: number, longestEdgePx: number): number {
  return (strokeWidth * longestEdgePx) / REFERENCE_EXTENT;
}

/** Axis-aligned bounding box of a set of normalized points. */
export function normBBox(points: NormPoint[]): { x: number; y: number; w: number; h: number } {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Centroid (normalized) of an annotation — its suggested anchor/pin position. */
export function annotationCentroid(a: Annotation2D): NormPoint {
  const box = normBBox(a.points);
  return [box.x + box.w / 2, box.y + box.h / 2];
}

/** Squared distance from point `p` to segment `a→b` (in any consistent units). */
export function distSqToSegment(
  p: PxPoint,
  a: PxPoint,
  b: PxPoint,
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + t * dx;
  const cy = a[1] + t * dy;
  const ex = p[0] - cx;
  const ey = p[1] - cy;
  return ex * ex + ey * ey;
}

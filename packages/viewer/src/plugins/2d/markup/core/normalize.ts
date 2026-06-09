/**
 * Pure conversions between **artifact space** (PDF points, Y-up, box-relative —
 * the measure plugin's storage space) and **normalized space** (0..1, top-left,
 * Y-down — the persistence space, matching finding `anchor_x`/`anchor_y`).
 *
 * Both are tied to the UNROTATED page box `{w, h}` (PDF points), so a markup
 * drawn at rotation 90° persists identical numbers and re-renders correctly at
 * any rotation. Rendering folds rotation back in via the measure plugin's
 * `transform.ts` (`artifactToCss` / `cssToArtifact`).
 */

import type { Pt } from '../../measure/math.js';

/** Artifact point (PDF pts, Y-up) → normalized (0..1, top-left, Y-down). */
export function artifactToNorm(ax: number, ay: number, w: number, h: number): [number, number] {
  return [w === 0 ? 0 : ax / w, h === 0 ? 0 : 1 - ay / h];
}

/** Normalized (0..1, top-left, Y-down) → artifact point (PDF pts, Y-up). */
export function normToArtifact(nx: number, ny: number, w: number, h: number): [number, number] {
  return [nx * w, (1 - ny) * h];
}

/** Average of normalized points → a single normalized anchor. */
export function normCentroid(points: [number, number][]): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
  }
  const n = points.length;
  return { x: x / n, y: y / n };
}

/** Map every artifact point of a shape to normalized space. */
export function pointsToNorm(points: Pt[], w: number, h: number): [number, number][] {
  return points.map((p) => artifactToNorm(p[0], p[1], w, h));
}

/** Map every normalized point of a shape back to artifact space. */
export function pointsToArtifact(points: [number, number][], w: number, h: number): Pt[] {
  return points.map((p) => normToArtifact(p[0], p[1], w, h));
}

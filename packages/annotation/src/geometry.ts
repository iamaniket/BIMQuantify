/**
 * Pure shape geometry in pixel space, shared by the SVG renderer (editor /
 * read-only overlay) and the Canvas2D exporter so a shape looks identical on
 * screen and in the flattened raster. No DOM, no React.
 */

import type { PxPoint } from './coords.js';

/** Arrowhead half-angle (radians) and the three head points + shaft endpoints. */
const ARROW_HEAD_ANGLE = 0.5;

export interface ArrowGeometry {
  /** Shaft endpoints (tail → head). */
  shaft: [PxPoint, PxPoint];
  /** Arrowhead wing points: left, tip, right. */
  head: [PxPoint, PxPoint, PxPoint];
}

/** Build arrow geometry from tail `a` to head `b`, with the given head length. */
export function arrowGeometry(a: PxPoint, b: PxPoint, headLenPx: number): ArrowGeometry {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const left: PxPoint = [
    b[0] - headLenPx * Math.cos(ang - ARROW_HEAD_ANGLE),
    b[1] - headLenPx * Math.sin(ang - ARROW_HEAD_ANGLE),
  ];
  const right: PxPoint = [
    b[0] - headLenPx * Math.cos(ang + ARROW_HEAD_ANGLE),
    b[1] - headLenPx * Math.sin(ang + ARROW_HEAD_ANGLE),
  ];
  return { shaft: [a, b], head: [left, b, right] };
}

/**
 * Revision-cloud outline (closed polyline) for the rectangle spanned by `a`,`b`.
 * Ported from the PDF viewer's cloud tool, in pixel space.
 */
export function cloudPoints(a: PxPoint, b: PxPoint, arcDPx: number): PxPoint[] {
  const STEPS = 6; // arc samples per scallop
  const corners: PxPoint[] = [
    [a[0], a[1]],
    [b[0], a[1]],
    [b[0], b[1]],
    [a[0], b[1]],
  ];
  const cx = (a[0] + b[0]) / 2;
  const cy = (a[1] + b[1]) / 2;
  const verts: PxPoint[] = [];

  for (let e = 0; e < 4; e += 1) {
    const p = corners[e]!;
    const q = corners[(e + 1) % 4]!;
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const len = Math.hypot(ex, ey) || 1;
    const ux = ex / len;
    const uy = ey / len;
    // Outward normal: the perpendicular pointing away from the rect centre.
    let nx = uy;
    let ny = -ux;
    const mx = (p[0] + q[0]) / 2;
    const my = (p[1] + q[1]) / 2;
    if ((mx - cx) * nx + (my - cy) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const n = Math.max(1, Math.round(len / Math.max(arcDPx, 1)));
    const r = len / (2 * n);
    for (let i = 0; i < n; i += 1) {
      const scx = p[0] + ex * ((i + 0.5) / n);
      const scy = p[1] + ey * ((i + 0.5) / n);
      for (let s = 0; s <= STEPS; s += 1) {
        const angle = Math.PI * (1 - s / STEPS); // π → 0: bulge outward
        const along = Math.cos(angle) * r;
        const out = Math.sin(angle) * r;
        verts.push([scx + ux * along + nx * out, scy + uy * along + ny * out]);
      }
    }
  }
  return verts;
}

/** SVG path `d` string through the given points; optionally closed. */
export function pointsToPathD(points: PxPoint[], close: boolean): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  let d = `M ${fmt(first![0])} ${fmt(first![1])}`;
  for (const p of rest) d += ` L ${fmt(p[0])} ${fmt(p[1])}`;
  if (close) d += ' Z';
  return d;
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : '0';
}

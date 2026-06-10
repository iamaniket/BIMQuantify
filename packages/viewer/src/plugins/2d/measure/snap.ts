/**
 * Small, self-contained 2D snap utility for the PDF vector overlay. Mirrors the
 * IFC snap-engine's *design* (px threshold, priority endpoint > intersection,
 * intersection cap, dedup tolerance) without importing its 3D-fragment-coupled
 * internals.
 *
 * All snap candidates are stored in artifact space (PDF points, Y-up). Nearest-
 * point search is done in a caller-chosen comparison space via a `project`
 * function (artifact → comparison coords) — world space for the live viewer,
 * CSS for the unit tests — so the engine is agnostic to how the page is drawn.
 */

import type { Line } from './geometryTypes';

export type SnapKind = 'endpoint' | 'intersection';

/** Projects an artifact-space point into the comparison space (world or CSS px). */
export type SnapProjector = (ax: number, ay: number) => [number, number];

export interface SnapPoint {
  /** Artifact-space coordinates (PDF points, Y-up). */
  ax: number;
  ay: number;
  kind: SnapKind;
}

/** A drawing segment in artifact space — the conceptual invisible geometry. */
export interface SnapSegment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface PageSnapData {
  endpoints: SnapPoint[];
  intersections: SnapPoint[];
  segments: SnapSegment[];
}

export interface SnapResult {
  /** Snapped point, artifact space (PDF points, Y-up). */
  ax: number;
  ay: number;
  /** Same point in comparison space (whatever `project` returns — world or CSS). */
  px: number;
  py: number;
  kind: SnapKind;
  /** Distance in comparison-space units from the cursor to the snap point. */
  distance: number;
}

const DEDUP_TOL = 0.25; // PDF points — merge near-coincident points.
const MIN_SEG_LEN = 0.01; // drop degenerate (zero-length) segments.
const MAX_INTERSECT_SEGMENTS = 600; // bound the O(n²) intersection pass.
const MAX_INTERSECTIONS = 500; // cap produced intersection points.

/** Quantise a coordinate into an integer dedup bucket. */
function bucket(n: number): number {
  return Math.round(n / DEDUP_TOL);
}

/** True crossing point of two segments, or null if parallel / non-overlapping. */
function segmentIntersection(a: SnapSegment, b: SnapSegment): [number, number] | null {
  const rx = a.bx - a.ax;
  const ry = a.by - a.ay;
  const sx = b.bx - b.ax;
  const sy = b.by - b.ay;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-9) return null; // parallel or collinear
  const qpx = b.ax - a.ax;
  const qpy = b.ay - a.ay;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a.ax + t * rx, a.ay + t * ry];
}

export function buildPageSnapData(lines: Line[]): PageSnapData {
  const segments: SnapSegment[] = [];
  for (const ln of lines) {
    const ax = ln[0];
    const ay = ln[1];
    const bx = ln[2];
    const by = ln[3];
    if (Math.hypot(bx - ax, by - ay) < MIN_SEG_LEN) continue;
    segments.push({ ax, ay, bx, by });
  }

  // Endpoints — deduped by quantised bucket so shared endpoints collapse.
  const endpointMap = new Map<string, SnapPoint>();
  const addEndpoint = (ax: number, ay: number): void => {
    const key = `${bucket(ax)},${bucket(ay)}`;
    if (!endpointMap.has(key)) endpointMap.set(key, { ax, ay, kind: 'endpoint' });
  };
  for (const s of segments) {
    addEndpoint(s.ax, s.ay);
    addEndpoint(s.bx, s.by);
  }

  // Intersections — capped O(n²) crossing test, deduped, and dropped where they
  // coincide with an endpoint (endpoints already cover those, at higher priority).
  const intersectionMap = new Map<string, SnapPoint>();
  const n = Math.min(segments.length, MAX_INTERSECT_SEGMENTS);
  outer: for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const p = segmentIntersection(segments[i]!, segments[j]!);
      if (p === null) continue;
      const key = `${bucket(p[0])},${bucket(p[1])}`;
      if (endpointMap.has(key) || intersectionMap.has(key)) continue;
      intersectionMap.set(key, { ax: p[0], ay: p[1], kind: 'intersection' });
      if (intersectionMap.size >= MAX_INTERSECTIONS) break outer;
    }
  }

  return {
    endpoints: [...endpointMap.values()],
    intersections: [...intersectionMap.values()],
    segments,
  };
}

/**
 * Nearest snap within `threshold` (comparison-space units): endpoints take
 * priority over intersections. `cursor` and `threshold` must be in the same
 * space `project` maps candidates into.
 */
export function findNearestSnap(
  data: PageSnapData,
  cursor: { x: number; y: number },
  project: SnapProjector,
  threshold: number,
): SnapResult | null {
  return (
    nearestInTier(data.endpoints, cursor, project, threshold) ??
    nearestInTier(data.intersections, cursor, project, threshold)
  );
}

function nearestInTier(
  points: SnapPoint[],
  cursor: { x: number; y: number },
  project: SnapProjector,
  threshold: number,
): SnapResult | null {
  let best: SnapResult | null = null;
  for (const pt of points) {
    const [px, py] = project(pt.ax, pt.ay);
    const distance = Math.hypot(px - cursor.x, py - cursor.y);
    if (distance > threshold) continue;
    if (best === null || distance < best.distance) {
      best = { ax: pt.ax, ay: pt.ay, px, py, kind: pt.kind, distance };
    }
  }
  return best;
}

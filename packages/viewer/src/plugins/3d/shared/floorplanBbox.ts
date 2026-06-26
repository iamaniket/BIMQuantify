/**
 * Shared 2D bbox math for the floor-plan artifact — used by both the portal's
 * `useFloorPlans` (per-level extents for the canvas minimap) and the
 * `DocumentEngine` floor-plan mode (the union extent that becomes the 2D
 * viewer's synthetic "page box"). Kept here next to the codec so the two
 * consumers agree on how plan coords map to an axis-aligned box.
 */

import type { FloorPlanLevel } from './floorplan-codec.js';

/** Axis-aligned extent in plan (IFC horizontal) coords. */
export interface PlanBbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Grow `acc` to include every `[x,y]` pair in a flat segment buffer. */
export function accumulateBbox(segs: Float32Array, acc: PlanBbox): void {
  for (let i = 0; i + 1 < segs.length; i += 2) {
    const x = segs[i]!;
    const y = segs[i + 1]!;
    if (x < acc.minX) acc.minX = x;
    if (x > acc.maxX) acc.maxX = x;
    if (y < acc.minY) acc.minY = y;
    if (y > acc.maxY) acc.maxY = y;
  }
}

/** Empty bbox seeded for accumulation (Infinity bounds). */
export function emptyBbox(): PlanBbox {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

/** True when no points were accumulated (still at the seed bounds). */
export function isEmptyBbox(b: PlanBbox): boolean {
  return !(b.maxX >= b.minX && b.maxY >= b.minY);
}

/** Extent of a single level's wall + room geometry. */
export function levelBbox(level: FloorPlanLevel): PlanBbox {
  const acc = emptyBbox();
  accumulateBbox(level.wallSegments, acc);
  for (const r of level.rooms) accumulateBbox(r.segments, acc);
  return acc;
}

/**
 * Union extent across all levels. Returns null when there is no geometry. The
 * engine's floor-plan mode uses this as a STABLE page box so plan↔world is a
 * single constant offset (`world = plan − min`) that doesn't shift when
 * switching levels.
 */
export function unionBbox(levels: readonly FloorPlanLevel[]): PlanBbox | null {
  const acc = emptyBbox();
  for (const lv of levels) accumulateBbox(lv.wallSegments, acc);
  for (const lv of levels) for (const r of lv.rooms) accumulateBbox(r.segments, acc);
  return isEmptyBbox(acc) ? null : acc;
}

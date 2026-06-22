/**
 * Pure pivot-resolution logic for the pivot-rotate plugin, split out so it can
 * be unit-tested without a viewer/WebGL context.
 *
 * The orbit pivot is chosen from every surface the pick ray crosses (see
 * `pickAll` in core/Raycaster). Two stages:
 *
 *  1. {@link reduceHits} scans the depth-sorted hits once and extracts the three
 *     cursor-dependent candidate points (nearest selected / nearest solid /
 *     nearest anything), skipping section-clipped hits. Cheap; the plugin runs
 *     it on pointerdown over the cached hover hits using *live* selection /
 *     x-ray / section state, so a selection made after the last hover still
 *     counts.
 *  2. {@link resolvePivot} applies the user-chosen preference order — "prefer my
 *     selection, else skip see-through" — to land on a final point.
 *
 * Resolution order (see the plan / CLAUDE-level UX decision):
 *   1. selected-hit       — nearest selected surface under the cursor
 *   2. selection-centroid — a selection exists but isn't under the cursor
 *   3. solid-hit          — no selection: nearest non-see-through surface
 *   4. any-hit            — everything under the cursor is see-through
 *   5. scene-centre       — nothing was hit
 */

import type { Vec3 } from '../../../core/types.js';

export type PivotSource =
  | 'selected-hit'
  | 'selection-centroid'
  | 'solid-hit'
  | 'any-hit'
  | 'scene-centre';

/** A single ray hit, with the three booleans the resolver cares about. */
export interface PivotHit {
  point: Vec3;
  /** This hit's element is currently selected. */
  selected: boolean;
  /** This hit's element is x-rayed / faded — visually see-through. */
  seeThrough: boolean;
  /** This hit's point is cut away by an active section plane. */
  clipped: boolean;
}

/** Cursor-dependent candidate points distilled from the sorted hits. */
export interface PivotCandidates {
  /** Nearest non-clipped selected hit under the cursor. */
  selectedHit: Vec3 | null;
  /** Nearest non-clipped, non-see-through hit under the cursor. */
  solidHit: Vec3 | null;
  /** Nearest non-clipped hit under the cursor (see-through included). */
  anyHit: Vec3 | null;
}

/** Cursor-independent context resolved at drag-start. */
export interface PivotContext {
  /** Any selection exists at all (size > 0 or all-selected). */
  hasSelection: boolean;
  /** World-space centroid of the current selection, or null. */
  selectionCentroid: Vec3 | null;
  /** Scene-centre fallback, or null. */
  sceneCentre: Vec3 | null;
}

export interface PivotResolution {
  point: Vec3;
  source: PivotSource;
}

/**
 * Walk the depth-sorted (near→far) hits once and pull out the three candidate
 * points. Section-clipped hits are skipped entirely. A selected hit wins
 * regardless of its see-through state — if you selected it, you want it.
 */
export function reduceHits(hits: PivotHit[]): PivotCandidates {
  let selectedHit: Vec3 | null = null;
  let solidHit: Vec3 | null = null;
  let anyHit: Vec3 | null = null;
  for (const h of hits) {
    if (h.clipped) continue;
    if (!anyHit) anyHit = h.point;
    if (!solidHit && !h.seeThrough) solidHit = h.point;
    if (!selectedHit && h.selected) selectedHit = h.point;
    // `anyHit` is set by the first non-clipped hit, so once selected + solid are
    // both found there is nothing left to discover.
    if (selectedHit && solidHit) break;
  }
  return { selectedHit, solidHit, anyHit };
}

/**
 * Apply the "prefer my selection, else skip see-through" order to the cursor
 * candidates plus the drag-start context. Returns null only when there is
 * nothing to orbit at all (no hits, no selection, no scene).
 */
export function resolvePivot(
  candidates: PivotCandidates,
  cx: PivotContext,
): PivotResolution | null {
  // 1. Nearest selected surface under the cursor — exact orbit point on it,
  //    even when a wall (opaque or x-rayed) sits in front.
  if (candidates.selectedHit) {
    return { point: candidates.selectedHit, source: 'selected-hit' };
  }
  // 2. Something is selected but it isn't under the cursor — keep orbiting it
  //    via its centroid rather than grabbing whatever the cursor is over.
  if (cx.hasSelection && cx.selectionCentroid) {
    return { point: cx.selectionCentroid, source: 'selection-centroid' };
  }
  // 3. Free navigation — nearest solid/visible surface, skipping see-through.
  if (candidates.solidHit) {
    return { point: candidates.solidHit, source: 'solid-hit' };
  }
  // 4. Everything under the cursor is see-through — orbit it anyway.
  if (candidates.anyHit) {
    return { point: candidates.anyHit, source: 'any-hit' };
  }
  // 5. Nothing hit — fall back to the scene centre.
  if (cx.sceneCentre) {
    return { point: cx.sceneCentre, source: 'scene-centre' };
  }
  return null;
}

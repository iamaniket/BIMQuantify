/**
 * Visible-element bounding box — the world-space AABB of every loaded item
 * minus the hidden and x-rayed (ghosted) sets.
 *
 * Used to size the blob shadow to what's actually on screen (`Viewer`) and to
 * frame the camera on the visible set (camera plugin). Lives in `core/` so the
 * `Viewer` can use it without importing from `plugins/`.
 */

import * as THREE from 'three';
import type * as FRAGS from '@thatopen/fragments';

import type { ItemId, ViewerContext } from './types.js';

/**
 * World-space AABB of the currently *visible solid* elements — every loaded
 * item minus the `hidden` and `xrayed` sets.
 *
 * Returns an empty `Box3` when nothing solid remains (everything hidden, or
 * full x-ray); callers treat that as "hide the shadow".
 *
 * Cost: walks each model's localIds and calls `getMergedBox` on the surviving
 * set — the slow path. Callers should keep a cheap whole-model fast path for
 * the common (nothing hidden/xrayed) case.
 */
export async function computeVisibleSolidBox(
  ctx: ViewerContext,
  opts: { hidden: ItemId[]; xrayed: ItemId[] },
): Promise<THREE.Box3> {
  const out = new THREE.Box3();

  // Group every excluded localId by model for O(1) membership checks.
  const excludedByModel = new Map<string, Set<number>>();
  for (const item of [...opts.hidden, ...opts.xrayed]) {
    let set = excludedByModel.get(item.modelId);
    if (!set) {
      set = new Set();
      excludedByModel.set(item.modelId, set);
    }
    set.add(item.localId);
  }

  for (const [modelId, model] of ctx.models()) {
    let allIds: Iterable<number>;
    try {
      allIds = await (
        model as unknown as { getLocalIds(): Promise<Iterable<number>> }
      ).getLocalIds();
    } catch {
      continue;
    }
    const excluded = excludedByModel.get(modelId);
    const visibleIds: number[] = [];
    for (const id of allIds) {
      if (excluded?.has(id)) continue;
      visibleIds.push(id);
    }
    if (!visibleIds.length) continue;
    try {
      const mb = await (model as FRAGS.FragmentsModel).getMergedBox(visibleIds);
      // Clamp to the model's own geometry bounds. Over a large id set,
      // `getMergedBox` can include non-geometric/spatial elements (IfcSite,
      // storeys, …) whose box sits at the world origin, ballooning the union
      // into a stretched smear reaching toward (0,0,0). The visible elements
      // are physically a subset of the model, so their true AABB is contained
      // in `model.box` — intersecting strips the spurious expansion while
      // leaving tight isolated-element boxes (and their float-under Y) intact.
      const modelBox = model.box;
      if (modelBox && !modelBox.isEmpty()) mb.intersect(modelBox);
      if (!mb.isEmpty()) out.union(mb);
    } catch {
      // ignore; some items may not have geometry
    }
  }

  return out;
}

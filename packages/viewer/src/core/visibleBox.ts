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

const _tmpSize = new THREE.Vector3();

/**
 * Per-model cache of every element's local id and (parallel) world-space AABB,
 * from `getBoxes`. Boxes are immutable for a model's lifetime, so this is queried
 * once per model and reused across bakes — visibility/x-ray re-bakes only change
 * which cached boxes are rasterised, never the boxes themselves.
 */
export interface ShadowBoxCacheEntry {
  ids: number[];
  boxes: THREE.Box3[];
}

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

/**
 * Per-element world-space AABBs of the currently *visible solid* set, plus their
 * union — the inputs the box-silhouette contact-shadow bake rasterises. Unlike
 * {@link computeVisibleSolidBox} (which only needs the union), this returns every
 * surviving element box so the baker can draw each footprint.
 *
 * Sourced from `getBoxes` (worker-computed, NO geometry streaming) and cached in
 * `boxCache` — the first call per model pays one `getLocalIds` + `getBoxes`; every
 * later call (visibility / x-ray change) is a pure in-memory filter. Returned
 * boxes are the cached references (read-only — the baker never mutates them).
 *
 * `model.box` is the tight geometry AABB; element boxes that poke outside it are
 * the same spurious origin-anchored spatial elements the merged-box clamp strips,
 * so they're dropped here too (otherwise they smear the silhouette / balloon the
 * framing box). When `model.box` is unavailable (very early, pre-stream), every
 * non-empty box is kept.
 *
 * **Coordinate frame**: `getBoxes` returns boxes already in the coordinated
 * (autoCoordinate) world frame — the same frame `getMergedBox` /
 * `computeWorldSceneBox` use, and the OPPOSITE of raw `getPositions` / edge
 * buffers (local space). Do NOT apply the model world matrix here; doing so would
 * double-offset non-first federated models.
 */
export async function collectVisibleSolidBoxes(
  ctx: ViewerContext,
  opts: {
    hidden: ItemId[];
    xrayed: ItemId[];
    boxCache: Map<string, ShadowBoxCacheEntry>;
  },
): Promise<{ boxes: THREE.Box3[]; framingBox: THREE.Box3 }> {
  const boxes: THREE.Box3[] = [];
  const framingBox = new THREE.Box3();

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
    let entry = opts.boxCache.get(modelId);
    if (!entry) {
      try {
        const ids = [
          ...(await (
            model as unknown as { getLocalIds(): Promise<Iterable<number>> }
          ).getLocalIds()),
        ];
        const got = await (model as FRAGS.FragmentsModel).getBoxes(ids);
        entry = { ids, boxes: got };
        opts.boxCache.set(modelId, entry);
      } catch {
        continue;
      }
    }

    const excluded = excludedByModel.get(modelId);
    const modelBox = model.box;
    let bounds: THREE.Box3 | null = null;
    if (modelBox && !modelBox.isEmpty()) {
      const eps = modelBox.getSize(_tmpSize).length() * 1e-3 + 1e-3;
      bounds = modelBox.clone().expandByScalar(eps);
    }

    const n = Math.min(entry.ids.length, entry.boxes.length);
    for (let i = 0; i < n; i++) {
      const id = entry.ids[i] as number;
      if (excluded?.has(id)) continue;
      const b = entry.boxes[i];
      if (!b || b.isEmpty()) continue;
      if (bounds !== null && !bounds.containsBox(b)) continue;
      boxes.push(b);
      framingBox.union(b);
    }
  }

  return { boxes, framingBox };
}

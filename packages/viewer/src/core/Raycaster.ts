/**
 * Pointer→FragmentsModels raycast helper. We don't use three.js's
 * `THREE.Raycaster` directly: `FragmentsModel.raycast` is GPU/worker-
 * accelerated and returns the BIM `localId` we actually need. This
 * module just wraps the multi-model dispatch.
 */

import * as THREE from 'three';
import type * as FRAGS from '@thatopen/fragments';

import type { ItemId, ViewerContext } from './types.js';

export interface PickResult {
  item: ItemId;
  /** World-space hit point. */
  point: { x: number; y: number; z: number };
  distance: number;
  /** Underlying model that was hit. */
  model: FRAGS.FragmentsModel;
  /** Underlying raycast result for advanced consumers. */
  raw: FRAGS.RaycastResult;
}

/**
 * NDC → client-pixel coords for `FragmentsModel.raycast*`. The library expects
 * `mouse` in **client pixels** (it does its own client→NDC conversion using
 * `getBoundingClientRect`); passing NDC here yields a silent miss after the
 * second conversion. Uses `rect.width/height` (not `clientWidth/clientHeight`)
 * to stay consistent with `clientToNdc`.
 */
function ndcToClientMouse(
  canvas: HTMLCanvasElement,
  ndc: { x: number; y: number },
): THREE.Vector2 {
  const rect = canvas.getBoundingClientRect();
  return new THREE.Vector2(
    ((ndc.x + 1) / 2) * rect.width + rect.left,
    ((1 - ndc.y) / 2) * rect.height + rect.top,
  );
}

function toPickResult(
  ctx: ViewerContext,
  model: FRAGS.FragmentsModel,
  result: FRAGS.RaycastResult,
): PickResult {
  return {
    item: { modelId: getModelId(ctx, model), localId: result.localId },
    point: { x: result.point.x, y: result.point.y, z: result.point.z },
    distance: result.distance,
    model,
    raw: result,
  };
}

export async function pick(
  ctx: ViewerContext,
  ndc: { x: number; y: number },
): Promise<PickResult | null> {
  const camera = ctx.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
  const canvas = ctx.canvas;
  const mouse = ndcToClientMouse(canvas, ndc);

  // Dispatch every model's worker raycast concurrently rather than awaiting each
  // in turn — on a federated (multi-discipline) scene the serial loop paid N
  // sequential worker round-trips (~5–50ms each) per pick. The per-model
  // `.catch(() => null)` preserves the old per-model fault isolation (one model
  // failing must not abort the others), and the nearest-distance reduction below
  // is order-independent, so the chosen hit is identical to the serial version.
  const models = [...ctx.models().values()];
  const hits = await Promise.all(
    models.map(async (model) => {
      try {
        const result = await model.raycast({ camera, mouse, dom: canvas });
        return result ? { model, result } : null;
      } catch {
        return null;
      }
    }),
  );

  let best: PickResult | null = null;
  for (const hit of hits) {
    if (!hit) continue;
    if (!best || hit.result.distance < best.distance) {
      best = toPickResult(ctx, hit.model, hit.result);
    }
  }
  return best;
}

/**
 * Like {@link pick}, but returns **every** surface the ray crosses across all
 * models, sorted near→far. Backed by `FragmentsModel.raycastAll`, which (unlike
 * `raycast`) does not stop at the first hit — so callers can see through a wall
 * to the geometry behind it. Used by the pivot-rotate plugin to choose an orbit
 * point that respects selection / x-ray rather than blindly grabbing the
 * closest surface. Results are NOT pre-sorted by the library, so we sort here.
 */
export async function pickAll(
  ctx: ViewerContext,
  ndc: { x: number; y: number },
): Promise<PickResult[]> {
  const camera = ctx.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
  const canvas = ctx.canvas;
  const mouse = ndcToClientMouse(canvas, ndc);

  // Concurrent per-model dispatch (see `pick`). The final near→far sort is over
  // the union of all models' hits, so it is order-independent — results are
  // identical to the old serial loop, only the dispatch is parallel.
  const models = [...ctx.models().values()];
  const perModel = await Promise.all(
    models.map(async (model) => {
      try {
        const results = await model.raycastAll({ camera, mouse, dom: canvas });
        return results ? { model, results } : null;
      } catch {
        return null;
      }
    }),
  );

  const hits: PickResult[] = [];
  for (const entry of perModel) {
    if (!entry) continue;
    for (const result of entry.results) {
      hits.push(toPickResult(ctx, entry.model, result));
    }
  }
  hits.sort((a, b) => a.distance - b.distance);
  return hits;
}

/** Reverse-lookup the modelId for a model. The map keys it. */
function getModelId(ctx: ViewerContext, model: FRAGS.FragmentsModel): string {
  for (const [id, m] of ctx.models()) {
    if (m === model) return id;
  }
  return '';
}

/** Convert a pointer event's clientX/Y to NDC for the given canvas. */
export function clientToNdc(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * 2 - 1,
    y: -(((clientY - rect.top) / rect.height) * 2 - 1),
  };
}

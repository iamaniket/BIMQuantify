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

  let best: PickResult | null = null;
  for (const model of ctx.models().values()) {
    let result: FRAGS.RaycastResult | null;
    try {
      result = await model.raycast({ camera, mouse, dom: canvas });
    } catch {
      continue;
    }
    if (!result) continue;
    if (!best || result.distance < best.distance) {
      best = toPickResult(ctx, model, result);
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

  const hits: PickResult[] = [];
  for (const model of ctx.models().values()) {
    let results: FRAGS.RaycastResult[] | null;
    try {
      results = await model.raycastAll({ camera, mouse, dom: canvas });
    } catch {
      continue;
    }
    if (!results) continue;
    for (const result of results) {
      hits.push(toPickResult(ctx, model, result));
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

/**
 * Pointer→FragmentsModels raycast helper. We don't use three.js's
 * `THREE.Raycaster` directly: `FragmentsModel.raycast` is GPU/worker-
 * accelerated and returns the BIM `localId` we actually need. This
 * module just wraps the multi-model dispatch.
 */

import type * as THREE from 'three';
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

export async function pick(
  ctx: ViewerContext,
  ndc: { x: number; y: number },
): Promise<PickResult | null> {
  const camera = ctx.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
  const canvas = ctx.canvas;
  // FragmentsModel.raycast expects `mouse` in NDC.
  const mouse = { x: ndc.x, y: ndc.y } as unknown as THREE.Vector2;

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
      best = {
        item: { modelId: getModelId(ctx, model), localId: result.localId },
        point: { x: result.point.x, y: result.point.y, z: result.point.z },
        distance: result.distance,
        model,
        raw: result,
      };
    }
  }
  return best;
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

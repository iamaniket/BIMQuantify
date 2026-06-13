import * as THREE from 'three';

import type { ViewerContext } from '../../../core/types.js';

/**
 * World matrix ThatOpen applied to a model's root object — its `autoCoordinate`
 * translation that re-bases federated models onto the first-loaded model's origin.
 *
 * `FragmentsModels` loads with `settings.autoCoordinate: true`: the first model
 * defines the coordinate base and renders un-shifted, while every later model has
 * `model.object.position` translated by `(base - itsCoordinates)` so all models
 * share one origin. Scene-sibling overlays (outline groups, CSS2D markers) live at
 * scene identity and MUST apply this, or they render in the model's un-coordinated
 * local frame and appear translated for every model after the first.
 *
 * Returns identity if the model isn't loaded yet — overlays re-apply on
 * `model:loaded`, by which point the coordination is final.
 */
export function getModelWorldMatrix(
  ctx: ViewerContext,
  modelId: string,
): THREE.Matrix4 {
  const obj = ctx.models().get(modelId)?.object;
  if (!obj) return new THREE.Matrix4();
  // Update self + ancestors, but skip the (potentially huge) child tree.
  obj.updateWorldMatrix(true, false);
  return obj.matrixWorld.clone();
}

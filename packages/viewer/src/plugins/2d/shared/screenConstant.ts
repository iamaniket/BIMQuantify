/**
 * Helpers for annotations that live in the shared world-space scene but must
 * behave like screen-space UI.
 *
 * Under the ortho camera, world geometry scales with zoom. Most annotations
 * *should* scale with the document (they're anchored to the page), but a few
 * glyphs must stay a constant size on screen at any zoom — entity-marker pins
 * and the measure snap indicator. Those are authored in "px" units inside a
 * group whose scale is set to {@link SceneAPI.worldPerPx}, re-applied whenever
 * the camera changes.
 */

import * as THREE from 'three';

import type { DocumentContext } from '../../../pdf-core/documentTypes.js';
import type { SceneAPI } from '../scene/index.js';

/**
 * Scale a group so that geometry authored in px renders at a constant size on
 * screen regardless of camera zoom. Call on install and on every `camera:change`.
 */
export function applyConstantScale(group: THREE.Object3D, sceneApi: SceneAPI): void {
  const s = sceneApi.worldPerPx();
  group.scale.set(s, s, 1);
}

/** Map a pointer/mouse event to a world-space point via the shared camera. */
export function containerPointToWorld(
  e: { clientX: number; clientY: number },
  ctx: DocumentContext,
  sceneApi: SceneAPI,
): { x: number; y: number } {
  const rect = ctx.container.getBoundingClientRect();
  return sceneApi.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
}

/**
 * Recursively dispose every geometry + material (+ texture map) under an object,
 * then detach it. Shared by the measure / markup / entity-marker layers so each
 * doesn't reimplement disposal.
 */
export function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh & THREE.Line;
    mesh.geometry?.dispose?.();
    const mat = (o as unknown as { material?: THREE.Material | THREE.Material[] }).material;
    if (mat) {
      const mats = Array.isArray(mat) ? mat : [mat];
      for (const m of mats) {
        (m as THREE.Material & { map?: THREE.Texture | null }).map?.dispose?.();
        m.dispose();
      }
    }
  });
}

/** Dispose + clear every child of a group (keeps the group attached). */
export function clearGroup(group: THREE.Group | null): void {
  if (!group) return;
  for (const child of [...group.children]) disposeObject(child);
  group.clear();
}

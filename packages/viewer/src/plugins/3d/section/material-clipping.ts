/**
 * Material-clipping subsystem for the section plugin.
 *
 * With `localClippingPlanes = true` OBC assigns `material.clippingPlanes` only
 * to materials it tracks (its `FragmentsManager`), so this viewer's private
 * fragment materials never clip. This controller pushes the live
 * `SimplePlane.three` planes onto every material in `ctx.models()` itself and
 * keeps them clipped as geometry streams in.
 *
 * It does NOT own the `Clipper` or the plane-ID maps. It receives what it needs
 * by injection: a getter for the live context, a getter that reads the live
 * `clipper.list` (the `SimplePlane` map), and a getter for the global `enabled`
 * flag (clipping stops when `enabled === false`). It reads live state
 * (`clipper.list`, `plane.enabled`) rather than caching ownership.
 */

import type * as THREE from 'three';
import type { SimplePlane } from '@thatopen/components';
import type { ViewerContext } from '../../../core/types.js';

/** Minimal shape of the FragmentsModels material list we hook for streaming tiles. */
interface MaterialItemEvent {
  value: THREE.Material;
}
interface MaterialListEvent {
  add(cb: (e: MaterialItemEvent) => void): void;
  remove(cb: (e: MaterialItemEvent) => void): void;
}
interface MaterialList {
  onItemSet: MaterialListEvent;
}

export interface MaterialClippingSync {
  /**
   * Rebuild the active-plane array and assign it to every fragment material.
   * Called only on structural changes (add/remove/toggle/enable/model-load) —
   * NOT per gizmo-drag frame, since materials reference the live `plane.three`
   * objects that drags mutate in place. Flips `needsUpdate` only when the count
   * changes (shader recompiles on `NUM_CLIPPING_PLANES`); same-count moves don't.
   */
  sync(): void;
  /** Wire the streaming-material + model-loaded subscriptions. Call in `install`. */
  install(): void;
  /** Tear down subscriptions and drop our planes off every fragment material. */
  uninstall(): void;
}

export interface MaterialClippingDeps {
  /** Read the live viewer context (null before install / after uninstall). */
  getCtx(): ViewerContext | null;
  /** Read the live `SimplePlane` list owned by the `Clipper`. */
  getPlanes(): Iterable<SimplePlane>;
  /** Read the global feature-enabled flag. */
  isEnabled(): boolean;
}

export function createMaterialClippingSync(
  deps: MaterialClippingDeps,
): MaterialClippingSync {
  // Material-clipping state. We keep `material.clippingPlanes` pointed at the
  // live `SimplePlane.three` array; gizmo drags mutate those planes in place,
  // so we only rebuild + flip `needsUpdate` when the active count changes.
  let clipArray: THREE.Plane[] | null = null;
  let clipCount = 0;
  let materialList: MaterialList | null = null;
  let onMaterialSet: ((e: MaterialItemEvent) => void) | null = null;
  let modelLoadedUnsub: (() => void) | null = null;

  /** Live `THREE.Plane`s for the active planes, or empty when the feature is off. */
  const collectActivePlanes = (): THREE.Plane[] => {
    const arr: THREE.Plane[] = [];
    if (!deps.isEnabled()) return arr;
    for (const plane of deps.getPlanes()) {
      if (plane.enabled) arr.push(plane.three);
    }
    return arr;
  };

  const forEachMaterial = (fn: (mat: THREE.Material) => void): void => {
    const ctx = deps.getCtx();
    if (!ctx) return;
    for (const model of ctx.models().values()) {
      model.object.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach(fn);
        else if (mat) fn(mat);
      });
    }
  };

  const sync = (): void => {
    const ctx = deps.getCtx();
    if (!ctx) return;
    const planes = collectActivePlanes();
    clipArray = planes.length > 0 ? planes : null;
    const countChanged = planes.length !== clipCount;
    forEachMaterial((mat) => {
      mat.clippingPlanes = clipArray;
      if (countChanged) mat.needsUpdate = true;
    });
    clipCount = planes.length;
    ctx.renderer.localClippingEnabled = planes.length > 0;
    ctx.requestRender();
  };

  const install = (): void => {
    const ctx = deps.getCtx();
    if (!ctx) return;

    // Keep streamed-in geometry clipped: new fragment materials start with
    // `clippingPlanes = null`, so apply the active set as each one is created.
    materialList =
      (ctx.fragments as unknown as { models?: { materials?: { list?: MaterialList } } })
        .models?.materials?.list ?? null;
    if (materialList) {
      onMaterialSet = ({ value: material }): void => {
        if (clipArray && material) {
          material.clippingPlanes = clipArray;
          material.needsUpdate = true;
        }
      };
      materialList.onItemSet.add(onMaterialSet);
    }
    // A whole new model (federated add) needs its existing materials clipped.
    modelLoadedUnsub = ctx.events.on('model:loaded', () => {
      if (clipArray) sync();
    });
  };

  const uninstall = (): void => {
    modelLoadedUnsub?.();
    modelLoadedUnsub = null;
    if (materialList && onMaterialSet) {
      materialList.onItemSet.remove(onMaterialSet);
    }
    materialList = null;
    onMaterialSet = null;

    // Drop our planes off every fragment material.
    clipArray = null;
    clipCount = 0;
    forEachMaterial((mat) => {
      if (mat.clippingPlanes) {
        mat.clippingPlanes = null;
        mat.needsUpdate = true;
      }
    });
  };

  return { sync, install, uninstall };
}

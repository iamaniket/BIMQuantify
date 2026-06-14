import * as THREE from 'three';

import { LAYER_OVERLAY } from '../../../core/layers.js';
import type { Plugin, ViewerContext, ItemId } from '../../../core/types.js';
import {
  acquireCss2dOverlay,
  releaseCss2dOverlay,
} from '../shared/css2d-overlay.js';
import type { Css2dOverlay } from '../shared/css2d-overlay.js';

const NAME = 'bounding-boxer' as const;

export interface BboxDimensions {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
  width: number;
  height: number;
  depth: number;
}

export interface BoundingBoxerPluginAPI {
  show(items?: ItemId[]): void;
  hide(): void;
  dimensions(items?: ItemId[]): BboxDimensions | null;
  /** Tight merged AABB around exactly the given items (async — reads geometry). */
  itemsBox(items: ItemId[]): Promise<BboxDimensions | null>;
}

export function boundingBoxerPlugin(): Plugin & BoundingBoxerPluginAPI {
  let ctxRef: ViewerContext | null = null;
  let overlay: Css2dOverlay | null = null;
  let boxHelper: THREE.Box3Helper | null = null;
  let dimLabels: THREE.Object3D[] = [];

  // The box + dimension labels only move on screen when the camera moves
  // (handled by the shared overlay's camera:change subscription); we just
  // nudge a one-shot repaint when the box is shown/cleared rather than a
  // perpetual rAF loop. Names kept so call sites stay untouched.
  const startCss2dLoop = (): void => {
    overlay?.requestRender();
  };

  const stopCss2dLoop = (): void => {
    // no-op: overlay rendering is event-driven (camera:change + requestRender)
  };

  const computeBox = (items?: ItemId[]): THREE.Box3 => {
    const box = new THREE.Box3();
    if (!ctxRef) return box;
    const models = ctxRef.models();

    if (items && items.length > 0) {
      for (const item of items) {
        const model = models.get(item.modelId);
        if (!model) continue;
        const modelBox = model.box;
        if (modelBox && !modelBox.isEmpty()) box.union(modelBox);
      }
    } else {
      for (const model of models.values()) {
        const modelBox = model.box;
        if (modelBox && !modelBox.isEmpty()) box.union(modelBox);
      }
    }
    return box;
  };

  const formatDim = (d: number): string => {
    if (d < 0.01) return `${(d * 1000).toFixed(1)} mm`;
    if (d < 1) return `${(d * 1000).toFixed(0)} mm`;
    return `${d.toFixed(3)} m`;
  };

  const clearVisuals = (): void => {
    if (boxHelper) {
      boxHelper.removeFromParent();
      boxHelper.geometry.dispose();
      (boxHelper.material as THREE.Material).dispose();
      boxHelper = null;
    }
    for (const label of dimLabels) {
      overlay?.removeLabel(label as never);
      label.removeFromParent();
    }
    dimLabels = [];
    stopCss2dLoop();
    // The box helper is a 3D scene object — wake the on-demand renderer so its
    // removal is drawn (no camera move / tracked event triggers this).
    ctxRef?.requestRender();
  };

  const showBox = (items?: ItemId[]): void => {
    if (!ctxRef || !overlay) return;
    clearVisuals();
    const box = computeBox(items);
    if (box.isEmpty()) return;

    const color = new THREE.Color(0x00bcd4);
    boxHelper = new THREE.Box3Helper(box, color);
    boxHelper.renderOrder = 998;
    boxHelper.layers.set(LAYER_OVERLAY);
    ctxRef.scene.add(boxHelper);

    const size = box.getSize(new THREE.Vector3());
    const min = box.min;
    const max = box.max;

    // Width label (X axis)
    const widthPos = new THREE.Vector3((min.x + max.x) / 2, min.y, min.z);
    const widthLabel = overlay.createLabel(`W: ${formatDim(size.x)}`, widthPos);
    widthLabel.layers.set(LAYER_OVERLAY);
    dimLabels.push(widthLabel);

    // Height label (Y axis)
    const heightPos = new THREE.Vector3(min.x, (min.y + max.y) / 2, min.z);
    const heightLabel = overlay.createLabel(`H: ${formatDim(size.y)}`, heightPos);
    heightLabel.layers.set(LAYER_OVERLAY);
    dimLabels.push(heightLabel);

    // Depth label (Z axis)
    const depthPos = new THREE.Vector3(min.x, min.y, (min.z + max.z) / 2);
    const depthLabel = overlay.createLabel(`D: ${formatDim(size.z)}`, depthPos);
    depthLabel.layers.set(LAYER_OVERLAY);
    dimLabels.push(depthLabel);

    startCss2dLoop();
    // The Box3Helper is a 3D scene object — wake the on-demand renderer so it's
    // drawn even though showing the box isn't a camera move / tracked event.
    ctxRef.requestRender();
  };

  const getDimensions = (items?: ItemId[]): BboxDimensions | null => {
    const box = computeBox(items);
    if (box.isEmpty()) return null;
    const size = box.getSize(new THREE.Vector3());
    return {
      min: { x: box.min.x, y: box.min.y, z: box.min.z },
      max: { x: box.max.x, y: box.max.y, z: box.max.z },
      width: size.x,
      height: size.y,
      depth: size.z,
    };
  };

  // Per-ITEM merged box (not the whole-model box `computeBox`/`bbox.get`
  // return). Uses the FragmentsModel `getMergedBox(localIds)` API — the same
  // one the camera plugin uses to frame a selection — so the result is the
  // tight AABB around exactly the given elements.
  const getItemsBox = async (items: ItemId[]): Promise<BboxDimensions | null> => {
    if (!ctxRef || items.length === 0) return null;
    const byModel = new Map<string, number[]>();
    for (const it of items) {
      let arr = byModel.get(it.modelId);
      if (!arr) { arr = []; byModel.set(it.modelId, arr); }
      arr.push(it.localId);
    }
    const box = new THREE.Box3();
    const models = ctxRef.models();
    for (const [modelId, ids] of byModel) {
      const model = models.get(modelId);
      if (!model) continue;
      try {
        const mb = await (model as unknown as {
          getMergedBox(localIds: number[]): Promise<THREE.Box3>;
        }).getMergedBox(ids);
        if (!mb.isEmpty()) box.union(mb);
      } catch {
        // ignore; some items may have no geometry
      }
    }
    if (box.isEmpty()) return null;
    const size = box.getSize(new THREE.Vector3());
    return {
      min: { x: box.min.x, y: box.min.y, z: box.min.z },
      max: { x: box.max.x, y: box.max.y, z: box.max.z },
      width: size.x,
      height: size.y,
      depth: size.z,
    };
  };

  const api: Plugin & BoundingBoxerPluginAPI = {
    name: NAME,
    optionalDependencies: ['selection'],

    show(items) {
      showBox(items);
    },

    hide() {
      clearVisuals();
    },

    dimensions(items) {
      return getDimensions(items);
    },

    itemsBox(items) {
      return getItemsBox(items);
    },

    install(ctx: ViewerContext) {
      ctxRef = ctx;
      overlay = acquireCss2dOverlay(ctx);

      ctx.commands.register('bbox.show', (args: unknown) => {
        const items = (args as { items?: ItemId[] })?.items;
        showBox(items);
      }, { title: 'Show bounding box' });

      ctx.commands.register('bbox.hide', () => clearVisuals(), {
        title: 'Hide bounding box',
      });

      ctx.commands.register('bbox.get', (args: unknown) => {
        const items = (args as { items?: ItemId[] })?.items;
        return getDimensions(items);
      }, { title: 'Get bounding box dimensions' });

      ctx.commands.register('bbox.getItems', (args: unknown) => {
        const items = (args as { items?: ItemId[] })?.items ?? [];
        return getItemsBox(items);
      }, { title: 'Get merged bounding box of specific items' });
    },

    uninstall() {
      clearVisuals();
      releaseCss2dOverlay();
      overlay = null;
      ctxRef = null;
    },
  };

  return api;
}

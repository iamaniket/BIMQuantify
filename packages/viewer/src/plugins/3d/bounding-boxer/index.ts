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
}

export function boundingBoxerPlugin(): Plugin & BoundingBoxerPluginAPI {
  let ctxRef: ViewerContext | null = null;
  let overlay: Css2dOverlay | null = null;
  let boxHelper: THREE.Box3Helper | null = null;
  let dimLabels: THREE.Object3D[] = [];
  let css2dRafId: number | null = null;

  const startCss2dLoop = (): void => {
    if (css2dRafId !== null || !overlay) return;
    const tick = (): void => {
      overlay?.render();
      css2dRafId = requestAnimationFrame(tick);
    };
    css2dRafId = requestAnimationFrame(tick);
  };

  const stopCss2dLoop = (): void => {
    if (css2dRafId !== null) {
      cancelAnimationFrame(css2dRafId);
      css2dRafId = null;
    }
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

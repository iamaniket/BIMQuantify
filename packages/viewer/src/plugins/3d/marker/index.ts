import * as THREE from 'three';

import { LAYER_OVERLAY } from '../../../core/layers.js';
import type { Plugin, ViewerContext, Vec3 } from '../../../core/types.js';
import {
  acquireCss2dOverlay,
  releaseCss2dOverlay,
  CSS2DObject,
} from '../shared/css2d-overlay.js';
import type { Css2dOverlay } from '../shared/css2d-overlay.js';

const NAME = 'marker' as const;

export interface MarkerData {
  id: string;
  label: string;
  position: Vec3;
  color?: number;
  visible: boolean;
}

export interface MarkerPluginOptions {
  markerColor?: number;
  markerSize?: number;
  showLabels?: boolean;
}

export interface MarkerPluginAPI {
  create(position: Vec3, label: string, options?: { color?: number }): MarkerData;
  remove(id: string): void;
  list(): MarkerData[];
  setVisible(id: string, visible: boolean): void;
  clear(): void;
}

let nextMarkerId = 0;

export function markerPlugin(options: MarkerPluginOptions = {}): Plugin & MarkerPluginAPI {
  let ctxRef: ViewerContext | null = null;
  let overlay: Css2dOverlay | null = null;

  const defaultColor = options.markerColor ?? 0xff5722;
  const markerSize = options.markerSize ?? 1;
  const showLabels = options.showLabels ?? true;

  const markers = new Map<string, MarkerData>();
  const markerObjects = new Map<string, { group: THREE.Group; label: CSS2DObject; pin: THREE.Mesh }>();

  const DOT_GEO = new THREE.SphereGeometry(0.06 * markerSize, 12, 12);

  // Markers only move on screen when the camera moves (handled by the shared
  // overlay's camera:change subscription) or when a marker is added/removed/
  // toggled — so nudge a one-shot repaint on change rather than a perpetual
  // rAF loop. Names kept so call sites stay untouched.
  const startCss2dLoop = (): void => {
    overlay?.requestRender();
  };

  const stopCss2dLoop = (): void => {
    // no-op: overlay rendering is event-driven (camera:change + requestRender)
  };

  const emitChange = (): void => {
    ctxRef?.events.emit('marker:change', {
      markers: [...markers.values()].map((m) => ({
        id: m.id,
        label: m.label,
        position: m.position,
      })),
    });
  };

  const getModelScale = (): number => {
    if (!ctxRef) return 10;
    const box = new THREE.Box3();
    for (const model of ctxRef.models().values()) {
      const mBox = model.box;
      if (mBox && !mBox.isEmpty()) box.union(mBox);
    }
    if (box.isEmpty()) return 10;
    const size = box.getSize(new THREE.Vector3());
    return Math.max(size.x, size.y, size.z, 1);
  };

  const createMarkerVisual = (data: MarkerData): void => {
    if (!ctxRef || !overlay) return;
    const color = data.color ?? defaultColor;
    const scale = Math.max(getModelScale() / 150, 0.03) * markerSize;

    const group = new THREE.Group();
    group.renderOrder = 999;

    const mat = new THREE.MeshBasicMaterial({ color, depthTest: false });
    const pin = new THREE.Mesh(DOT_GEO, mat);
    pin.position.set(data.position.x, data.position.y, data.position.z);
    pin.scale.setScalar(scale / 0.06);
    pin.layers.set(LAYER_OVERLAY);
    group.add(pin);

    const labelPos = new THREE.Vector3(
      data.position.x,
      data.position.y + scale * 2,
      data.position.z,
    );
    const labelObj = overlay.createLabel(
      showLabels ? data.label : '',
      labelPos,
      group,
    );
    labelObj.layers.set(LAYER_OVERLAY);

    const el = labelObj.element;
    el.style.fontSize = '11px';
    el.style.fontWeight = '600';
    el.style.cursor = 'pointer';
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    el.style.background = `rgba(${r},${g},${b},0.85)`;
    el.style.padding = '2px 6px';
    el.style.borderRadius = '4px';

    el.addEventListener('click', () => {
      ctxRef?.events.emit('marker:click', {
        id: data.id,
        position: data.position,
      });
    });

    group.visible = data.visible;
    ctxRef.scene.add(group);
    markerObjects.set(data.id, { group, label: labelObj, pin });
    startCss2dLoop();
  };

  const removeMarkerVisual = (id: string): void => {
    const obj = markerObjects.get(id);
    if (!obj) return;
    overlay?.removeLabel(obj.label);
    obj.pin.geometry !== DOT_GEO && obj.pin.geometry.dispose();
    (obj.pin.material as THREE.Material).dispose();
    obj.group.removeFromParent();
    markerObjects.delete(id);
    if (markerObjects.size === 0) stopCss2dLoop();
  };

  const api: Plugin & MarkerPluginAPI = {
    name: NAME,

    create(position, label, opts) {
      const id = `marker-${String(++nextMarkerId)}`;
      const data: MarkerData = {
        id,
        label,
        position,
        color: opts?.color ?? defaultColor,
        visible: true,
      };
      markers.set(id, data);
      createMarkerVisual(data);
      emitChange();
      return data;
    },

    remove(id) {
      removeMarkerVisual(id);
      markers.delete(id);
      emitChange();
    },

    list() {
      return [...markers.values()];
    },

    setVisible(id, visible) {
      const data = markers.get(id);
      if (!data) return;
      data.visible = visible;
      const obj = markerObjects.get(id);
      if (obj) obj.group.visible = visible;
      // CSS2DRenderer only hides/shows the label DOM on a render pass.
      overlay?.requestRender();
      emitChange();
    },

    clear() {
      for (const id of markers.keys()) {
        removeMarkerVisual(id);
      }
      markers.clear();
      emitChange();
    },

    install(ctx: ViewerContext) {
      ctxRef = ctx;
      overlay = acquireCss2dOverlay(ctx);

      ctx.commands.register('marker.create', (args: unknown) => {
        const { position, label, color } = args as { position: Vec3; label: string; color?: number };
        return api.create(position, label, color !== undefined ? { color } : {});
      }, { title: 'Create marker' });

      ctx.commands.register('marker.delete', (args: unknown) => {
        const { id } = args as { id: string };
        api.remove(id);
      }, { title: 'Delete marker' });

      ctx.commands.register('marker.list', () => api.list(), {
        title: 'List markers',
      });

      ctx.commands.register('marker.setVisible', (args: unknown) => {
        const { id, visible } = args as { id: string; visible: boolean };
        api.setVisible(id, visible);
      }, { title: 'Show/hide marker' });

      ctx.commands.register('marker.clear', () => api.clear(), {
        title: 'Clear all markers',
      });
    },

    uninstall() {
      api.clear();
      DOT_GEO.dispose();
      releaseCss2dOverlay();
      overlay = null;
      ctxRef = null;
    },
  };

  return api;
}

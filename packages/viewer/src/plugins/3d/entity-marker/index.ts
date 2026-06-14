import * as THREE from 'three';

import { LAYER_OVERLAY } from '../../../core/layers.js';
import type { Plugin, ViewerContext, Vec3 } from '../../../core/types.js';
import {
  MARKER_DIAMETER_PX,
  MARKER_RING_PX,
  findingFillColor,
  findingRingColor,
} from '../../shared/findingMarkerStyle.js';
import {
  acquireCss2dOverlay,
  releaseCss2dOverlay,
  CSS2DObject,
} from '../shared/css2d-overlay.js';
import type { Css2dOverlay } from '../shared/css2d-overlay.js';
import { getModelWorldMatrix } from '../shared/modelCoordination.js';

const NAME = 'entity-marker' as const;

export interface EntityMarkerData {
  id: string;
  type: 'finding' | 'certificate' | 'attachment';
  /**
   * Anchor in the marker's model's LOCAL frame (the un-coordinated frame the
   * finding was authored in). Re-based to the federated scene via the model's
   * `autoCoordinate` transform at render time — see {@link getModelWorldMatrix}.
   */
  position: Vec3;
  /** Viewer scene id of the model this anchor belongs to (`file-<fileId>`). */
  modelId: string;
  label: string;
  entityId: string;
  /** Finding lifecycle status — drives the circle color for findings. */
  status?: string;
  /** Render at reduced opacity (e.g. not associated with the isolated object). */
  dimmed?: boolean;
}

export interface EntityMarkerPluginAPI {
  sync(markers: EntityMarkerData[]): void;
  clear(): void;
  setVisible(visible: boolean): void;
}

const MARKER_COLORS: Record<string, string> = {
  finding: '#EF4444',
  certificate: '#3B82F6',
  attachment: '#10B981',
};

const DIMMED_OPACITY = '0.25';

// Inner-disc fill. Findings use their lifecycle status color (shared source of
// truth with the 2D plugin); cert/attachment keep their solid type color.
const fillFor = (data: EntityMarkerData): string => {
  if (data.type === 'finding') return findingFillColor(data.status);
  return MARKER_COLORS[data.type] ?? '#888';
};

// Ring color. Findings: red while open, neutral once resolved/verified.
// cert/attachment keep a plain white ring.
const ringFor = (data: EntityMarkerData): string => {
  if (data.type === 'finding') return findingRingColor(data.status);
  return '#fff';
};

export function entityMarkerPlugin(): Plugin & EntityMarkerPluginAPI {
  let ctxRef: ViewerContext | null = null;
  let overlay: Css2dOverlay | null = null;
  let globalVisible = true;
  let offLoaded: (() => void) | null = null;

  const activeMarkers = new Map<
    string,
    { data: EntityMarkerData; obj: CSS2DObject; group: THREE.Group; wrapper: HTMLDivElement; circle: HTMLDivElement }
  >();

  // Markers only move on screen when the camera moves (handled by the shared
  // overlay's own camera:change subscription) or when markers are added/
  // removed/restyled — so we just nudge a one-shot repaint on change instead
  // of running a perpetual rAF loop. Names kept so call sites stay untouched.
  const startCss2dLoop = (): void => {
    overlay?.requestRender();
  };

  const stopCss2dLoop = (): void => {
    // no-op: overlay rendering is event-driven (camera:change + requestRender)
  };

  const createMarkerElement = (data: EntityMarkerData): { wrapper: HTMLDivElement; circle: HTMLDivElement } => {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      pointer-events: auto;
      cursor: pointer;
      opacity: ${data.dimmed ? DIMMED_OPACITY : '1'};
      transition: opacity 150ms ease;
    `;

    const tooltip = document.createElement('span');
    tooltip.textContent = data.label;
    tooltip.style.cssText = `
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%);
      white-space: nowrap;
      max-width: 180px;
      overflow: hidden;
      text-overflow: ellipsis;
      background: rgba(0,0,0,0.8);
      color: #fff;
      font-size: 11px;
      font-weight: 500;
      padding: 2px 6px;
      border-radius: 4px;
      margin-bottom: 4px;
      opacity: 0;
      transition: opacity 150ms ease;
      pointer-events: none;
    `;

    // Plain filled circle — no icon. The status-colored fill sits inside a ring
    // (red while open, neutral once resolved). A thin white halo via box-shadow
    // keeps the red ring legible on busy/red backgrounds. Kept lightweight: a
    // DOM overlay, never part of the model tessellation.
    const circle = document.createElement('div');
    circle.style.cssText = `
      width: ${MARKER_DIAMETER_PX}px;
      height: ${MARKER_DIAMETER_PX}px;
      border-radius: 50%;
      background: ${fillFor(data)};
      border: ${MARKER_RING_PX}px solid ${ringFor(data)};
      box-shadow: 0 0 0 1px rgba(255,255,255,0.55), 0 1px 3px rgba(0,0,0,0.4);
      transition: transform 150ms ease;
    `;

    wrapper.appendChild(tooltip);
    wrapper.appendChild(circle);

    wrapper.addEventListener('mouseenter', () => {
      tooltip.style.opacity = '1';
      circle.style.transform = 'scale(1.3)';
    });
    wrapper.addEventListener('mouseleave', () => {
      tooltip.style.opacity = '0';
      circle.style.transform = 'scale(1)';
    });

    wrapper.addEventListener('click', () => {
      ctxRef?.events.emit('entity-marker:click', {
        id: data.id,
        type: data.type,
        entityId: data.entityId,
        position: data.position,
      });
    });

    return { wrapper, circle };
  };

  // Place the CSS2D object at the anchor re-based into the federated scene: the
  // local anchor times the model's autoCoordinate transform. Identity (no shift)
  // when the model is the coordinate base or not yet loaded.
  const placeMarker = (obj: CSS2DObject, data: EntityMarkerData): void => {
    const pos = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
    if (ctxRef) pos.applyMatrix4(getModelWorldMatrix(ctxRef, data.modelId));
    obj.position.copy(pos);
  };

  const addMarker = (data: EntityMarkerData): void => {
    if (!ctxRef || !overlay) return;

    const group = new THREE.Group();
    group.renderOrder = 998;

    const { wrapper, circle } = createMarkerElement(data);
    const obj = new CSS2DObject(wrapper);
    placeMarker(obj, data);
    obj.layers.set(LAYER_OVERLAY);
    group.add(obj);

    group.visible = globalVisible;
    ctxRef.scene.add(group);
    activeMarkers.set(data.id, { data, obj, group, wrapper, circle });
    startCss2dLoop();
  };

  // In-place restyle for color/dim changes — avoids destroying and recreating
  // the CSS2D object (and its event listeners) when only the status or the
  // dim flag moves.
  const updateMarker = (
    entry: { data: EntityMarkerData; wrapper: HTMLDivElement; circle: HTMLDivElement },
    data: EntityMarkerData,
  ): void => {
    entry.circle.style.background = fillFor(data);
    entry.circle.style.borderColor = ringFor(data);
    entry.wrapper.style.opacity = data.dimmed ? DIMMED_OPACITY : '1';
    entry.data = data;
  };

  const removeMarker = (id: string): void => {
    const entry = activeMarkers.get(id);
    if (!entry) return;
    overlay?.removeLabel(entry.obj);
    entry.group.removeFromParent();
    activeMarkers.delete(id);
    if (activeMarkers.size === 0) stopCss2dLoop();
  };

  const api: Plugin & EntityMarkerPluginAPI = {
    name: NAME,

    sync(markers: EntityMarkerData[]) {
      const incoming = new Map(markers.map((m) => [m.id, m]));

      // Remove stale markers
      for (const id of activeMarkers.keys()) {
        if (!incoming.has(id)) {
          removeMarker(id);
        }
      }

      for (const m of markers) {
        const existing = activeMarkers.get(m.id);
        if (!existing) {
          addMarker(m);
        } else if (
          existing.data.label !== m.label ||
          existing.data.position.x !== m.position.x ||
          existing.data.position.y !== m.position.y ||
          existing.data.position.z !== m.position.z
        ) {
          removeMarker(m.id);
          addMarker(m);
        } else if (
          existing.data.status !== m.status ||
          existing.data.type !== m.type ||
          existing.data.dimmed !== m.dimmed
        ) {
          // Only the appearance changed (color / dim) — restyle in place.
          updateMarker(existing, m);
        }
      }
    },

    clear() {
      for (const id of activeMarkers.keys()) {
        removeMarker(id);
      }
    },

    setVisible(visible: boolean) {
      globalVisible = visible;
      for (const entry of activeMarkers.values()) {
        entry.group.visible = visible;
      }
      // Repaint either way — CSS2DRenderer only hides/shows the label DOM on a
      // render pass, so toggling group.visible needs one render to take effect.
      overlay?.requestRender();
    },

    install(ctx: ViewerContext) {
      ctxRef = ctx;
      overlay = acquireCss2dOverlay(ctx);

      // A marker can sync before its model finishes loading (so its coordination
      // transform is still identity). Re-place that model's markers once it
      // loads and the autoCoordinate translation is final.
      offLoaded = ctx.events.on('model:loaded', ({ modelId }) => {
        for (const entry of activeMarkers.values()) {
          if (entry.data.modelId === modelId) placeMarker(entry.obj, entry.data);
        }
        overlay?.requestRender();
      });

      ctx.commands.register('entity-marker.sync', (args: unknown) => {
        api.sync(args as EntityMarkerData[]);
      }, { title: 'Sync entity markers' });

      ctx.commands.register('entity-marker.clear', () => {
        api.clear();
      }, { title: 'Clear entity markers' });

      ctx.commands.register('entity-marker.setVisible', (args: unknown) => {
        const { visible } = args as { visible: boolean };
        api.setVisible(visible);
      }, { title: 'Toggle entity marker visibility' });
    },

    uninstall() {
      offLoaded?.();
      offLoaded = null;
      api.clear();
      releaseCss2dOverlay();
      overlay = null;
      ctxRef = null;
    },
  };

  return api;
}

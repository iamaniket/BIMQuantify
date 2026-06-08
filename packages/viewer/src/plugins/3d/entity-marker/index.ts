import * as THREE from 'three';

import { LAYER_OVERLAY } from '../../../core/layers.js';
import type { Plugin, ViewerContext, Vec3 } from '../../../core/types.js';
import {
  acquireCss2dOverlay,
  releaseCss2dOverlay,
  CSS2DObject,
} from '../shared/css2d-overlay.js';
import type { Css2dOverlay } from '../shared/css2d-overlay.js';

const NAME = 'entity-marker' as const;

export interface EntityMarkerData {
  id: string;
  type: 'finding' | 'certificate' | 'attachment';
  position: Vec3;
  label: string;
  entityId: string;
}

export interface EntityMarkerPluginAPI {
  sync(markers: EntityMarkerData[]): void;
  clear(): void;
  setVisible(visible: boolean): void;
}

const FLAG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 256 256" fill="currentColor"><path d="M34.76,42A8,8,0,0,0,24,48V216a8,8,0,0,0,16,0V171.77c26.79-21.16,49.87-9.75,76.45,3.41,16.4,8.11,34.06,16.85,53,16.85,13.93,0,28.54-4.75,43.82-18a8,8,0,0,0,2.76-6V48a8,8,0,0,0-13.27-6c-28,24.23-51.72,12.49-79.21-1.12C91.11,24.31,54.28,6.15,34.76,42Z"/></svg>`;

const BADGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 256 256" fill="currentColor"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm45.66,85.66-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32Z"/></svg>`;

const PAPERCLIP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 256 256" fill="currentColor"><path d="M209.66,82.34l-80,80a48,48,0,0,1-67.88-67.88l80-80A32,32,0,1,1,187.06,59.7l-80,80a16,16,0,0,1-22.62-22.62l80-80a8,8,0,0,0-11.32-11.32l-80,80a32,32,0,0,0,45.26,45.26l80-80a48,48,0,0,0-67.88-67.88l-80,80A64,64,0,0,0,140.7,174.06l80-80a8,8,0,0,0-11.32-11.32Z"/></svg>`;

const MARKER_COLORS: Record<string, string> = {
  finding: '#EF4444',
  certificate: '#3B82F6',
  attachment: '#10B981',
};

const MARKER_ICONS: Record<string, string> = {
  finding: FLAG_SVG,
  certificate: BADGE_SVG,
  attachment: PAPERCLIP_SVG,
};

export function entityMarkerPlugin(): Plugin & EntityMarkerPluginAPI {
  let ctxRef: ViewerContext | null = null;
  let overlay: Css2dOverlay | null = null;
  let css2dRafId: number | null = null;
  let globalVisible = true;

  const activeMarkers = new Map<string, { data: EntityMarkerData; obj: CSS2DObject; group: THREE.Group }>();

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

  const createMarkerElement = (data: EntityMarkerData): HTMLDivElement => {
    const color = MARKER_COLORS[data.type] ?? '#888';
    const svg = MARKER_ICONS[data.type] ?? PAPERCLIP_SVG;

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      pointer-events: auto;
      cursor: pointer;
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

    const circle = document.createElement('div');
    circle.innerHTML = svg;
    circle.style.cssText = `
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: ${color};
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      transition: transform 150ms ease;
    `;

    wrapper.appendChild(tooltip);
    wrapper.appendChild(circle);

    wrapper.addEventListener('mouseenter', () => {
      tooltip.style.opacity = '1';
      circle.style.transform = 'scale(1.2)';
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

    return wrapper;
  };

  const addMarker = (data: EntityMarkerData): void => {
    if (!ctxRef || !overlay) return;

    const group = new THREE.Group();
    group.renderOrder = 998;

    const pos = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
    const el = createMarkerElement(data);
    const obj = new CSS2DObject(el);
    obj.position.copy(pos);
    obj.layers.set(LAYER_OVERLAY);
    group.add(obj);

    group.visible = globalVisible;
    ctxRef.scene.add(group);
    activeMarkers.set(data.id, { data, obj, group });
    startCss2dLoop();
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
      if (visible && activeMarkers.size > 0) {
        startCss2dLoop();
      } else if (!visible) {
        stopCss2dLoop();
      }
    },

    install(ctx: ViewerContext) {
      ctxRef = ctx;
      overlay = acquireCss2dOverlay(ctx);

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
      api.clear();
      releaseCss2dOverlay();
      overlay = null;
      ctxRef = null;
    },
  };

  return api;
}

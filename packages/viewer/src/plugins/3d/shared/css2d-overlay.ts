/**
 * Shared CSS2DRenderer manager. Plugins that need HTML labels pinned to
 * 3D positions (measurement, markup, entity-marker, bounding-boxer) acquire/
 * release this overlay. The renderer is created on first acquire and disposed
 * on last release.
 *
 * Rendering is driven by `camera:change` (labels only move on screen when the
 * camera moves) plus a coalesced `requestRender()` for label add/move/remove
 * while the camera is still. This matches the viewer's on-demand renderer:
 * during motion the overlay repaints once per frame (not once per consuming
 * plugin), and when idle it does no work at all — replacing the per-plugin
 * perpetual `requestAnimationFrame` loops that used to run forever.
 */

import * as THREE from 'three';
import {
  CSS2DRenderer,
  CSS2DObject,
} from 'three/examples/jsm/renderers/CSS2DRenderer.js';

import type { ViewerContext } from '../../../core/types.js';

export interface Css2dOverlay {
  renderer: CSS2DRenderer;
  createLabel(text: string, position: THREE.Vector3, parent?: THREE.Object3D): CSS2DObject;
  removeLabel(obj: CSS2DObject): void;
  /** Repaint immediately (synchronous). Prefer {@link requestRender}. */
  render(): void;
  /**
   * Coalesced one-shot repaint — call after adding/moving/removing a label
   * while the camera is still, so the change shows without waiting for the
   * next `camera:change`. Multiple calls in a frame collapse to one render.
   */
  requestRender(): void;
}

let instance: Css2dOverlay | null = null;
let refCount = 0;
let resizeObserver: ResizeObserver | null = null;
let offCameraChange: (() => void) | null = null;
let pendingRaf = 0;

export function acquireCss2dOverlay(ctx: ViewerContext): Css2dOverlay {
  if (instance) {
    refCount++;
    return instance;
  }

  const css2d = new CSS2DRenderer();
  const el = css2d.domElement;
  el.style.position = 'absolute';
  el.style.top = '0';
  el.style.left = '0';
  el.style.width = '100%';
  el.style.height = '100%';
  el.style.pointerEvents = 'none';
  el.style.overflow = 'hidden';
  ctx.container.appendChild(el);

  const syncSize = (): void => {
    const w = ctx.container.clientWidth;
    const h = ctx.container.clientHeight;
    css2d.setSize(w, h);
  };
  syncSize();

  resizeObserver = new ResizeObserver(syncSize);
  resizeObserver.observe(ctx.container);

  const render = (): void => {
    css2d.render(ctx.scene, ctx.camera);
  };

  const requestRender = (): void => {
    if (pendingRaf) return;
    pendingRaf = requestAnimationFrame(() => {
      pendingRaf = 0;
      render();
    });
  };

  const overlay: Css2dOverlay = {
    renderer: css2d,

    createLabel(text: string, position: THREE.Vector3, parent?: THREE.Object3D): CSS2DObject {
      const div = document.createElement('div');
      div.textContent = text;
      div.style.cssText =
        'background: rgba(0,0,0,0.75); color: #fff; padding: 2px 6px;' +
        'border-radius: 3px; font-size: 12px; font-family: system-ui, sans-serif;' +
        'white-space: nowrap; pointer-events: none; user-select: none;';
      const obj = new CSS2DObject(div);
      obj.position.copy(position);
      (parent ?? ctx.scene).add(obj);
      // A new label must show even if the camera is still.
      requestRender();
      return obj;
    },

    removeLabel(obj: CSS2DObject): void {
      obj.removeFromParent();
      if (obj.element.parentNode) {
        obj.element.parentNode.removeChild(obj.element);
      }
      requestRender();
    },

    render,
    requestRender,
  };

  // Reposition labels whenever the camera moves — once per frame during motion,
  // for all consumers at once. No camera:change while idle => no overlay work.
  offCameraChange = ctx.events.on('camera:change', render);

  instance = overlay;
  refCount = 1;
  return overlay;
}

export function releaseCss2dOverlay(): void {
  refCount--;
  if (refCount > 0 || !instance) return;

  offCameraChange?.();
  offCameraChange = null;
  if (pendingRaf) {
    cancelAnimationFrame(pendingRaf);
    pendingRaf = 0;
  }

  const el = instance.renderer.domElement;
  el.parentNode?.removeChild(el);
  resizeObserver?.disconnect();
  resizeObserver = null;
  instance = null;
}

export { CSS2DObject };

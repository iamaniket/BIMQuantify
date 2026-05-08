/**
 * Shared CSS2DRenderer manager. Plugins that need HTML labels pinned to
 * 3D positions (measurement, markup) acquire/release this overlay. The
 * renderer is created on first acquire and disposed on last release.
 */

import * as THREE from 'three';
import {
  CSS2DRenderer,
  CSS2DObject,
} from 'three/examples/jsm/renderers/CSS2DRenderer.js';

import type { ViewerContext } from '../../core/types.js';

export interface Css2dOverlay {
  renderer: CSS2DRenderer;
  createLabel(text: string, position: THREE.Vector3): CSS2DObject;
  removeLabel(obj: CSS2DObject): void;
  render(): void;
}

let instance: Css2dOverlay | null = null;
let refCount = 0;
let resizeObserver: ResizeObserver | null = null;

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

  const overlay: Css2dOverlay = {
    renderer: css2d,

    createLabel(text: string, position: THREE.Vector3): CSS2DObject {
      const div = document.createElement('div');
      div.textContent = text;
      div.style.cssText =
        'background: rgba(0,0,0,0.75); color: #fff; padding: 2px 6px;' +
        'border-radius: 3px; font-size: 12px; font-family: system-ui, sans-serif;' +
        'white-space: nowrap; pointer-events: none; user-select: none;';
      const obj = new CSS2DObject(div);
      obj.position.copy(position);
      ctx.scene.add(obj);
      return obj;
    },

    removeLabel(obj: CSS2DObject): void {
      obj.removeFromParent();
      if (obj.element.parentNode) {
        obj.element.parentNode.removeChild(obj.element);
      }
    },

    render(): void {
      css2d.render(ctx.scene, ctx.camera);
    },
  };

  instance = overlay;
  refCount = 1;
  return overlay;
}

export function releaseCss2dOverlay(): void {
  refCount--;
  if (refCount > 0 || !instance) return;

  const el = instance.renderer.domElement;
  el.parentNode?.removeChild(el);
  resizeObserver?.disconnect();
  resizeObserver = null;
  instance = null;
}

export { CSS2DObject };

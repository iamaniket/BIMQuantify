/**
 * 2D scene plugin — creates the shared Three.js infrastructure (scene, ortho
 * camera, WebGL renderer, render loop) that all other 2D plugins consume.
 *
 * World space = PDF points, Y-up, origin at bottom-left. The camera looks
 * down the −Z axis at the Z=0 plane.
 */

import * as THREE from 'three';

import type {
  DocumentContext,
  DocumentPlugin,
} from '../../../pdf-core/documentTypes.js';

const NAME = 'scene' as const;

export interface SceneAPI {
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly renderer: THREE.WebGLRenderer;
  /** Project a world-space point (PDF pts, Y-up) to screen CSS px. */
  worldToScreen(wx: number, wy: number): { x: number; y: number };
  /** Map screen CSS px (relative to container) to world-space point. */
  screenToWorld(sx: number, sy: number): { x: number; y: number };
  /** Mark the scene dirty so it re-renders on the next frame. */
  requestRender(): void;
  /** Current container dimensions in CSS px. */
  containerSize(): { width: number; height: number };
  /**
   * Get (or lazily create) a named annotation layer — a `THREE.Group` added to
   * the shared scene with a fixed `renderOrder`. This is how measure / markup /
   * entity-marker plugins add their content to the one shared world-space scene
   * instead of spinning up their own renderers. Idempotent by name.
   */
  addLayer(name: string, renderOrder: number): THREE.Group;
  /** Look up a previously-added layer, or null. */
  getLayer(name: string): THREE.Group | null;
  /** Remove + dispose a named layer's group (children are the caller's to dispose). */
  removeLayer(name: string): void;
  /**
   * Screen px per world unit at the current camera zoom — i.e. how many CSS px
   * one PDF point currently occupies on screen. Multiply by it to size a glyph
   * in px; its reciprocal {@link worldPerPx} converts px → world units.
   */
  pxPerWorldUnit(): number;
  /** Reciprocal of {@link pxPerWorldUnit}: world units per screen px. */
  worldPerPx(): number;
}

export interface ScenePluginOptions {
  /** Initial page size in PDF points. Updated by pdf-underlay on page change. */
  pageWidth?: number;
  pageHeight?: number;
}

export function scenePlugin(
  options: ScenePluginOptions = {},
): DocumentPlugin & SceneAPI {
  let ctx: DocumentContext | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.OrthographicCamera | null = null;
  let rafId = 0;
  let dirty = true;
  const cleanups: Array<() => void> = [];
  const layers = new Map<string, THREE.Group>();

  const pageW = options.pageWidth ?? 595; // A4 default
  const pageH = options.pageHeight ?? 842;

  function tick(): void {
    if (!renderer || !scene || !camera) return;
    if (dirty) {
      renderer.render(scene, camera);
      dirty = false;
    }
    rafId = requestAnimationFrame(tick);
  }

  function resizeRenderer(): void {
    if (!ctx || !renderer || !camera) return;
    const el = ctx.container;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w === 0 || h === 0) return;
    // Cap the backing-store DPR at 2 to match the 3D renderer
    // (core/Viewer.ts getBasePixelRatio). This is a full-viewport WebGL surface,
    // so on a DPR-3 phone an uncapped ratio renders ~2.25× the fragments for no
    // perceptible gain — the dominant fill cost of the 2D/Split view on mobile.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, true);
    dirty = true;
  }

  const api: DocumentPlugin & SceneAPI = {
    name: NAME,

    get scene(): THREE.Scene {
      if (!scene) throw new Error('scene plugin not installed');
      return scene;
    },
    get camera(): THREE.OrthographicCamera {
      if (!camera) throw new Error('scene plugin not installed');
      return camera;
    },
    get renderer(): THREE.WebGLRenderer {
      if (!renderer) throw new Error('scene plugin not installed');
      return renderer;
    },

    worldToScreen(wx: number, wy: number): { x: number; y: number } {
      if (!camera || !ctx) return { x: 0, y: 0 };
      const v = new THREE.Vector3(wx, wy, 0);
      v.project(camera);
      const el = ctx.container;
      return {
        x: ((v.x + 1) / 2) * el.clientWidth,
        y: ((1 - v.y) / 2) * el.clientHeight,
      };
    },

    screenToWorld(sx: number, sy: number): { x: number; y: number } {
      if (!camera || !ctx) return { x: 0, y: 0 };
      const el = ctx.container;
      const ndcX = (sx / el.clientWidth) * 2 - 1;
      const ndcY = -(sy / el.clientHeight) * 2 + 1;
      const v = new THREE.Vector3(ndcX, ndcY, 0);
      v.unproject(camera);
      return { x: v.x, y: v.y };
    },

    requestRender(): void {
      dirty = true;
    },

    containerSize(): { width: number; height: number } {
      if (!ctx) return { width: 0, height: 0 };
      return { width: ctx.container.clientWidth, height: ctx.container.clientHeight };
    },

    addLayer(name: string, renderOrder: number): THREE.Group {
      const existing = layers.get(name);
      if (existing) return existing;
      const group = new THREE.Group();
      group.name = name;
      group.renderOrder = renderOrder;
      if (scene) scene.add(group);
      layers.set(name, group);
      dirty = true;
      return group;
    },

    getLayer(name: string): THREE.Group | null {
      return layers.get(name) ?? null;
    },

    removeLayer(name: string): void {
      const group = layers.get(name);
      if (!group) return;
      group.removeFromParent();
      layers.delete(name);
      dirty = true;
    },

    pxPerWorldUnit(): number {
      if (!camera || !ctx) return 1;
      const w = ctx.container.clientWidth;
      const frustumW = camera.right - camera.left;
      if (frustumW === 0 || w === 0) return 1;
      return (w * camera.zoom) / frustumW;
    },

    worldPerPx(): number {
      const p = this.pxPerWorldUnit();
      return p === 0 ? 1 : 1 / p;
    },

    install(context: DocumentContext): void {
      ctx = context;

      scene = new THREE.Scene();

      // Ortho camera in world space (PDF points, Y-up).
      // Initial frustum frames the default page; the camera plugin adjusts
      // on doc:loaded via camera.fitPage.
      const aspect = pageW / pageH;
      const halfH = pageH / 2;
      const halfW = halfH * aspect;
      camera = new THREE.OrthographicCamera(
        -halfW,
        halfW,
        halfH,
        -halfH,
        0.1,
        100,
      );
      camera.position.set(pageW / 2, pageH / 2, 10);
      camera.lookAt(pageW / 2, pageH / 2, 0);
      camera.updateProjectionMatrix();

      // preserveDrawingBuffer lets markup.captureSnapshot read the buffer back
      // (composite into a BCF thumbnail) after a render.
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      renderer.setClearColor(0x000000, 0);
      renderer.domElement.style.cssText =
        'position:absolute;inset:0;pointer-events:none;';
      context.webglHost.appendChild(renderer.domElement);

      resizeRenderer();

      const ro = new ResizeObserver(() => {
        resizeRenderer();
      });
      ro.observe(context.container);
      cleanups.push(() => ro.disconnect());

      // Start render loop
      rafId = requestAnimationFrame(tick);

      context.commands.register(
        'scene.requestRender',
        () => { dirty = true; },
        { title: 'Request scene render' },
      );
    },

    uninstall(): void {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      for (const c of cleanups.splice(0)) c();
      for (const group of layers.values()) group.removeFromParent();
      layers.clear();
      if (renderer) {
        renderer.domElement.remove();
        renderer.dispose();
        renderer.forceContextLoss();
        renderer = null;
      }
      scene = null;
      camera = null;
      ctx = null;
    },
  };

  return api;
}

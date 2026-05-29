/**
 * Outline plugin — xeokit-style model emphasis from real geometry edges.
 *
 * Owns an OutlineCache: when a model finishes loading it builds the model's
 * hard-edge outline once (slow, batched, off the main thread of work) and
 * caches the geometry. It then draws that outline on the idle / "last" frame
 * — the still render shown once the camera stops — replacing the old Sobel
 * post-process edge pass with crisp, correctly-occluded lines.
 *
 * The outline lives on LAYER_DEFAULT (depth-tested with the model) so only
 * front-facing edges show, and is gated to idle so it costs nothing during
 * camera motion. The cached geometry is also exposed (via the
 * `outline.getGeometries` command) so x-ray can reuse it instead of
 * recomputing edges for the whole model.
 */

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

import { LAYER_DEFAULT } from '../../core/layers.js';
import type { Plugin, ViewerContext } from '../../core/types.js';
import { OutlineCache } from '../shared/outline-cache.js';
import {
  applyClippingPlanes,
  buildClippingPlanes,
  type SectionPlaneData,
} from '../shared/clipping.js';

const NAME = 'outline' as const;

export interface OutlinePluginOptions {
  /** Draw the outline on the idle frame. Default: false. */
  enabled?: boolean;
  /** Edge line colour. Default: near-black 0x0d0d14 (matches old Sobel edges). */
  color?: number;
  /** Screen-space line width in px. Default: 1.0. */
  lineWidth?: number;
}

export interface OutlinePluginAPI {
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
}

export function outlinePlugin(
  options: OutlinePluginOptions = {},
): Plugin & OutlinePluginAPI {
  const cache = new OutlineCache();
  const color = new THREE.Color(options.color ?? 0x0d0d14);
  const lineWidth = options.lineWidth ?? 1.0;

  let enabled = options.enabled ?? false;
  let ctxRef: ViewerContext | null = null;
  let lines: LineSegments2[] = [];
  let material: LineMaterial | null = null;
  let isIdle = false;
  let cleanup: (() => void) | null = null;
  let currentPlanes: THREE.Plane[] = [];
  let clipCount = 0;

  const updateVisibility = (): void => {
    const show = enabled && isIdle;
    for (const line of lines) line.visible = show;
  };

  const ensureMaterial = (ctx: ViewerContext): LineMaterial => {
    if (material) return material;
    const size = ctx.renderer.getSize(new THREE.Vector2());
    const dpr = ctx.renderer.getPixelRatio();
    material = new LineMaterial({
      color: color.getHex(),
      linewidth: lineWidth,
      worldUnits: false,
      transparent: true,
      opacity: 0.9,
      depthTest: true,
      // Pull edges slightly toward the camera so they sit on top of their
      // own surfaces instead of z-fighting with them.
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      resolution: new THREE.Vector2(size.x * dpr, size.y * dpr),
    });
    clipCount = applyClippingPlanes(material, currentPlanes, -1);
    return material;
  };

  const syncClipping = (planes: SectionPlaneData[]): void => {
    currentPlanes = buildClippingPlanes(planes);
    if (material) clipCount = applyClippingPlanes(material, currentPlanes, clipCount);
  };

  const buildLines = (modelId: string): void => {
    if (!ctxRef) return;
    const geos = cache.getGeometries(modelId);
    if (!geos || geos.length === 0) return;
    const mat = ensureMaterial(ctxRef);
    for (const geo of geos) {
      const line = new LineSegments2(geo, mat);
      line.layers.set(LAYER_DEFAULT);
      line.renderOrder = 998;
      line.frustumCulled = false;
      line.visible = enabled && isIdle;
      line.name = `outline::${modelId}`;
      ctxRef.scene.add(line);
      lines.push(line);
    }
  };

  const clearLines = (): void => {
    if (!ctxRef) return;
    for (const line of lines) ctxRef.scene.remove(line);
    lines = [];
  };

  const setEnabled = (next: boolean): void => {
    if (enabled === next) return;
    enabled = next;
    updateVisibility();
    ctxRef?.events.emit('outline:change', { enabled });
  };

  const api: Plugin & OutlinePluginAPI = {
    name: NAME,

    setEnabled,
    isEnabled() {
      return enabled;
    },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      const offLoaded = ctx.events.on('model:loaded', ({ modelId }) => {
        void cache.build(ctx, modelId).then(() => {
          ctx.events.emit('outline:ready', { modelId });
          buildLines(modelId);
          updateVisibility();
        });
      });
      const offIdle = ctx.events.on('viewer:idle', () => {
        isIdle = true;
        updateVisibility();
      });
      const offCam = ctx.events.on('camera:change', () => {
        isIdle = false;
        updateVisibility();
      });
      const offSection = ctx.events.on('section:change', ({ planes }) => {
        syncClipping(planes);
      });
      // Seed from any section that already exists before this plugin's lines
      // are built. Harmless if the section plugin isn't registered.
      void ctx.commands
        .execute('section.list')
        .then((planes) => {
          if (Array.isArray(planes)) syncClipping(planes as SectionPlaneData[]);
        })
        .catch(() => undefined);

      const onResize = (): void => {
        if (!material || !ctxRef) return;
        const s = ctxRef.renderer.getSize(new THREE.Vector2());
        const r = ctxRef.renderer.getPixelRatio();
        material.resolution.set(s.x * r, s.y * r);
      };
      const ro = new ResizeObserver(onResize);
      ro.observe(ctx.canvas);

      ctx.commands.register(
        'outline.getGeometries',
        async (args: unknown) => {
          const arg = (args ?? {}) as { modelId?: string };
          const id = arg.modelId ?? ctx.models().keys().next().value;
          if (!id) return null;
          await cache.whenReady(id);
          return cache.getGeometries(id) ?? null;
        },
        { title: 'Get cached model outline geometry' },
      );
      ctx.commands.register(
        'outline.setEnabled',
        (args: unknown) => {
          const on =
            typeof args === 'boolean'
              ? args
              : (args as { enabled?: boolean })?.enabled;
          if (typeof on === 'boolean') setEnabled(on);
          return enabled;
        },
        { title: 'Enable/disable model outline on the idle frame' },
      );
      ctx.commands.register('outline.isEnabled', () => enabled, {
        title: 'Get outline enabled state',
      });

      cleanup = (): void => {
        offLoaded();
        offIdle();
        offCam();
        offSection();
        ro.disconnect();
      };
    },

    uninstall() {
      cleanup?.();
      cleanup = null;
      clearLines();
      material?.dispose();
      material = null;
      cache.dispose();
      ctxRef = null;
    },
  };

  return api;
}

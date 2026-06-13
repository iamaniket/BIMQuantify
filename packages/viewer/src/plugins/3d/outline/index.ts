/**
 * Outline plugin — xeokit-style model emphasis from real geometry edges.
 *
 * When a model finishes loading it seeds an OutlineCache from the processor's
 * precomputed INSTANCED artifact (unique edge templates + per-element
 * transforms) and hands it to an {@link InstancedOutline} renderer, which draws
 * each shared shape once via GPU instancing. The outline is drawn on the idle /
 * "last" frame — the still render shown once the camera stops — so it costs
 * nothing during camera motion.
 *
 * The outline lives on LAYER_DEFAULT (depth-tested with the model) so only
 * front-facing edges show. The cache also still exposes flat merged geometry
 * (via `outline.getGeometries`) and per-item edges (`outline.getItemEdges`) so
 * x-ray and the hover/select edge overlay keep working unchanged.
 */

import * as THREE from 'three';

import type { ItemId, Plugin, ViewerContext } from '../../../core/types.js';
import { InstancedOutline } from '../shared/instanced-outline.js';
import { OutlineCache } from '../shared/outline-cache.js';
import { decodeOutline } from '../shared/outline-codec.js';
import {
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
  const color = options.color ?? 0x0d0d14;
  const lineWidth = options.lineWidth ?? 1.0;

  let enabled = options.enabled ?? false;
  let ctxRef: ViewerContext | null = null;
  let instanced: InstancedOutline | null = null;
  const groups = new Map<string, THREE.Group>();
  let isIdle = false;
  let xrayActive = false;
  let cleanup: (() => void) | null = null;
  let currentPlanes: THREE.Plane[] = [];
  let revealTimer: ReturnType<typeof setTimeout> | null = null;

  // Mirrored visibility state, keyed by modelId. When isolation is active the
  // visible set is `isolated`; otherwise it's everything minus `hidden`.
  const hiddenByModel = new Map<string, Set<number>>();
  const isolatedByModel = new Map<string, Set<number>>();
  let isolationActive = false;
  // Whole-model visibility (federated layer toggle, via the `model:visibility`
  // event). A model in this set keeps its outline hidden regardless of the
  // global enabled/idle state — a layer distinct from element isolation above.
  const hiddenModels = new Set<string>();
  // Set when visibility changes; the filtered element textures are rebuilt
  // lazily on the next idle frame (the outline only draws on idle anyway).
  let dirty = false;

  const updateVisibility = (): void => {
    const show = enabled && isIdle && !xrayActive;
    for (const [modelId, group] of groups) {
      group.visible = show && !hiddenModels.has(modelId);
    }
  };

  const indexByModel = (items: ItemId[]): Map<string, Set<number>> => {
    const map = new Map<string, Set<number>>();
    for (const it of items) {
      let set = map.get(it.modelId);
      if (!set) {
        set = new Set();
        map.set(it.modelId, set);
      }
      set.add(it.localId);
    }
    return map;
  };

  // Resolve the visible-element filter for a model from mirrored state:
  // isolation wins (only isolated items), otherwise everything minus hidden.
  // Returns `null` (full model) when nothing is hidden — the common case.
  const filterFor = (
    modelId: string,
  ): { visible?: Set<number>; hidden?: Set<number> } | null => {
    if (isolationActive) {
      return { visible: isolatedByModel.get(modelId) ?? new Set() };
    }
    const hidden = hiddenByModel.get(modelId);
    return hidden && hidden.size > 0 ? { hidden } : null;
  };

  const syncResolution = (): void => {
    if (!instanced || !ctxRef) return;
    const s = ctxRef.renderer.getSize(new THREE.Vector2());
    const r = ctxRef.renderer.getPixelRatio();
    instanced.setResolution(s.x * r, s.y * r);
  };

  const syncClipping = (planes: SectionPlaneData[]): void => {
    currentPlanes = buildClippingPlanes(planes);
    instanced?.setClippingPlanes(currentPlanes);
  };

  // Build the GPU outline objects for a model and attach them to the scene.
  const buildModel = (modelId: string): void => {
    if (!ctxRef || !instanced) return;
    const model = cache.getModel(modelId);
    if (!model) return;
    const group = instanced.setModel(modelId, model, filterFor(modelId));
    ctxRef.scene.add(group);
    groups.set(modelId, group);
    instanced.setClippingPlanes(currentPlanes);
    syncResolution();
  };

  // Re-filter every model's outline from the current visible set (idle only).
  const applyFilters = (): void => {
    if (!instanced) return;
    for (const modelId of groups.keys()) {
      instanced.applyFilter(modelId, filterFor(modelId));
    }
    dirty = false;
  };

  // Seed the cache from the processor's precomputed artifact. Client-side edge
  // extraction has been removed — edges must come from the backend.
  const seedCache = async (
    ctx: ViewerContext,
    modelId: string,
  ): Promise<void> => {
    try {
      const bytes = await ctx.getPrecomputedOutline(modelId);
      if (bytes) {
        const decoded = await decodeOutline(bytes);
        if (decoded) {
          cache.loadPrecomputed(modelId, decoded);
        }
      }
    } catch {
      // No precomputed outline available — edges won't be shown.
    }
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
      instanced = new InstancedOutline(ctx.renderer.capabilities.maxTextureSize, {
        color,
        lineWidth,
      });

      const offLoaded = ctx.events.on('model:loaded', ({ modelId }) => {
        void seedCache(ctx, modelId).then(() => {
          buildModel(modelId);
          ctx.events.emit('outline:ready', { modelId });
          // Keep the outline hidden until the model's initial tile streaming
          // settles — otherwise outlines flash before geometry arrives.
          const group = groups.get(modelId);
          if (group) group.visible = false;
          if (revealTimer !== null) clearTimeout(revealTimer);
          revealTimer = setTimeout(() => {
            revealTimer = null;
            updateVisibility();
          }, 500);
        });
      });
      const offIdle = ctx.events.on('viewer:idle', () => {
        isIdle = true;
        // Visibility changes only repaint the outline on the idle frame, so
        // coalesce rapid tree-toggling into a single rebuild here.
        if (dirty) applyFilters();
        updateVisibility();
      });
      const offCam = ctx.events.on('camera:change', () => {
        isIdle = false;
        updateVisibility();
      });
      const offVisibility = ctx.events.on(
        'visibility:change',
        ({ hidden, isolated, isolationActive: active }) => {
          hiddenByModel.clear();
          for (const [m, s] of indexByModel(hidden)) hiddenByModel.set(m, s);
          isolatedByModel.clear();
          for (const [m, s] of indexByModel(isolated)) isolatedByModel.set(m, s);
          isolationActive = active;
          dirty = true;
          // Repaint immediately if already settled; otherwise the next idle
          // frame picks it up.
          if (isIdle) {
            applyFilters();
            updateVisibility();
          }
        },
      );
      const offXray = ctx.events.on('xray:change', ({ xrayed }) => {
        xrayActive = xrayed.length > 0;
        updateVisibility();
      });
      // Whole-model visibility (federated layer toggle): hide/show this model's
      // outline group in step with its geometry.
      const offModelVis = ctx.events.on(
        'model:visibility',
        ({ modelId, visible }) => {
          if (visible) hiddenModels.delete(modelId);
          else hiddenModels.add(modelId);
          updateVisibility();
        },
      );
      const offSection = ctx.events.on('section:change', ({ planes }) => {
        syncClipping(planes);
      });
      // Seed from any section that already exists before this plugin's objects
      // are built. Harmless if the section plugin isn't registered.
      void ctx.commands
        .execute('section.list')
        .then((planes) => {
          if (Array.isArray(planes)) syncClipping(planes as SectionPlaneData[]);
        })
        .catch(() => undefined);

      const onResize = (): void => {
        syncResolution();
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
      ctx.commands.register(
        'outline.getItemEdges',
        (args: unknown) => {
          const { modelId, localIds } = args as { modelId: string; localIds: number[] };
          const result = new Map<number, Float32Array>();
          for (const localId of localIds) {
            const positions = cache.getItemPositions(modelId, localId);
            if (positions) result.set(localId, positions);
          }
          return result;
        },
        { title: 'Get cached edge positions for specific items' },
      );

      cleanup = (): void => {
        offLoaded();
        offIdle();
        offCam();
        offVisibility();
        offXray();
        offModelVis();
        offSection();
        ro.disconnect();
      };
    },

    uninstall() {
      cleanup?.();
      cleanup = null;
      if (revealTimer !== null) {
        clearTimeout(revealTimer);
        revealTimer = null;
      }
      // Disposes every group's meshes + DataTextures and detaches them.
      instanced?.dispose();
      instanced = null;
      groups.clear();
      hiddenModels.clear();
      cache.dispose();
      ctxRef = null;
    },
  };

  return api;
}

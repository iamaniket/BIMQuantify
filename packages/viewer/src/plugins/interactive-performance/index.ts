/**
 * interactive-performance — drop expensive work while the camera is moving,
 * restore it on idle. Every toggle ships off by default so existing
 * consumers see no behavior change.
 *
 * Same gating signal the `effects` plugin uses:
 *   - on `camera:change` → enterMotion (once per motion burst)
 *   - on `viewer:idle`   → exitMotion
 *
 * Suppressions fall into three buckets, all driven by the same enter/exit:
 *   - Visibility   — hide subsets of items by box volume / IFC category /
 *                    material transparency / projected pixel size
 *   - Renderer     — drop devicePixelRatio, tighten camera far plane
 *   - Scene        — install a flat overrideMaterial, pause hover raycasts
 *
 * The plugin defers to the `visibility` plugin: if isolation is active,
 * this plugin does nothing (the rendered set is already small). User-hidden
 * items are skipped on motion-restore so visibility-plugin state survives.
 */

import * as THREE from 'three';
import * as FRAGS from '@thatopen/fragments';

import type { ItemId, Plugin, ViewerContext } from '../../core/types.js';

const NAME = 'interactive-performance' as const;

const DEFAULT_ENVELOPE_CATEGORIES = [
  'IFCWALL',
  'IFCWALLSTANDARDCASE',
  'IFCSLAB',
  'IFCROOF',
  'IFCDOOR',
  'IFCWINDOW',
  'IFCCURTAINWALL',
];

export interface InteractivePerformanceOptions {
  // Visibility-based suppressions
  hideSmall?: boolean;
  smallPercentile?: number;
  envelopeOnly?: boolean;
  envelopeCategories?: string[];
  hideTransparent?: boolean;
  pixelSizeCull?: boolean;
  pixelSizeMin?: number;

  // Renderer-state suppressions
  dynamicPixelRatio?: boolean;
  motionRatio?: number;
  tightenFarPlane?: boolean;
  motionFarMultiplier?: number;

  // Scene-state suppressions
  flatShadeOverride?: boolean;
  pauseHover?: boolean;
}

const DEFAULTS: Required<InteractivePerformanceOptions> = {
  hideSmall: false,
  smallPercentile: 0.5,
  envelopeOnly: false,
  envelopeCategories: DEFAULT_ENVELOPE_CATEGORIES,
  hideTransparent: false,
  pixelSizeCull: false,
  pixelSizeMin: 4,
  dynamicPixelRatio: false,
  motionRatio: 0.5,
  tightenFarPlane: false,
  motionFarMultiplier: 1.5,
  flatShadeOverride: false,
  pauseHover: false,
};

export interface InteractivePerformanceAPI {
  setOptions(next: InteractivePerformanceOptions): void;
  getOptions(): Required<InteractivePerformanceOptions>;
}

interface ModelCache {
  allIds: number[];
  /** Parallel to allIds. */
  boxes: THREE.Box3[];
  /** Parallel to allIds. */
  volumes: number[];
  smallIds?: number[];
  smallPercentile?: number;
  interiorIds?: number[];
  interiorKey?: string;
  transparentIds?: number[];
}

interface VisibilityPluginShape {
  isIsolated(): boolean;
  hiddenItems(): ItemId[];
}

interface HoverPluginShape {
  setEnabled(enabled: boolean): void;
}

const itemKey = (modelId: string, localId: number): string => `${modelId}::${String(localId)}`;

export function interactivePerformancePlugin(
  options: InteractivePerformanceOptions = {},
): Plugin & InteractivePerformanceAPI {
  let opts: Required<InteractivePerformanceOptions> = { ...DEFAULTS, ...options };
  let ctxRef: ViewerContext | null = null;

  const caches = new Map<string, ModelCache>();
  let inMotion = false;
  let cleanup: (() => void) | null = null;

  // Pre-motion state we restore on idle.
  let savedDpr: number | null = null;
  let savedFar: number | null = null;
  let savedOverride: THREE.Material | null = null;
  let overrideRestoreNeeded = false;
  let hoverWasPaused = false;
  let overrideMaterial: THREE.MeshBasicMaterial | null = null;

  // What we hid this motion burst, keyed by modelId.
  const hiddenByModel = new Map<string, number[]>();

  const ensureCache = async (
    modelId: string,
    model: FRAGS.FragmentsModel,
  ): Promise<ModelCache> => {
    let cache = caches.get(modelId);
    if (cache) return cache;
    const allIds = await model.getLocalIds();
    const boxes = await model.getBoxes(allIds);
    const volumes = boxes.map((b) => {
      if (!b || b.isEmpty()) return 0;
      const s = b.getSize(new THREE.Vector3());
      return s.x * s.y * s.z;
    });
    cache = { allIds, boxes, volumes };
    caches.set(modelId, cache);
    return cache;
  };

  const computeSmallIds = (cache: ModelCache, percentile: number): number[] => {
    if (cache.smallIds && cache.smallPercentile === percentile) return cache.smallIds;
    const sorted = cache.volumes.slice().sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * percentile)));
    const threshold = sorted[idx] ?? 0;
    const result: number[] = [];
    for (let i = 0; i < cache.allIds.length; i++) {
      if ((cache.volumes[i] ?? 0) < threshold) {
        result.push(cache.allIds[i] as number);
      }
    }
    cache.smallIds = result;
    cache.smallPercentile = percentile;
    return result;
  };

  const computeInteriorIds = async (
    model: FRAGS.FragmentsModel,
    cache: ModelCache,
    envelopeCategories: string[],
  ): Promise<number[]> => {
    const key = envelopeCategories.slice().sort().join('|');
    if (cache.interiorIds && cache.interiorKey === key) return cache.interiorIds;
    const regexes = envelopeCategories.map((c) => new RegExp(`^${c}$`, 'i'));
    let envItems: Record<string, number[]> = {};
    try {
      envItems = (await (
        model as unknown as {
          getItemsOfCategories(rs: RegExp[]): Promise<Record<string, number[]>>;
        }
      ).getItemsOfCategories(regexes)) as Record<string, number[]>;
    } catch {
      envItems = {};
    }
    const envSet = new Set<number>();
    for (const ids of Object.values(envItems)) {
      for (const id of ids) envSet.add(id);
    }
    const result = cache.allIds.filter((id) => !envSet.has(id));
    cache.interiorIds = result;
    cache.interiorKey = key;
    return result;
  };

  const computeTransparentIds = async (
    model: FRAGS.FragmentsModel,
    cache: ModelCache,
  ): Promise<number[]> => {
    if (cache.transparentIds) return cache.transparentIds;
    try {
      const mats = (await (
        model as unknown as {
          getMaterials(localIds: Iterable<number>): Promise<Map<number, { a?: number }>>;
        }
      ).getMaterials(cache.allIds)) as Map<number, { a?: number }>;
      const result: number[] = [];
      for (const [id, m] of mats) {
        if ((m.a ?? 1) < 1) result.push(id);
      }
      cache.transparentIds = result;
      return result;
    } catch {
      cache.transparentIds = [];
      return cache.transparentIds;
    }
  };

  const computePixelCullIds = (
    cache: ModelCache,
    camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
    canvas: HTMLCanvasElement,
    pixelSizeMin: number,
  ): number[] => {
    const result: number[] = [];
    const h = canvas.clientHeight || 1;
    const camPos = camera.position;
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    const isPersp = camera instanceof THREE.PerspectiveCamera;
    const tanHalf = isPersp ? Math.tan(((camera.fov * Math.PI) / 180) / 2) : 0;
    const orthoWorldPerPixel = !isPersp
      ? ((camera as THREE.OrthographicCamera).top -
          (camera as THREE.OrthographicCamera).bottom) /
        Math.max(h * (camera as THREE.OrthographicCamera).zoom, 1e-6)
      : 0;

    for (let i = 0; i < cache.allIds.length; i++) {
      const box = cache.boxes[i];
      if (!box || box.isEmpty()) continue;
      box.getCenter(center);
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      let pixelSize: number;
      if (isPersp) {
        const dist = camPos.distanceTo(center);
        if (dist <= 1e-4) continue;
        const worldPerPixel = (2 * dist * tanHalf) / h;
        pixelSize = maxDim / Math.max(worldPerPixel, 1e-6);
      } else {
        pixelSize = maxDim / Math.max(orthoWorldPerPixel, 1e-6);
      }
      if (pixelSize < pixelSizeMin) {
        result.push(cache.allIds[i] as number);
      }
    }
    return result;
  };

  const visibilityIsolated = (): boolean => {
    if (!ctxRef) return false;
    return ctxRef.plugins.get<VisibilityPluginShape>('visibility')?.isIsolated() ?? false;
  };

  const visibilityHiddenKeys = (): Set<string> => {
    const set = new Set<string>();
    if (!ctxRef) return set;
    const vis = ctxRef.plugins.get<VisibilityPluginShape>('visibility');
    if (!vis) return set;
    for (const it of vis.hiddenItems()) set.add(itemKey(it.modelId, it.localId));
    return set;
  };

  const useAnyVisibility = (): boolean =>
    opts.hideSmall || opts.envelopeOnly || opts.hideTransparent || opts.pixelSizeCull;

  const enterMotion = (): void => {
    if (!ctxRef || inMotion) return;
    if (visibilityIsolated()) return;
    inMotion = true;

    const renderer = ctxRef.renderer;
    const camera = ctxRef.camera;
    const scene = ctxRef.scene;
    const canvas = ctxRef.canvas;

    if (opts.dynamicPixelRatio) {
      savedDpr = renderer.getPixelRatio();
      const target = (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1) *
        opts.motionRatio;
      renderer.setPixelRatio(Math.max(target, 0.1));
    }

    if (opts.tightenFarPlane) {
      savedFar = camera.far;
      let maxDim = 1;
      for (const model of ctxRef.models().values()) {
        const b = model.box;
        if (!b || b.isEmpty()) continue;
        const s = b.getSize(new THREE.Vector3());
        const m = Math.max(s.x, s.y, s.z);
        if (m > maxDim) maxDim = m;
      }
      camera.far = maxDim * opts.motionFarMultiplier;
      camera.updateProjectionMatrix();
    }

    if (opts.flatShadeOverride) {
      savedOverride = scene.overrideMaterial;
      overrideRestoreNeeded = true;
      if (!overrideMaterial) {
        overrideMaterial = new THREE.MeshBasicMaterial({ color: 0xcccccc });
      }
      scene.overrideMaterial = overrideMaterial;
    }

    if (opts.pauseHover) {
      ctxRef.plugins.get<HoverPluginShape>('hover-highlight')?.setEnabled(false);
      hoverWasPaused = true;
    }

    if (useAnyVisibility()) {
      const skipKeys = visibilityHiddenKeys();
      hiddenByModel.clear();
      // Fire-and-forget per model; setVisible is async but non-blocking.
      for (const [modelId, model] of ctxRef.models()) {
        void (async (): Promise<void> => {
          let cache: ModelCache;
          try {
            cache = await ensureCache(modelId, model);
          } catch {
            return;
          }
          const union = new Set<number>();
          if (opts.hideSmall) {
            for (const id of computeSmallIds(cache, opts.smallPercentile)) union.add(id);
          }
          if (opts.envelopeOnly) {
            const interior = await computeInteriorIds(model, cache, opts.envelopeCategories);
            for (const id of interior) union.add(id);
          }
          if (opts.hideTransparent) {
            const transparent = await computeTransparentIds(model, cache);
            for (const id of transparent) union.add(id);
          }
          if (opts.pixelSizeCull) {
            const cullIds = computePixelCullIds(cache, camera, canvas, opts.pixelSizeMin);
            for (const id of cullIds) union.add(id);
          }
          if (!union.size) return;
          const toHide: number[] = [];
          for (const id of union) {
            if (skipKeys.has(itemKey(modelId, id))) continue;
            toHide.push(id);
          }
          if (!toHide.length) return;
          // Bail out if a viewer:idle already raced ahead of us.
          if (!inMotion) return;
          hiddenByModel.set(modelId, toHide);
          await model.setVisible(toHide, false).catch(() => undefined);
        })();
      }
    }
  };

  const exitMotion = (): void => {
    if (!ctxRef || !inMotion) return;
    inMotion = false;

    const renderer = ctxRef.renderer;
    const camera = ctxRef.camera;
    const scene = ctxRef.scene;

    if (savedDpr !== null) {
      renderer.setPixelRatio(savedDpr);
      savedDpr = null;
    }

    if (savedFar !== null) {
      camera.far = savedFar;
      camera.updateProjectionMatrix();
      savedFar = null;
    }

    if (overrideRestoreNeeded) {
      scene.overrideMaterial = savedOverride;
      savedOverride = null;
      overrideRestoreNeeded = false;
    }

    if (hoverWasPaused) {
      ctxRef.plugins.get<HoverPluginShape>('hover-highlight')?.setEnabled(true);
      hoverWasPaused = false;
    }

    if (hiddenByModel.size) {
      const ctx = ctxRef;
      for (const [modelId, ids] of hiddenByModel) {
        const model = ctx.models().get(modelId);
        if (!model) continue;
        void model.setVisible(ids, true).catch(() => undefined);
      }
      hiddenByModel.clear();
    }
  };

  const api: Plugin & InteractivePerformanceAPI = {
    name: NAME,

    getOptions() {
      return { ...opts };
    },

    setOptions(next: InteractivePerformanceOptions) {
      opts = { ...opts, ...next };
    },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      const onCamChange = (): void => enterMotion();
      const onIdle = (): void => exitMotion();
      const onModelLoaded = (e: { modelId: string }): void => {
        caches.delete(e.modelId);
      };

      const offCam = ctx.events.on('camera:change', onCamChange);
      const offIdle = ctx.events.on('viewer:idle', onIdle);
      const offModel = ctx.events.on('model:loaded', onModelLoaded);

      ctx.commands.register(
        'interactivePerformance.set',
        (args: unknown) => {
          if (!args || typeof args !== 'object') return false;
          api.setOptions(args as InteractivePerformanceOptions);
          return true;
        },
        { title: 'Update interactive-rendering performance settings' },
      );
      ctx.commands.register('interactivePerformance.get', () => api.getOptions(), {
        title: 'Get interactive-rendering performance settings',
      });

      cleanup = (): void => {
        offCam();
        offIdle();
        offModel();
        if (inMotion) exitMotion();
        overrideMaterial?.dispose();
        overrideMaterial = null;
      };
    },

    uninstall() {
      cleanup?.();
      cleanup = null;
      caches.clear();
      ctxRef = null;
    },
  };

  return api;
}

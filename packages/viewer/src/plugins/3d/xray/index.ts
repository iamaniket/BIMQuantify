/**
 * X-ray plugin — xeokit-style emphasis approximation.
 *
 * Instead of triangle wireframe, this uses:
 * 1) near-zero fill opacity on xrayed items
 * 2) explicit edge overlays extracted from geometry
 */

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import type { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

import { LAYER_OVERLAY } from '../../../core/layers.js';
import type { ItemId, Plugin, ViewerContext } from '../../../core/types.js';
import { EdgeOverlay } from '../shared/edge-overlay.js';

const NAME = 'xray' as const;

export interface XrayPluginOptions {
  /** Edge line color used while x-ray is active. */
  color?: number;
  /** Fill opacity for xrayed items (0..1). Default: 0.08 for line-dominant view. */
  opacity?: number;
}

export interface XrayPluginAPI {
  list(): ItemId[];
  hasItem(item: ItemId): boolean;
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  getItemOpacity(item: ItemId): number | undefined;
}

const itemKey = (i: ItemId): string => `${i.modelId}::${String(i.localId)}`;

export function xrayPlugin(options: XrayPluginOptions = {}): Plugin & XrayPluginAPI {
  // 0.08 reads as a faint surface under alpha-to-coverage dithering (the
  // Viewer renders these fade materials with screen-door transparency). Stays
  // well under XRAY_DITHER_MAX_OPACITY so the dithered path picks it up.
  const defaultOpacity = options.opacity ?? 0.08;
  const edgeColor = new THREE.Color(options.color ?? 0x6f7784);
  const edges = new EdgeOverlay({ lineWidth: 1.3 });

  const xrayed = new Set<string>();
  const itemMap = new Map<string, ItemId>();
  const opacityMap = new Map<string, number>();

  let ctxRef: ViewerContext | null = null;
  let enabled = true;

  // When x-raying the whole model we reuse the prebuilt outline (one merged
  // geometry per model) instead of adding a fat line per item. `mode` tracks
  // which path produced the current edges so enable/disable can re-apply the
  // right one.
  let mode: 'merged' | 'peritem' | null = null;
  let mergedLines: LineSegments2[] = [];
  let mergedMat: LineMaterial | null = null;

  const groupByModel = (items: ItemId[]): Map<string, number[]> => {
    const map = new Map<string, number[]>();
    for (const it of items) {
      let arr = map.get(it.modelId);
      if (!arr) { arr = []; map.set(it.modelId, arr); }
      arr.push(it.localId);
    }
    return map;
  };

  const applyOpacity = (items: ItemId[]): void => {
    if (!ctxRef || !items.length || !enabled) return;
    for (const [modelId, ids] of groupByModel(items)) {
      const model = ctxRef.models().get(modelId);
      if (model) void model.setOpacity(ids, defaultOpacity).catch(() => undefined);
    }
  };

  const restoreOrResetOpacity = (items: ItemId[]): void => {
    if (!ctxRef || !items.length) return;
    const toRestore = new Map<string, { ids: number[]; opacity: number }>();
    const toReset = new Map<string, number[]>();
    for (const it of items) {
      const k = itemKey(it);
      const custom = opacityMap.get(k);
      if (custom !== undefined) {
        let entry = toRestore.get(it.modelId);
        if (!entry) { entry = { ids: [], opacity: custom }; toRestore.set(it.modelId, entry); }
        entry.ids.push(it.localId);
      } else {
        let arr = toReset.get(it.modelId);
        if (!arr) { arr = []; toReset.set(it.modelId, arr); }
        arr.push(it.localId);
      }
    }
    for (const [modelId, { ids, opacity }] of toRestore) {
      const model = ctxRef.models().get(modelId);
      if (model) void model.setOpacity(ids, opacity).catch(() => undefined);
    }
    for (const [modelId, ids] of toReset) {
      const model = ctxRef.models().get(modelId);
      if (model) void model.resetOpacity(ids).catch(() => undefined);
    }
  };

  const markAndFade = (items: ItemId[]): ItemId[] => {
    const fresh = items.filter((it) => !xrayed.has(itemKey(it)));
    for (const it of items) {
      const k = itemKey(it);
      xrayed.add(k);
      itemMap.set(k, it);
    }
    if (fresh.length) applyOpacity(fresh);
    return fresh;
  };

  const applyXray = (items: ItemId[]): void => {
    if (!items.length) return;
    const fresh = markAndFade(items);
    if (ctxRef && fresh.length) void edges.add(ctxRef, fresh, edgeColor);
    if (fresh.length) mode = 'peritem';
    emitChange();
  };

  const addMergedOutline = async (): Promise<void> => {
    if (!ctxRef) return;
    const size = ctxRef.renderer.getSize(new THREE.Vector2());
    // Stable base DPR, not the motion-lowered live ratio (see getBasePixelRatio).
    const dpr = ctxRef.getBasePixelRatio();
    if (!mergedMat) {
      mergedMat = new LineMaterial({
        color: edgeColor.getHex(),
        linewidth: 1.3,
        worldUnits: false,
        depthTest: false,
        transparent: true,
        opacity: 0.85,
        resolution: new THREE.Vector2(size.x * dpr, size.y * dpr),
      });
    } else {
      mergedMat.resolution.set(size.x * dpr, size.y * dpr);
    }
    for (const [modelId] of ctxRef.models()) {
      let geos: LineSegmentsGeometry[] | null;
      try {
        geos = await ctxRef.commands.execute<
          { modelId: string },
          LineSegmentsGeometry[] | null
        >('outline.getGeometries', { modelId });
      } catch {
        continue;
      }
      if (!geos || !ctxRef) continue;
      for (const geo of geos) {
        const line = new LineSegments2(geo, mergedMat);
        line.layers.set(LAYER_OVERLAY);
        line.renderOrder = 999;
        line.frustumCulled = false;
        line.name = `xray-outline::${modelId}`;
        ctxRef.scene.add(line);
        mergedLines.push(line);
      }
    }
    mode = 'merged';
  };

  const clearMergedOutline = (): void => {
    if (ctxRef) {
      for (const line of mergedLines) ctxRef.scene.remove(line);
    }
    mergedLines = [];
  };

  const applyXrayAll = async (items: ItemId[]): Promise<void> => {
    if (!items.length) return;
    markAndFade(items);
    await addMergedOutline();
    emitChange();
  };

  const removeXray = (items: ItemId[]): void => {
    if (!items.length) return;
    const present: ItemId[] = [];
    for (const it of items) {
      const k = itemKey(it);
      if (!xrayed.has(k)) continue;
      xrayed.delete(k);
      itemMap.delete(k);
      present.push(it);
    }
    if (present.length) restoreOrResetOpacity(present);
    if (ctxRef && present.length) edges.remove(ctxRef, present);
    emitChange();
  };

  const emitChange = (): void => {
    const overrides: Array<{ item: ItemId; opacity: number }> = [];
    for (const [k, o] of opacityMap) {
      const it = itemMap.get(k) ?? parseItemKey(k);
      if (it) overrides.push({ item: it, opacity: o });
    }
    ctxRef?.events.emit('xray:change', {
      xrayed: [...itemMap.values()],
      opacityOverrides: overrides,
    });
  };

  const parseItemKey = (k: string): ItemId | null => {
    const sep = k.indexOf('::');
    if (sep < 0) return null;
    const localId = Number(k.slice(sep + 2));
    if (Number.isNaN(localId)) return null;
    return { modelId: k.slice(0, sep), localId };
  };

  const getSelection = async (): Promise<ItemId[]> => {
    if (!ctxRef) return [];
    try {
      return (await ctxRef.commands.execute<undefined, ItemId[]>('selection.get')) ?? [];
    } catch {
      return [];
    }
  };

  const xraySelected = async (): Promise<void> => {
    const selected = await getSelection();
    if (selected.length) applyXray(selected);
  };

  const xrayAll = async (): Promise<void> => {
    if (!ctxRef) return;
    const toXray: ItemId[] = [];
    for (const [modelId, model] of ctxRef.models()) {
      let allIds: Iterable<number>;
      try {
        allIds = await (model as unknown as { getLocalIds(): Promise<Iterable<number>> }).getLocalIds();
      } catch {
        continue;
      }
      for (const localId of allIds) toXray.push({ modelId, localId });
    }
    await applyXrayAll(toXray);
  };

  const xrayAllExcept = async (): Promise<void> => {
    if (!ctxRef) return;
    const selected = await getSelection();
    if (!selected.length) return;
    const selectedKeys = new Set(selected.map(itemKey));
    const toXray: ItemId[] = [];
    for (const [modelId, model] of ctxRef.models()) {
      let allIds: Iterable<number>;
      try {
        allIds = await (model as unknown as { getLocalIds(): Promise<Iterable<number>> }).getLocalIds();
      } catch {
        continue;
      }
      for (const localId of allIds) {
        if (!selectedKeys.has(itemKey({ modelId, localId }))) {
          toXray.push({ modelId, localId });
        }
      }
    }
    applyXray(toXray);
  };

  const xrayAllExceptItem = async (args: unknown): Promise<void> => {
    if (!ctxRef) return;
    const items = toItems(args);
    if (!items.length) return;
    const exceptKeys = new Set(items.map(itemKey));
    const toXray: ItemId[] = [];
    for (const [modelId, model] of ctxRef.models()) {
      let allIds: Iterable<number>;
      try {
        allIds = await (model as unknown as { getLocalIds(): Promise<Iterable<number>> }).getLocalIds();
      } catch {
        continue;
      }
      for (const localId of allIds) {
        if (!exceptKeys.has(itemKey({ modelId, localId }))) {
          toXray.push({ modelId, localId });
        }
      }
    }
    applyXray(toXray);
  };

  const clearXray = (): void => {
    if (!ctxRef || !xrayed.size) return;
    const all = [...itemMap.values()];
    restoreOrResetOpacity(all);
    xrayed.clear();
    itemMap.clear();
    edges.clear(ctxRef);
    clearMergedOutline();
    mode = null;
    emitChange();
  };

  const toggleAll = async (): Promise<void> => {
    if (xrayed.size > 0) {
      clearXray();
      return;
    }
    await xrayAll();
  };

  const setEnabled = (next: boolean): void => {
    if (enabled === next) return;
    enabled = next;
    if (!ctxRef) return;
    const all = [...itemMap.values()];
    if (!enabled && all.length) {
      restoreOrResetOpacity(all);
      edges.clear(ctxRef);
      clearMergedOutline();
    } else if (enabled && all.length) {
      for (const [modelId, ids] of groupByModel(all)) {
        const model = ctxRef.models().get(modelId);
        if (model) void model.setOpacity(ids, defaultOpacity).catch(() => undefined);
      }
      // Re-apply the same edge path that produced the current x-ray.
      if (mode === 'merged') {
        void addMergedOutline();
      } else {
        void edges.add(ctxRef, all, edgeColor);
      }
    }
    ctxRef.events.emit('feature:enabled', { name: NAME, enabled });
  };

  const api: Plugin & XrayPluginAPI = {
    name: NAME,
    dependencies: ['selection', 'outline'],

    list() {
      return [...itemMap.values()];
    },
    hasItem(item: ItemId) {
      return xrayed.has(itemKey(item));
    },
    setEnabled,
    isEnabled() { return enabled; },
    getItemOpacity(item: ItemId) { return opacityMap.get(itemKey(item)); },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      ctx.commands.register('xray.selected', () => xraySelected(), {
        title: 'X-ray selected elements',
      });
      ctx.commands.register('xray.all', () => xrayAll(), {
        title: 'X-ray all elements',
      });
      ctx.commands.register('xray.toggleAll', () => toggleAll(), {
        title: 'Toggle x-ray all',
        defaultShortcut: 'X',
      });
      ctx.commands.register('xray.allExcept', () => xrayAllExcept(), {
        title: 'X-ray all except selected',
      });
      ctx.commands.register(
        'xray.allExceptItem',
        (args: unknown) => xrayAllExceptItem(args),
        { title: 'X-ray all except element under cursor' },
      );
      ctx.commands.register(
        'xray.set',
        (args: unknown) => applyXray(toItems(args)),
        { title: 'X-ray specific elements' },
      );
      ctx.commands.register(
        'xray.remove',
        (args: unknown) => removeXray(toItems(args)),
        { title: 'Remove x-ray from specific elements' },
      );
      ctx.commands.register('xray.clear', () => clearXray(), {
        title: 'Clear all x-ray',
      });
      ctx.commands.register('xray.get', () => [...itemMap.values()], {
        title: 'Get x-rayed elements',
      });
      ctx.commands.register(
        'xray.has',
        (args: unknown) => {
          const items = toItems(args);
          return items.length > 0 && xrayed.has(itemKey(items[0]!));
        },
        { title: 'Check x-ray membership' },
      );
      ctx.commands.register('xray.setEnabled', (args: unknown) => {
        const on = typeof args === 'boolean' ? args : (args as { enabled?: boolean })?.enabled;
        if (typeof on === 'boolean') setEnabled(on);
        return enabled;
      }, { title: 'Enable/disable x-ray feature' });
      ctx.commands.register('xray.isEnabled', () => enabled, {
        title: 'Get x-ray enabled state',
      });

      ctx.commands.register(
        'xray.setItemOpacity',
        (args: unknown) => {
          const { items, opacity: val } = args as { items: ItemId[]; opacity: number };
          if (!items?.length || typeof val !== 'number') return;
          for (const it of items) opacityMap.set(itemKey(it), val);
          if (!ctxRef) return;
          for (const it of items) {
            if (xrayed.has(itemKey(it))) continue;
            const model = ctxRef.models().get(it.modelId);
            if (model) void model.setOpacity([it.localId], val).catch(() => undefined);
          }
          emitChange();
        },
        { title: 'Set per-entity opacity' },
      );

      ctx.commands.register(
        'xray.resetItemOpacity',
        (args: unknown) => {
          const items = toItems(args);
          if (!items.length) return;
          for (const it of items) opacityMap.delete(itemKey(it));
          if (!ctxRef) return;
          const toReset: ItemId[] = [];
          for (const it of items) {
            if (!xrayed.has(itemKey(it))) toReset.push(it);
          }
          if (toReset.length) {
            for (const [modelId, ids] of groupByModel(toReset)) {
              const model = ctxRef.models().get(modelId);
              if (model) void model.resetOpacity(ids).catch(() => undefined);
            }
          }
          emitChange();
        },
        { title: 'Reset per-entity opacity to default' },
      );

      ctx.commands.register('xray.getOpacityOverrides', () => {
        const result: Array<{ item: ItemId; opacity: number }> = [];
        for (const [k, o] of opacityMap) {
          const it = parseItemKey(k);
          if (it) result.push({ item: it, opacity: o });
        }
        return result;
      }, { title: 'Get per-entity opacity overrides' });
    },

    uninstall() {
      clearXray();
      if (ctxRef) edges.dispose(ctxRef);
      mergedMat?.dispose();
      mergedMat = null;
      opacityMap.clear();
      ctxRef = null;
    },
  };

  return api;
}

function toItems(args: unknown): ItemId[] {
  if (!args) return [];
  if (Array.isArray(args)) return args as ItemId[];
  return [args as ItemId];
}

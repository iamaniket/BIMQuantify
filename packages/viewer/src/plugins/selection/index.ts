/**
 * Selection plugin. Maintains a model-spanning selection set and paints
 * sticky color highlights using `FragmentsModel.setColor` (preserves the
 * item's original opacity so x-ray and selection compose naturally).
 *
 * Picking is exposed through commands (`selection.pickSet`, etc.) which
 * the `mouse-bindings` plugin dispatches on whatever pointer gestures
 * the user has bound to them.
 *
 * Exposes itself through `ctx.plugins.get('selection')` so other plugins
 * (e.g. hover) can do fast reads without going through the bus.
 *
 * Bulk "select all" / "clear" path uses the library's `setColor(undefined, …)`
 * fast path and tracks the state as a single `allSelected` flag instead
 * of materialising an N-entry Set. Operations that need to break the
 * "all" invariant (deselect a single item, remove, toggle) call
 * `materializeAll()` first to populate the Set on demand.
 */

import * as THREE from 'three';

import { pick } from '../../core/Raycaster.js';
import type { ItemId, Plugin, ViewerContext } from '../../core/types.js';
import { EdgeOverlay } from '../shared/edge-overlay.js';

const NAME = 'selection' as const;

export interface SelectionPluginOptions {
  color?: number;
  opacity?: number;
}

export interface SelectionPluginAPI {
  /** Fast synchronous check. Used by hover plugin. */
  hasItem(item: ItemId): boolean;
  size(): number;
  list(): ItemId[];
  isAllSelected(): boolean;
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
}

export function selectionPlugin(options: SelectionPluginOptions = {}): Plugin & SelectionPluginAPI {
  const color = new THREE.Color(options.color ?? 0x4a90d9);

  // `${modelId}::${localId}` keys for cheap Set ops.
  const selected = new Set<string>();
  const itemMap = new Map<string, ItemId>();
  // When true, every loaded item is considered selected. `selected`/`itemMap`
  // stay empty so the JS-side cost of select-all is O(1).
  let allSelected = false;
  // Cached element counts per model, updated on `model:loaded`. Used by
  // `size()` when `allSelected` is true.
  const modelCounts = new Map<string, number>();

  const key = (i: ItemId): string => `${i.modelId}::${String(i.localId)}`;

  let ctxRef: ViewerContext | null = null;
  let enabled = true;
  const edges = new EdgeOverlay();
  let cachedSectionPlanes: Array<{ normal: { x: number; y: number; z: number }; point: { x: number; y: number; z: number }; active: boolean }> = [];

  const isClippedBySection = (pt: { x: number; y: number; z: number }): boolean =>
    cachedSectionPlanes.some((p) => {
      if (!p.active) return false;
      const d = (pt.x - p.point.x) * p.normal.x +
                (pt.y - p.point.y) * p.normal.y +
                (pt.z - p.point.z) * p.normal.z;
      return d < 0;
    });

  const groupByModel = (items: ItemId[]): Map<string, number[]> => {
    const map = new Map<string, number[]>();
    for (const it of items) {
      let arr = map.get(it.modelId);
      if (!arr) { arr = []; map.set(it.modelId, arr); }
      arr.push(it.localId);
    }
    return map;
  };

  // Edge overlays are only drawn for small selections — adding/removing
  // individual LineSegments for thousands of items is too expensive.
  const EDGE_OVERLAY_THRESHOLD = 50;

  // Fire-and-forget per-model setColor / resetColor. The library's
  // MeshConnection batches multiple calls landing in the same tick so
  // there's no benefit to awaiting these.
  const paintColors = (items: ItemId[], on: boolean): void => {
    if (!ctxRef || !items.length) return;
    if (!enabled) return;
    for (const [modelId, ids] of groupByModel(items)) {
      const model = ctxRef.models().get(modelId);
      if (!model) continue;
      if (on) void model.setColor(ids, color).catch(() => undefined);
      else    void model.resetColor(ids).catch(() => undefined);
    }
  };

  const paint = (items: ItemId[], on: boolean): void => {
    paintColors(items, on);
    if (items.length <= EDGE_OVERLAY_THRESHOLD) {
      if (!ctxRef) return;
      if (on) void edges.add(ctxRef, items, color);
      else    edges.remove(ctxRef, items);
    }
  };

  const emitChange = (added: ItemId[], removed: ItemId[]): void => {
    if (!ctxRef) return;
    ctxRef.events.emit('selection:change', {
      selected: allSelected ? [] : [...itemMap.values()],
      added,
      removed,
      allSelected,
    });
  };

  // Lazily materialise the "all selected" set into the real Set+Map.
  // Called by any operation that needs a concrete per-item view (e.g.
  // deselecting one item out of an "all" selection). Cost: O(N) once.
  const materializeAll = async (): Promise<void> => {
    if (!allSelected || !ctxRef) return;
    selected.clear();
    itemMap.clear();
    for (const [modelId, model] of ctxRef.models()) {
      let ids: Iterable<number>;
      try {
        ids = await (model as unknown as { getLocalIds(): Promise<Iterable<number>> }).getLocalIds();
      } catch {
        continue;
      }
      for (const localId of ids) {
        const it: ItemId = { modelId, localId };
        const k = key(it);
        selected.add(k);
        itemMap.set(k, it);
      }
    }
    allSelected = false;
  };

  const setSelection = (items: ItemId[]): void => {
    // Caller has a concrete list of items, so any "all" invariant is
    // broken. We don't materialize because we'll overwrite the set anyway.
    const wasAllSelected = allSelected;
    allSelected = false;
    const nextKeys = new Set(items.map(key));
    const removed: ItemId[] = [];
    const added: ItemId[] = [];
    if (wasAllSelected) {
      // Coming from all-selected: everything not in `items` is implicitly
      // removed. Skip building the explicit removed[] (would be O(N) for
      // little gain) — the visual reset uses the bulk path below.
      for (const it of items) added.push(it);
    } else {
      for (const k of selected) {
        if (!nextKeys.has(k)) {
          const it = itemMap.get(k);
          if (it) removed.push(it);
        }
      }
      for (const it of items) {
        if (!selected.has(key(it))) added.push(it);
      }
    }
    // Fire both in the same tick — library batches the underlying tile
    // updates inside its MeshConnection window.
    if (wasAllSelected) {
      // Coming out of all-selected mode: nothing was painted, so just
      // paint the kept items. No bulk reset needed.
      paint(items, true);
    } else {
      paint(removed, false);
      paint(added, true);
    }
    selected.clear();
    itemMap.clear();
    for (const it of items) {
      const k = key(it);
      selected.add(k);
      itemMap.set(k, it);
    }
    if (added.length || removed.length || wasAllSelected) emitChange(added, removed);
  };

  const addItems = (items: ItemId[]): void => {
    if (allSelected) return; // Already includes everything.
    const fresh = items.filter((it) => !selected.has(key(it)));
    if (!fresh.length) return;
    paint(fresh, true);
    for (const it of fresh) {
      const k = key(it);
      selected.add(k);
      itemMap.set(k, it);
    }
    emitChange(fresh, []);
  };

  const removeItems = async (items: ItemId[]): Promise<void> => {
    if (allSelected) {
      // Need a concrete per-item view before we can remove just some.
      await materializeAll();
    }
    const present = items.filter((it) => selected.has(key(it)));
    if (!present.length) return;
    paint(present, false);
    for (const it of present) {
      const k = key(it);
      selected.delete(k);
      itemMap.delete(k);
    }
    emitChange([], present);
  };

  const clear = (): void => {
    if (!allSelected && !selected.size) return;
    if (allSelected) {
      // selectAll() didn't paint anything (see comment there), so clearing
      // out of "all selected" is purely a flag flip — no worker round-trip.
      if (ctxRef) edges.clear(ctxRef);
      allSelected = false;
      emitChange([], []);
      return;
    }
    const all = [...itemMap.values()];
    paintColors(all, false);
    if (ctxRef) edges.clear(ctxRef);
    selected.clear();
    itemMap.clear();
    emitChange([], all);
  };

  const selectAll = (): void => {
    if (!enabled || !ctxRef) return;
    if (allSelected) return;
    // Intentionally skip the 3D paint on select-all. The library's worker
    // walks every item to update its virtual-mesh state — that's the ~1s
    // floor that survived the bulk-API switch. The UI (status bar, tree,
    // properties panel) already communicates "everything is selected" via
    // the `selectedAll` flag, which is what users actually need from this
    // command. Re-painting becomes visible again as soon as the user
    // narrows the selection (pickSet on a single item paints just that
    // one).
    //
    // If there was a partial selection before this, reset just those
    // items' colors so they don't stay stuck in selection color.
    if (selected.size) {
      paintColors([...itemMap.values()], false);
    }
    if (ctxRef) edges.clear(ctxRef);
    selected.clear();
    itemMap.clear();
    allSelected = true;
    emitChange([], []);
  };

  // Pick-by-NDC helpers — used by the mouse-bindings dispatcher.
  type PickArgs = { ndc?: { x: number; y: number } | null; x?: number; y?: number } | null | undefined;
  const ndcOf = (args: PickArgs): { x: number; y: number } | null => {
    if (!args) return null;
    if (args.ndc) return args.ndc;
    if (typeof args.x === 'number' && typeof args.y === 'number') {
      return { x: args.x, y: args.y };
    }
    return null;
  };

  const pickSet = async (args: PickArgs): Promise<void> => {
    if (!ctxRef || !enabled) return;
    const ndc = ndcOf(args);
    if (!ndc) { clear(); return; }
    const hit = await pick(ctxRef, ndc);
    if (!hit || isClippedBySection(hit.point)) { clear(); return; }
    setSelection([hit.item]);
  };

  const pickAdd = async (args: PickArgs): Promise<void> => {
    if (!ctxRef || !enabled) return;
    const ndc = ndcOf(args);
    if (!ndc) return;
    const hit = await pick(ctxRef, ndc);
    if (!hit || isClippedBySection(hit.point)) return;
    addItems([hit.item]);
  };

  const pickToggle = async (args: PickArgs): Promise<void> => {
    if (!ctxRef || !enabled) return;
    const ndc = ndcOf(args);
    if (!ndc) return;
    const hit = await pick(ctxRef, ndc);
    if (!hit || isClippedBySection(hit.point)) return;
    if (allSelected) {
      // Toggling under "all selected" means removing this one item.
      await materializeAll();
    }
    if (selected.has(key(hit.item))) await removeItems([hit.item]);
    else addItems([hit.item]);
  };

  const pickRemove = async (args: PickArgs): Promise<void> => {
    if (!ctxRef || !enabled) return;
    const ndc = ndcOf(args);
    if (!ndc) return;
    const hit = await pick(ctxRef, ndc);
    if (!hit || isClippedBySection(hit.point)) return;
    await removeItems([hit.item]);
  };

  // Toggle visual rendering without throwing away the selection set.
  // When disabled: clear visuals, keep state. On re-enable: repaint.
  const setEnabled = (next: boolean): void => {
    if (enabled === next) return;
    enabled = next;
    if (!ctxRef) return;
    // The `allSelected` branch never paints in either direction — selectAll
    // already skipped the 3D paint, so there's nothing to unpaint/repaint
    // when the feature flips.
    if (!enabled) {
      if (!allSelected && selected.size) {
        const all = [...itemMap.values()];
        for (const [modelId, ids] of groupByModel(all)) {
          const model = ctxRef.models().get(modelId);
          if (model) void model.resetColor(ids).catch(() => undefined);
        }
      }
      edges.clear(ctxRef);
    } else if (enabled) {
      if (!allSelected && selected.size) {
        paint([...itemMap.values()], true);
      }
    }
    ctxRef.events.emit('feature:enabled', { name: NAME, enabled });
  };

  const totalLoadedItems = (): number => {
    let n = 0;
    for (const c of modelCounts.values()) n += c;
    return n;
  };

  const api: Plugin & SelectionPluginAPI = {
    name: NAME,

    hasItem(item: ItemId) {
      return allSelected || selected.has(key(item));
    },
    size() {
      return allSelected ? totalLoadedItems() : selected.size;
    },
    list() {
      // For partial selections this is cheap. When `allSelected` is true
      // we return the explicit list of items currently known — this is a
      // sync API, so callers wanting the full materialized list must
      // first run `selection.materializeAll` (exposed as a command).
      return [...itemMap.values()];
    },
    isAllSelected() { return allSelected; },
    setEnabled,
    isEnabled() { return enabled; },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      ctx.events.on('section:change', ({ planes }) => {
        cachedSectionPlanes = planes;
      });

      // Refresh cached counts whenever a model loads so `size()` stays accurate.
      ctx.events.on('model:loaded', ({ modelId }) => {
        const model = ctx.models().get(modelId);
        if (!model) return;
        void (model as unknown as { getLocalIds(): Promise<Iterable<number>> })
          .getLocalIds()
          .then((ids) => {
            let n = 0;
            for (const _ of ids) n++;
            modelCounts.set(modelId, n);
          })
          .catch(() => undefined);
      });

      ctx.commands.register('selection.clear', () => clear(), {
        title: 'Clear selection',
      });
      ctx.commands.register(
        'selection.set',
        (args: unknown) => setSelection(toItems(args)),
        { title: 'Set selection' },
      );
      ctx.commands.register(
        'selection.add',
        (args: unknown) => addItems(toItems(args)),
        { title: 'Add to selection' },
      );
      ctx.commands.register(
        'selection.remove',
        (args: unknown) => removeItems(toItems(args)),
        { title: 'Remove from selection' },
      );
      ctx.commands.register('selection.get', () => [...itemMap.values()], {
        title: 'Get current selection',
      });
      ctx.commands.register(
        'selection.has',
        (args: unknown) => {
          const items = toItems(args);
          return items.length > 0 && (allSelected || selected.has(key(items[0]!)));
        },
        { title: 'Check selection membership' },
      );

      // Pick-at-pointer commands — bind these to mouse gestures.
      ctx.commands.register(
        'selection.pickSet',
        (args: unknown) => pickSet(args as PickArgs),
        { title: 'Select item at pointer' },
      );
      ctx.commands.register(
        'selection.pickAdd',
        (args: unknown) => pickAdd(args as PickArgs),
        { title: 'Add item at pointer to selection' },
      );
      ctx.commands.register(
        'selection.pickToggle',
        (args: unknown) => pickToggle(args as PickArgs),
        { title: 'Toggle item at pointer in selection' },
      );
      ctx.commands.register(
        'selection.pickRemove',
        (args: unknown) => pickRemove(args as PickArgs),
        { title: 'Remove item at pointer from selection' },
      );
      ctx.commands.register('selection.pickClear', () => clear(), {
        title: 'Clear selection (pointer)',
      });

      ctx.commands.register('selection.setEnabled', (args: unknown) => {
        const on = typeof args === 'boolean' ? args : (args as { enabled?: boolean })?.enabled;
        if (typeof on === 'boolean') setEnabled(on);
        return enabled;
      }, { title: 'Enable/disable selection feature' });
      ctx.commands.register('selection.isEnabled', () => enabled, {
        title: 'Get selection enabled state',
      });

      ctx.commands.register('selection.selectAll', () => selectAll(), {
        title: 'Select all elements',
      });

      ctx.commands.register('selection.materializeAll', async () => {
        await materializeAll();
      }, { title: 'Materialize all-selected state' });

      ctx.commands.register('selection.invert', async () => {
        if (!enabled) return;
        if (allSelected) {
          // Inverting "everything" is "nothing".
          clear();
          return;
        }
        const inverted: ItemId[] = [];
        for (const [modelId, model] of ctx.models()) {
          let ids: Iterable<number>;
          try {
            ids = await (model as unknown as { getLocalIds(): Promise<Iterable<number>> }).getLocalIds();
          } catch {
            continue;
          }
          for (const localId of ids) {
            if (!selected.has(key({ modelId, localId }))) {
              inverted.push({ modelId, localId });
            }
          }
        }
        setSelection(inverted);
      }, { title: 'Invert selection' });
    },

    uninstall() {
      if (ctxRef) edges.dispose(ctxRef);
      clear();
      cachedSectionPlanes = [];
      modelCounts.clear();
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

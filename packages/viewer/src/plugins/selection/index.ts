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
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
}

export function selectionPlugin(options: SelectionPluginOptions = {}): Plugin & SelectionPluginAPI {
  const color = new THREE.Color(options.color ?? 0x4a90d9);

  // `${modelId}::${localId}` keys for cheap Set ops.
  const selected = new Set<string>();
  const itemMap = new Map<string, ItemId>();

  const key = (i: ItemId): string => `${i.modelId}::${String(i.localId)}`;

  let ctxRef: ViewerContext | null = null;
  let enabled = true;
  const edges = new EdgeOverlay();

  const groupByModel = (items: ItemId[]): Map<string, number[]> => {
    const map = new Map<string, number[]>();
    for (const it of items) {
      let arr = map.get(it.modelId);
      if (!arr) { arr = []; map.set(it.modelId, arr); }
      arr.push(it.localId);
    }
    return map;
  };

  // Fire-and-forget per-model setColor / resetColor. The library's
  // MeshConnection batches multiple calls landing in the same tick so
  // there's no benefit to awaiting these.
  const paint = (items: ItemId[], on: boolean): void => {
    if (!ctxRef || !items.length) return;
    if (!enabled) return;
    for (const [modelId, ids] of groupByModel(items)) {
      const model = ctxRef.models().get(modelId);
      if (!model) continue;
      if (on) void model.setColor(ids, color).catch(() => undefined);
      else    void model.resetColor(ids).catch(() => undefined);
    }
    if (on) void edges.add(ctxRef, items, color);
    else    edges.remove(ctxRef, items);
  };

  const emitChange = (added: ItemId[], removed: ItemId[]): void => {
    if (!ctxRef) return;
    ctxRef.events.emit('selection:change', {
      selected: [...itemMap.values()],
      added,
      removed,
    });
  };

  const setSelection = (items: ItemId[]): void => {
    const nextKeys = new Set(items.map(key));
    const removed: ItemId[] = [];
    const added: ItemId[] = [];
    for (const k of selected) {
      if (!nextKeys.has(k)) {
        const it = itemMap.get(k);
        if (it) removed.push(it);
      }
    }
    for (const it of items) {
      if (!selected.has(key(it))) added.push(it);
    }
    // Fire both in the same tick — library batches the underlying tile
    // updates inside its MeshConnection window.
    paint(removed, false);
    paint(added, true);
    selected.clear();
    itemMap.clear();
    for (const it of items) {
      const k = key(it);
      selected.add(k);
      itemMap.set(k, it);
    }
    if (added.length || removed.length) emitChange(added, removed);
  };

  const addItems = (items: ItemId[]): void => {
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

  const removeItems = (items: ItemId[]): void => {
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
    if (!selected.size) return;
    const all = [...itemMap.values()];
    paint(all, false);
    selected.clear();
    itemMap.clear();
    emitChange([], all);
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
    if (!hit) { clear(); return; }
    setSelection([hit.item]);
  };

  const pickAdd = async (args: PickArgs): Promise<void> => {
    if (!ctxRef || !enabled) return;
    const ndc = ndcOf(args);
    if (!ndc) return;
    const hit = await pick(ctxRef, ndc);
    if (!hit) return;
    addItems([hit.item]);
  };

  const pickToggle = async (args: PickArgs): Promise<void> => {
    if (!ctxRef || !enabled) return;
    const ndc = ndcOf(args);
    if (!ndc) return;
    const hit = await pick(ctxRef, ndc);
    if (!hit) return;
    if (selected.has(key(hit.item))) removeItems([hit.item]);
    else addItems([hit.item]);
  };

  const pickRemove = async (args: PickArgs): Promise<void> => {
    if (!ctxRef || !enabled) return;
    const ndc = ndcOf(args);
    if (!ndc) return;
    const hit = await pick(ctxRef, ndc);
    if (!hit) return;
    removeItems([hit.item]);
  };

  // Toggle visual rendering without throwing away the selection set.
  // When disabled: clear visuals, keep state. On re-enable: repaint.
  const setEnabled = (next: boolean): void => {
    if (enabled === next) return;
    enabled = next;
    if (!ctxRef) return;
    const all = [...itemMap.values()];
    if (!enabled && all.length) {
      // Direct unpaint without going through `paint` (which is gated
      // on `enabled`).
      for (const [modelId, ids] of groupByModel(all)) {
        const model = ctxRef.models().get(modelId);
        if (model) void model.resetColor(ids).catch(() => undefined);
      }
      edges.remove(ctxRef, all);
    } else if (enabled && all.length) {
      paint(all, true);
    }
    ctxRef.events.emit('feature:enabled', { name: NAME, enabled });
  };

  const api: Plugin & SelectionPluginAPI = {
    name: NAME,

    hasItem(item: ItemId) {
      return selected.has(key(item));
    },
    size() {
      return selected.size;
    },
    list() {
      return [...itemMap.values()];
    },
    setEnabled,
    isEnabled() { return enabled; },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      ctx.commands.register('selection.clear', () => clear(), {
        title: 'Clear selection',
        defaultShortcut: 'Escape',
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
          return items.length > 0 && selected.has(key(items[0]!));
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

      ctx.commands.register('selection.selectAll', async () => {
        if (!enabled) return;
        const all: ItemId[] = [];
        for (const [modelId, model] of ctx.models()) {
          let ids: Iterable<number>;
          try {
            ids = await (model as unknown as { getLocalIds(): Promise<Iterable<number>> }).getLocalIds();
          } catch {
            continue;
          }
          for (const localId of ids) {
            all.push({ modelId, localId });
          }
        }
        if (all.length) setSelection(all);
      }, { title: 'Select all elements' });

      ctx.commands.register('selection.invert', async () => {
        if (!enabled) return;
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

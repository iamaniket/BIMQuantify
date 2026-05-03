/**
 * Selection plugin. Maintains a model-spanning selection set, paints
 * sticky highlight materials, and emits `selection:change`.
 *
 * The plugin owns no DOM listeners. Picking is exposed through commands
 * (`selection.pickSet`, `selection.pickAdd`, `selection.pickToggle`,
 * `selection.pickRemove`, `selection.pickClear`) which the `mouse-bindings`
 * plugin dispatches on whichever pointer gestures the user has bound to them.
 *
 * Exposes itself through `ctx.plugins.get('selection')` so other plugins
 * (e.g. hover) can do fast reads without going through the bus.
 */

import * as THREE from 'three';
import * as FRAGS from '@thatopen/fragments';

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
}

export function selectionPlugin(options: SelectionPluginOptions = {}): Plugin & SelectionPluginAPI {
  const color = new THREE.Color(options.color ?? 0x4a90d9);
  const opacity = options.opacity ?? 0.7;

  // `${modelId}::${localId}` keys for cheap Set ops.
  const selected = new Set<string>();
  const itemMap = new Map<string, ItemId>();

  const key = (i: ItemId): string => `${i.modelId}::${String(i.localId)}`;

  let ctxRef: ViewerContext | null = null;
  const edges = new EdgeOverlay();

  const material: FRAGS.MaterialDefinition = {
    color,
    opacity,
    transparent: opacity < 1,
    renderedFaces: FRAGS.RenderedFaces.TWO,
    customId: 'selection',
  };

  const paint = async (items: ItemId[], on: boolean): Promise<void> => {
    if (!ctxRef || !items.length) return;
    const byModel = new Map<string, number[]>();
    for (const it of items) {
      let arr = byModel.get(it.modelId);
      if (!arr) {
        arr = [];
        byModel.set(it.modelId, arr);
      }
      arr.push(it.localId);
    }
    for (const [modelId, ids] of byModel) {
      const model = ctxRef.models().get(modelId);
      if (!model) continue;
      if (on) {
        await model.highlight(ids, material).catch(() => undefined);
      } else {
        await model.resetHighlight(ids).catch(() => undefined);
      }
    }
    if (on) {
      void edges.add(ctxRef, items, color);
    } else {
      edges.remove(ctxRef, items);
    }
  };

  const emitChange = (added: ItemId[], removed: ItemId[]): void => {
    if (!ctxRef) return;
    ctxRef.events.emit('selection:change', {
      selected: [...itemMap.values()],
      added,
      removed,
    });
  };

  const setSelection = async (items: ItemId[]): Promise<void> => {
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
    await paint(removed, false);
    await paint(added, true);
    selected.clear();
    itemMap.clear();
    for (const it of items) {
      const k = key(it);
      selected.add(k);
      itemMap.set(k, it);
    }
    if (added.length || removed.length) emitChange(added, removed);
  };

  const addItems = async (items: ItemId[]): Promise<void> => {
    const fresh = items.filter((it) => !selected.has(key(it)));
    if (!fresh.length) return;
    await paint(fresh, true);
    for (const it of fresh) {
      const k = key(it);
      selected.add(k);
      itemMap.set(k, it);
    }
    emitChange(fresh, []);
  };

  const removeItems = async (items: ItemId[]): Promise<void> => {
    const present = items.filter((it) => selected.has(key(it)));
    if (!present.length) return;
    await paint(present, false);
    for (const it of present) {
      const k = key(it);
      selected.delete(k);
      itemMap.delete(k);
    }
    emitChange([], present);
  };

  const clear = async (): Promise<void> => {
    if (!selected.size) return;
    const all = [...itemMap.values()];
    await paint(all, false);
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
    if (!ctxRef) return;
    const ndc = ndcOf(args);
    if (!ndc) {
      await clear();
      return;
    }
    const hit = await pick(ctxRef, ndc);
    if (!hit) {
      await clear();
      return;
    }
    await setSelection([hit.item]);
  };

  const pickAdd = async (args: PickArgs): Promise<void> => {
    if (!ctxRef) return;
    const ndc = ndcOf(args);
    if (!ndc) return;
    const hit = await pick(ctxRef, ndc);
    if (!hit) return;
    await addItems([hit.item]);
  };

  const pickToggle = async (args: PickArgs): Promise<void> => {
    if (!ctxRef) return;
    const ndc = ndcOf(args);
    if (!ndc) return;
    const hit = await pick(ctxRef, ndc);
    if (!hit) return;
    if (selected.has(key(hit.item))) await removeItems([hit.item]);
    else await addItems([hit.item]);
  };

  const pickRemove = async (args: PickArgs): Promise<void> => {
    if (!ctxRef) return;
    const ndc = ndcOf(args);
    if (!ndc) return;
    const hit = await pick(ctxRef, ndc);
    if (!hit) return;
    await removeItems([hit.item]);
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

      ctx.commands.register('selection.selectAll', async () => {
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
        if (all.length) await setSelection(all);
      }, { title: 'Select all elements' });
    },

    uninstall() {
      if (ctxRef) edges.dispose(ctxRef);
      void clear();
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

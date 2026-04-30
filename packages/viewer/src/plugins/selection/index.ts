/**
 * Selection plugin. Click to select, Shift+Click to add, Ctrl/Cmd+Click
 * to toggle, click empty space to clear. Maintains the selection set
 * across models, paints sticky highlight materials, and emits
 * `selection:change`.
 *
 * Exposes itself through `ctx.plugins.get('selection')` so other plugins
 * (e.g. hover) can do fast reads without going through the bus.
 */

import * as THREE from 'three';
import * as FRAGS from '@thatopen/fragments';

import { clientToNdc, pick } from '../../core/Raycaster.js';
import type { ItemId, Plugin, ViewerContext } from '../../core/types.js';

const NAME = 'selection' as const;

interface SelectionPluginOptions {
  color?: number;
  opacity?: number;
  /** Drag distance in px before a pointerup is treated as a drag-not-click. */
  clickThreshold?: number;
}

export interface SelectionPluginAPI {
  /** Fast synchronous check. Used by hover plugin. */
  hasItem(item: ItemId): boolean;
  size(): number;
  list(): ItemId[];
}

export function selectionPlugin(options: SelectionPluginOptions = {}): Plugin & SelectionPluginAPI {
  const color = new THREE.Color(options.color ?? 0xff8a3d);
  const opacity = options.opacity ?? 0.7;
  const clickThreshold = options.clickThreshold ?? 4;

  // `${modelId}::${localId}` keys for cheap Set ops.
  const selected = new Set<string>();
  const itemMap = new Map<string, ItemId>();

  const key = (i: ItemId): string => `${i.modelId}::${String(i.localId)}`;

  let cleanup: (() => void) | null = null;
  let ctxRef: ViewerContext | null = null;

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
      const canvas = ctx.canvas;

      let downX = 0;
      let downY = 0;
      let downBtn = -1;

      const onDown = (ev: PointerEvent): void => {
        downX = ev.clientX;
        downY = ev.clientY;
        downBtn = ev.button;
      };

      const onUp = (ev: PointerEvent): void => {
        if (ev.button !== 0 || downBtn !== 0) return;
        const dx = ev.clientX - downX;
        const dy = ev.clientY - downY;
        if (Math.hypot(dx, dy) > clickThreshold) return; // it was a drag

        const ndc = clientToNdc(canvas, ev.clientX, ev.clientY);
        ctx.events.emit('pointer:click', {
          ndc,
          button: ev.button,
          shift: ev.shiftKey,
          ctrl: ev.ctrlKey,
          meta: ev.metaKey,
        });
        void (async () => {
          const hit = await pick(ctx, ndc);
          if (!hit) {
            if (!ev.shiftKey && !ev.ctrlKey && !ev.metaKey) await clear();
            return;
          }
          if (ev.ctrlKey || ev.metaKey) {
            // toggle
            if (selected.has(key(hit.item))) await removeItems([hit.item]);
            else await addItems([hit.item]);
          } else if (ev.shiftKey) {
            await addItems([hit.item]);
          } else {
            await setSelection([hit.item]);
          }
        })();
      };

      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointerup', onUp);

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

      cleanup = (): void => {
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointerup', onUp);
        // Reset visual state on shutdown.
        void clear();
      };
    },

    uninstall() {
      cleanup?.();
      cleanup = null;
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

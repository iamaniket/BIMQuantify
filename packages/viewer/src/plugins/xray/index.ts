/**
 * X-ray plugin. Applies a "ghosted" look by lowering item opacity via
 * `FragmentsModel.setOpacity`. Because opacity is independent of color
 * in the library's API, x-ray composes naturally with selection and
 * hover (which use `setColor`).
 */

import type { ItemId, Plugin, ViewerContext } from '../../core/types.js';

const NAME = 'xray' as const;

export interface XrayPluginOptions {
  /** Reserved — color is preserved by the library when only opacity changes. */
  color?: number;
  /** Opacity for ghosted items (0..1). Default: 0.15. */
  opacity?: number;
}

export interface XrayPluginAPI {
  list(): ItemId[];
  hasItem(item: ItemId): boolean;
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
}

const itemKey = (i: ItemId): string => `${i.modelId}::${String(i.localId)}`;

export function xrayPlugin(options: XrayPluginOptions = {}): Plugin & XrayPluginAPI {
  const opacity = options.opacity ?? 0.15;

  const xrayed = new Set<string>();
  const itemMap = new Map<string, ItemId>();

  let ctxRef: ViewerContext | null = null;
  let enabled = true;

  const groupByModel = (items: ItemId[]): Map<string, number[]> => {
    const map = new Map<string, number[]>();
    for (const it of items) {
      let arr = map.get(it.modelId);
      if (!arr) { arr = []; map.set(it.modelId, arr); }
      arr.push(it.localId);
    }
    return map;
  };

  // Fire-and-forget setOpacity per model. The library batches inside its
  // MeshConnection window, so awaiting these only delays the visual.
  const applyOpacity = (items: ItemId[]): void => {
    if (!ctxRef || !items.length || !enabled) return;
    for (const [modelId, ids] of groupByModel(items)) {
      const model = ctxRef.models().get(modelId);
      if (model) void model.setOpacity(ids, opacity).catch(() => undefined);
    }
  };

  const resetOpacity = (items: ItemId[]): void => {
    if (!ctxRef || !items.length) return;
    for (const [modelId, ids] of groupByModel(items)) {
      const model = ctxRef.models().get(modelId);
      if (model) void model.resetOpacity(ids).catch(() => undefined);
    }
  };

  const applyXray = (items: ItemId[]): void => {
    if (!items.length) return;
    const fresh = items.filter((it) => !xrayed.has(itemKey(it)));
    for (const it of items) {
      const k = itemKey(it);
      xrayed.add(k);
      itemMap.set(k, it);
    }
    if (fresh.length) applyOpacity(fresh);
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
    if (present.length) resetOpacity(present);
    emitChange();
  };

  const emitChange = (): void => {
    ctxRef?.events.emit('xray:change', { xrayed: [...itemMap.values()] });
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
    applyXray(toXray);
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
    resetOpacity(all);
    xrayed.clear();
    itemMap.clear();
    emitChange();
  };

  const setEnabled = (next: boolean): void => {
    if (enabled === next) return;
    enabled = next;
    if (!ctxRef) return;
    const all = [...itemMap.values()];
    if (!enabled && all.length) {
      resetOpacity(all);
    } else if (enabled && all.length) {
      // Repaint without going through `applyOpacity` (which is gated).
      for (const [modelId, ids] of groupByModel(all)) {
        const model = ctxRef.models().get(modelId);
        if (model) void model.setOpacity(ids, opacity).catch(() => undefined);
      }
    }
    ctxRef.events.emit('feature:enabled', { name: NAME, enabled });
  };

  const api: Plugin & XrayPluginAPI = {
    name: NAME,
    dependencies: ['selection'],

    list() {
      return [...itemMap.values()];
    },
    hasItem(item: ItemId) {
      return xrayed.has(itemKey(item));
    },
    setEnabled,
    isEnabled() { return enabled; },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      ctx.commands.register('xray.selected', () => xraySelected(), {
        title: 'X-ray selected elements',
      });
      ctx.commands.register('xray.all', () => xrayAll(), {
        title: 'X-ray all elements',
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
    },

    uninstall() {
      clearXray();
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

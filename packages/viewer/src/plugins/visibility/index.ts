/**
 * Visibility plugin. Provides isolate, hide, and show-all commands that
 * operate on the current selection. Uses the FragmentsModel v3 visibility
 * API (`setVisible` / `resetVisible`).
 *
 * Depends on the `selection` plugin for reading the current selection set.
 */

import type { ItemId, Plugin, ViewerContext } from '../../core/types.js';

const NAME = 'visibility' as const;

export interface VisibilityPluginOptions {
  // Reserved for future options.
}

export interface VisibilityPluginAPI {
  isIsolated(): boolean;
  hiddenItems(): ItemId[];
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
}

const itemKey = (i: ItemId): string => `${i.modelId}::${String(i.localId)}`;

export function visibilityPlugin(
  _options: VisibilityPluginOptions = {},
): Plugin & VisibilityPluginAPI {
  let ctxRef: ViewerContext | null = null;
  let enabled = true;
  let isolationActive = false;
  const isolatedSet = new Set<string>();
  const isolatedItems = new Map<string, ItemId>();
  const hiddenSet = new Set<string>();
  const hiddenItemMap = new Map<string, ItemId>();

  const emitChange = (): void => {
    if (!ctxRef) return;
    ctxRef.events.emit('visibility:change', {
      hidden: [...hiddenItemMap.values()],
      isolated: [...isolatedItems.values()],
      isolationActive,
    });
  };

  const getSelection = async (): Promise<ItemId[]> => {
    if (!ctxRef) return [];
    try {
      return (await ctxRef.commands.execute<undefined, ItemId[]>('selection.get')) ?? [];
    } catch {
      return [];
    }
  };

  const isolate = async (): Promise<void> => {
    if (!ctxRef || !enabled) return;
    const selected = await getSelection();
    if (!selected.length) return;

    const selectedByModel = new Map<string, number[]>();
    for (const it of selected) {
      let arr = selectedByModel.get(it.modelId);
      if (!arr) {
        arr = [];
        selectedByModel.set(it.modelId, arr);
      }
      arr.push(it.localId);
    }

    for (const [modelId, model] of ctxRef.models()) {
      await model.setVisible(undefined, false).catch(() => undefined);
      const ids = selectedByModel.get(modelId);
      if (ids?.length) {
        await model.setVisible(ids, true).catch(() => undefined);
      }
    }

    isolatedSet.clear();
    isolatedItems.clear();
    for (const it of selected) {
      const k = itemKey(it);
      isolatedSet.add(k);
      isolatedItems.set(k, it);
    }
    isolationActive = true;
    emitChange();
  };

  const hide = async (): Promise<void> => {
    if (!ctxRef || !enabled) return;
    const selected = await getSelection();
    if (!selected.length) return;

    const byModel = new Map<string, number[]>();
    for (const it of selected) {
      let arr = byModel.get(it.modelId);
      if (!arr) {
        arr = [];
        byModel.set(it.modelId, arr);
      }
      arr.push(it.localId);
      const k = itemKey(it);
      hiddenSet.add(k);
      hiddenItemMap.set(k, it);
    }

    for (const [modelId, ids] of byModel) {
      const model = ctxRef.models().get(modelId);
      if (model) {
        await model.setVisible(ids, false).catch(() => undefined);
      }
    }

    await ctxRef.commands.execute('selection.clear').catch(() => undefined);
    emitChange();
  };

  const hideAll = async (): Promise<void> => {
    if (!ctxRef || !enabled) return;

    for (const [modelId, model] of ctxRef.models()) {
      let allIds: Iterable<number>;
      try {
        allIds = await (model as unknown as { getLocalIds(): Promise<Iterable<number>> }).getLocalIds();
      } catch {
        continue;
      }
      for (const localId of allIds) {
        const k = itemKey({ modelId, localId });
        hiddenSet.add(k);
        hiddenItemMap.set(k, { modelId, localId });
      }
      await model.setVisible(undefined, false).catch(() => undefined);
    }

    emitChange();
  };

  const hideItem = async (args: unknown): Promise<void> => {
    if (!ctxRef || !enabled) return;
    const items = toItems(args);
    if (!items.length) return;

    const byModel = new Map<string, number[]>();
    for (const it of items) {
      let arr = byModel.get(it.modelId);
      if (!arr) { arr = []; byModel.set(it.modelId, arr); }
      arr.push(it.localId);
      const k = itemKey(it);
      hiddenSet.add(k);
      hiddenItemMap.set(k, it);
    }

    for (const [modelId, ids] of byModel) {
      const model = ctxRef.models().get(modelId);
      if (model) await model.setVisible(ids, false).catch(() => undefined);
    }

    emitChange();
  };

  const isolateItem = async (args: unknown): Promise<void> => {
    if (!ctxRef || !enabled) return;
    const items = toItems(args);
    if (!items.length) return;

    const itemsByModel = new Map<string, number[]>();
    for (const it of items) {
      let arr = itemsByModel.get(it.modelId);
      if (!arr) { arr = []; itemsByModel.set(it.modelId, arr); }
      arr.push(it.localId);
    }

    for (const [modelId, model] of ctxRef.models()) {
      await model.setVisible(undefined, false).catch(() => undefined);
      const ids = itemsByModel.get(modelId);
      if (ids?.length) await model.setVisible(ids, true).catch(() => undefined);
    }

    isolatedSet.clear();
    isolatedItems.clear();
    for (const it of items) {
      const k = itemKey(it);
      isolatedSet.add(k);
      isolatedItems.set(k, it);
    }
    isolationActive = true;
    emitChange();
  };

  const showAll = async (): Promise<void> => {
    if (!ctxRef) return;

    for (const model of ctxRef.models().values()) {
      await model.resetVisible().catch(() => undefined);
    }

    isolatedSet.clear();
    isolatedItems.clear();
    hiddenSet.clear();
    hiddenItemMap.clear();
    isolationActive = false;
    emitChange();
  };

  const setEnabled = (next: boolean): void => {
    if (enabled === next) return;
    enabled = next;
    if (!enabled) {
      // On disable: restore everything to fully visible. Keeps the
      // viewer in a clean state regardless of accumulated hide/isolate
      // history.
      void showAll();
    }
    ctxRef?.events.emit('feature:enabled', { name: NAME, enabled });
  };

  const api: Plugin & VisibilityPluginAPI = {
    name: NAME,
    dependencies: ['selection'],

    isIsolated() {
      return isolationActive;
    },

    hiddenItems() {
      return [...hiddenItemMap.values()];
    },

    setEnabled,
    isEnabled() { return enabled; },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      ctx.commands.register('visibility.isolate', () => isolate(), {
        title: 'Isolate selected elements',
        defaultShortcut: 'I',
      });

      ctx.commands.register('visibility.hide', () => hide(), {
        title: 'Hide selected elements',
        defaultShortcut: 'Shift+H',
      });

      ctx.commands.register('visibility.hideAll', () => hideAll(), {
        title: 'Hide all elements',
      });

      ctx.commands.register(
        'visibility.hideItem',
        (args: unknown) => hideItem(args),
        { title: 'Hide element under cursor' },
      );

      ctx.commands.register(
        'visibility.isolateItem',
        (args: unknown) => isolateItem(args),
        { title: 'Show only element under cursor' },
      );

      ctx.commands.register('visibility.showAll', () => showAll(), {
        title: 'Show all elements',
        defaultShortcut: 'Shift+I',
      });

      ctx.commands.register('visibility.setEnabled', (args: unknown) => {
        const on = typeof args === 'boolean' ? args : (args as { enabled?: boolean })?.enabled;
        if (typeof on === 'boolean') setEnabled(on);
        return enabled;
      }, { title: 'Enable/disable visibility feature' });
      ctx.commands.register('visibility.isEnabled', () => enabled, {
        title: 'Get visibility enabled state',
      });
    },

    uninstall() {
      if (ctxRef) {
        void showAll();
      }
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

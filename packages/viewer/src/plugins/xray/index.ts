/**
 * X-ray plugin. Applies a semi-transparent highlight to items, creating
 * a "ghosted" look. Uses `FragmentsModel.highlight()` with a dedicated
 * `customId` so it coexists with selection and hover highlights.
 */

import * as THREE from 'three';
import * as FRAGS from '@thatopen/fragments';

import type { ItemId, Plugin, ViewerContext } from '../../core/types.js';

const NAME = 'xray' as const;

export interface XrayPluginOptions {
  color?: number;
  opacity?: number;
}

export interface XrayPluginAPI {
  list(): ItemId[];
  hasItem(item: ItemId): boolean;
}

const itemKey = (i: ItemId): string => `${i.modelId}::${String(i.localId)}`;

export function xrayPlugin(options: XrayPluginOptions = {}): Plugin & XrayPluginAPI {
  const color = new THREE.Color(options.color ?? 0x88bbdd);
  const opacity = options.opacity ?? 0.15;

  const xrayed = new Set<string>();
  const itemMap = new Map<string, ItemId>();

  let ctxRef: ViewerContext | null = null;

  const material: FRAGS.MaterialDefinition = {
    color,
    opacity,
    transparent: true,
    renderedFaces: FRAGS.RenderedFaces.TWO,
    customId: 'xray',
  };

  const applyXray = async (items: ItemId[]): Promise<void> => {
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
      await model.highlight(ids, material).catch(() => undefined);
    }
    for (const it of items) {
      const k = itemKey(it);
      xrayed.add(k);
      itemMap.set(k, it);
    }
    emitChange();
  };

  const removeXray = async (items: ItemId[]): Promise<void> => {
    if (!ctxRef || !items.length) return;
    const byModel = new Map<string, number[]>();
    for (const it of items) {
      const k = itemKey(it);
      if (!xrayed.has(k)) continue;
      let arr = byModel.get(it.modelId);
      if (!arr) {
        arr = [];
        byModel.set(it.modelId, arr);
      }
      arr.push(it.localId);
      xrayed.delete(k);
      itemMap.delete(k);
    }
    for (const [modelId, ids] of byModel) {
      const model = ctxRef.models().get(modelId);
      if (!model) continue;
      await model.resetHighlight(ids).catch(() => undefined);
    }
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
    if (!selected.length) return;
    await applyXray(selected);
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
    await applyXray(toXray);
  };

  const clearXray = async (): Promise<void> => {
    if (!ctxRef || !xrayed.size) return;
    const all = [...itemMap.values()];
    const byModel = new Map<string, number[]>();
    for (const it of all) {
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
      await model.resetHighlight(ids).catch(() => undefined);
    }
    xrayed.clear();
    itemMap.clear();
    emitChange();
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

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      ctx.commands.register('xray.selected', () => xraySelected(), {
        title: 'X-ray selected elements',
      });
      ctx.commands.register('xray.allExcept', () => xrayAllExcept(), {
        title: 'X-ray all except selected',
      });
      ctx.commands.register(
        'xray.set',
        (args: unknown) => applyXray(toItems(args)),
        { title: 'X-ray specific elements' },
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
    },

    uninstall() {
      void clearXray();
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

/**
 * Visibility plugin. Provides isolate, hide, and show-all commands that operate
 * on the current selection, plus a type-based "exception list" (IfcSpaces by
 * default), event emission, and command integration.
 *
 * Visibility operations run against the viewer's own `FRAGS.FragmentsModels`
 * via `ctx.models()` (see `createModelHider`). We deliberately do NOT use OBC's
 * `Hider` component: `Hider` reads `components.get(FragmentsManager).list`, but
 * this viewer loads every model into its own FragmentsModels (`ctx.fragments`),
 * never into the OBC FragmentsManager — so that list is always empty and every
 * `Hider` call is a silent no-op (which is exactly what broke the spaces
 * toggle). This helper mirrors Hider's API over the models the viewer owns.
 *
 * Lockstep with the outline plugin: each op mutates `setVisible` first, then
 * `emitChange()` so the outline (and other consumers) re-filter synchronously,
 * then exactly ONE `flush()` (`fragments.update(true)` + `requestRender()`).
 * Requesting the render only after the filter is applied is what stops a hidden
 * element's outline from lingering on screen during isolate/hide.
 *
 * Exception list (Part D): the plugin self-identifies the managed IFC types
 * (`getItemsOfCategories`) per model at load, auto-hides them, and keeps them
 * hidden through bulk show/hide. They are controlled ONLY by
 * `visibility.setTypeVisible` — the toolbar spaces toggle calls that.
 *
 * Depends on the `selection` plugin for reading the current selection set.
 */

import { pick } from '../../../core/Raycaster.js';
import { verror } from '../../../core/debugLog.js';
import type { ItemId, Plugin, ViewerContext } from '../../../core/types.js';
import { createExceptionManager, normalizeType } from './exceptionManager.js';
import { createModelHider, type ModelHider } from './modelHider.js';

const NAME = 'visibility' as const;

export interface VisibilityPluginOptions {
  /**
   * IFC categories the plugin controls individually (the "exception list").
   * They are auto-hidden at model load and never revealed by bulk show/hide —
   * only by `visibility.setTypeVisible`. Default: `['IfcSpace']`.
   */
  exceptionTypes?: string[];
}

export interface VisibilityPluginAPI {
  isIsolated(): boolean;
  hiddenItems(): ItemId[];
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
}

const itemKey = (i: ItemId): string => `${i.modelId}::${String(i.localId)}`;

function toModelIdMap(items: ItemId[]): Record<string, Set<number>> {
  const map: Record<string, Set<number>> = {};
  for (const it of items) {
    (map[it.modelId] ??= new Set()).add(it.localId);
  }
  return map;
}

export function visibilityPlugin(
  options: VisibilityPluginOptions = {},
): Plugin & VisibilityPluginAPI {
  let ctxRef: ViewerContext | null = null;
  let hider: ModelHider | null = null;
  let offModelLoaded: (() => void) | null = null;
  let offModelUnloaded: (() => void) | null = null;
  let enabled = true;
  let isolationActive = false;
  const isolatedSet = new Set<string>();
  const isolatedItems = new Map<string, ItemId>();
  const hiddenSet = new Set<string>();
  const hiddenItemMap = new Map<string, ItemId>();
  // Generic "stays hidden through show-all" set, driven by the low-level
  // `setPersistentHidden` command. Managed exception types are tracked
  // separately below; both are folded together by `reapplyPersistent`.
  const persistentHidden = new Map<string, ItemId>();

  // --- Exception list (Part D) -------------------------------------------
  // IFC categories the plugin controls individually. Auto-hidden at load and
  // kept hidden through bulk ops; flipped only via `visibility.setTypeVisible`.
  // Owns its own maps; reads `ctx` lazily via the closure below.
  const exceptions = createExceptionManager(options.exceptionTypes, () => ctxRef);
  const {
    managedTypes,
    typeHidden,
    exceptionIdsByModel,
    resolveCategory,
    resolveExceptionsForModel,
    exceptionItems,
    managedHiddenItems,
  } = exceptions;

  // Keys that must never be revealed by bulk/element show ops — the generic
  // persistent set plus every managed-hidden type's items.
  const persistentKeys = (): Set<string> => {
    const s = new Set(persistentHidden.keys());
    for (const it of managedHiddenItems()) s.add(itemKey(it));
    return s;
  };
  // -----------------------------------------------------------------------

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

  // Re-hide the generic persistent set + every managed-hidden type and fold
  // them into the authoritative hidden maps. Mutate-only — the caller flushes.
  const reapplyPersistent = async (): Promise<void> => {
    if (!hider) return;
    const items = [...persistentHidden.values(), ...managedHiddenItems()];
    if (items.length === 0) return;
    await hider.set(false, toModelIdMap(items)).catch(() => undefined);
    for (const it of items) {
      const k = itemKey(it);
      hiddenSet.add(k);
      hiddenItemMap.set(k, it);
    }
  };

  // Isolation is "hide everything except these". Records every non-kept element
  // in `hiddenSet`/`hiddenItemMap` so the emitted `hidden` set stays authoritative
  // for consumers that need it (camera.frameVisible, bcf, the portal).
  const applyIsolation = async (items: ItemId[]): Promise<void> => {
    if (!ctxRef || !hider) return;

    const keepMap = toModelIdMap(items);
    await hider.isolate(keepMap).catch(() => undefined);
    // Keep managed-hidden types hidden even under isolation.
    await reapplyPersistent();

    isolatedSet.clear();
    isolatedItems.clear();
    for (const it of items) {
      const k = itemKey(it);
      isolatedSet.add(k);
      isolatedItems.set(k, it);
    }
    isolationActive = true;

    // Rebuild the authoritative hidden set from actual model state.
    hiddenSet.clear();
    hiddenItemMap.clear();
    const hiddenMap = await hider.getVisibilityMap(false).catch((err: unknown) => {
      // Don't silently forget the hidden set — a failed read can otherwise leave
      // geometry stuck invisible after show-all. Surface it (always-on verror).
      verror('visibility', 'getVisibilityMap failed during hidden-set rebuild', err);
      return {};
    });
    for (const [modelId, ids] of Object.entries(hiddenMap)) {
      if (!ids) continue;
      for (const localId of ids) {
        const k = itemKey({ modelId, localId });
        hiddenSet.add(k);
        hiddenItemMap.set(k, { modelId, localId });
      }
    }

    emitChange();
    await hider.flush();
  };

  const isolate = async (): Promise<void> => {
    if (!ctxRef || !enabled) return;
    const selected = await getSelection();
    if (!selected.length) return;
    await applyIsolation(selected);
  };

  // Drop items from the isolated set when they get individually hidden, so the
  // outline (which reads the isolated set under isolation) stops drawing them.
  const dropFromIsolated = (items: ItemId[]): void => {
    if (!isolationActive) return;
    for (const it of items) {
      const k = itemKey(it);
      isolatedSet.delete(k);
      isolatedItems.delete(k);
    }
  };

  const hide = async (): Promise<void> => {
    if (!ctxRef || !hider || !enabled) return;
    const selected = await getSelection();
    if (!selected.length) return;

    // Clear selection first: its `selection:change` wake can then only paint the
    // pre-hide (consistent) state, never a hidden-geometry/full-outline frame.
    await ctxRef.commands.execute('selection.clear').catch(() => undefined);

    await hider.set(false, toModelIdMap(selected)).catch(() => undefined);
    for (const it of selected) {
      const k = itemKey(it);
      hiddenSet.add(k);
      hiddenItemMap.set(k, it);
    }
    dropFromIsolated(selected);

    emitChange();
    await hider.flush();
  };

  const hideAll = async (): Promise<void> => {
    if (!ctxRef || !hider || !enabled) return;

    await hider.set(false).catch(() => undefined);
    // Managed types are controlled only by their toggle — re-show the shown ones
    // (hide-all doesn't touch the exception list).
    const toShow: ItemId[] = [];
    for (const key of managedTypes) {
      if (!typeHidden.get(key)) toShow.push(...exceptionItems(key));
    }
    if (toShow.length) {
      await hider.set(true, toModelIdMap(toShow)).catch(() => undefined);
    }

    // Rebuild tracking from actual model state.
    hiddenSet.clear();
    hiddenItemMap.clear();
    const hiddenMap = await hider.getVisibilityMap(false).catch((err: unknown) => {
      // Don't silently forget the hidden set — a failed read can otherwise leave
      // geometry stuck invisible after show-all. Surface it (always-on verror).
      verror('visibility', 'getVisibilityMap failed during hidden-set rebuild', err);
      return {};
    });
    for (const [modelId, ids] of Object.entries(hiddenMap)) {
      if (!ids) continue;
      for (const localId of ids) {
        const k = itemKey({ modelId, localId });
        hiddenSet.add(k);
        hiddenItemMap.set(k, { modelId, localId });
      }
    }

    emitChange();
    await hider.flush();
  };

  const hideItem = async (args: unknown): Promise<void> => {
    if (!ctxRef || !hider || !enabled) return;
    const items = toItems(args);
    if (!items.length) return;

    await hider.set(false, toModelIdMap(items)).catch(() => undefined);
    for (const it of items) {
      const k = itemKey(it);
      hiddenSet.add(k);
      hiddenItemMap.set(k, it);
    }
    dropFromIsolated(items);

    emitChange();
    await hider.flush();
  };

  const isolateItem = async (args: unknown): Promise<void> => {
    if (!ctxRef || !enabled) return;
    const items = toItems(args);
    if (!items.length) return;
    await applyIsolation(items);
  };

  // Double-click handler bound to `doubleclick:left` by default. Raycast
  // under the cursor and branch:
  //   - hit, and that element is already the sole isolated one → show all;
  //   - hit, otherwise → isolate that element, then frame it;
  //   - miss (empty space) → leave isolation untouched and gently recenter the
  //     model (the recovery gesture — preserves the viewing angle instead of the
  //     jarring iso-snap fit). Falls back to frameVisible if recenter is absent.
  const isolateAtPointer = async (args: unknown): Promise<void> => {
    if (!ctxRef || !enabled) return;
    const ndc = ndcOf(args as PickArgs);
    const hit = ndc ? await pick(ctxRef, ndc) : null;
    if (hit) {
      const alreadySoleIsolated =
        isolationActive && isolatedSet.size === 1 && isolatedSet.has(itemKey(hit.item));
      if (alreadySoleIsolated) {
        await showAll();
      } else {
        await applyIsolation([hit.item]);
      }
      if (ctxRef.commands.has('camera.frameVisible')) {
        await ctxRef.commands.execute('camera.frameVisible').catch(() => undefined);
      }
      return;
    }
    // Empty-space double-click — bring a lost model back, gently.
    if (ctxRef.commands.has('camera.recenter')) {
      await ctxRef.commands.execute('camera.recenter').catch(() => undefined);
    } else if (ctxRef.commands.has('camera.frameVisible')) {
      await ctxRef.commands.execute('camera.frameVisible').catch(() => undefined);
    }
  };

  const showItem = async (args: unknown): Promise<void> => {
    if (!ctxRef || !hider) return;
    const items = toItems(args);
    if (!items.length) return;

    const pk = persistentKeys();
    const toShow: ItemId[] = [];
    for (const it of items) {
      const k = itemKey(it);
      if (pk.has(k)) continue; // managed-hidden / persistent stays hidden
      toShow.push(it);
      hiddenSet.delete(k);
      hiddenItemMap.delete(k);
    }

    if (toShow.length) {
      await hider.set(true, toModelIdMap(toShow)).catch(() => undefined);
    }

    emitChange();
    await hider.flush();
  };

  // Low-level generic persistent-hidden set (item-based). Managed exception
  // types are handled by `setTypeVisible`; this stays for any non-type use.
  const setPersistentHidden = async (args: unknown): Promise<void> => {
    if (!ctxRef || !hider) return;
    const items = toItems(args);
    const nextKeys = new Set(items.map(itemKey));
    const managedKeys = new Set(managedHiddenItems().map(itemKey));

    // Show items that were generically persistent before but no longer are —
    // unless still held hidden by a managed type.
    const toShow: ItemId[] = [];
    for (const [k, it] of persistentHidden) {
      if (nextKeys.has(k)) continue;
      if (managedKeys.has(k)) continue;
      hiddenSet.delete(k);
      hiddenItemMap.delete(k);
      toShow.push(it);
    }

    persistentHidden.clear();
    for (const it of items) persistentHidden.set(itemKey(it), it);

    if (toShow.length) {
      await hider.set(true, toModelIdMap(toShow)).catch(() => undefined);
    }

    await reapplyPersistent();
    emitChange();
    await hider.flush();
  };

  // Show/hide every element of a managed IFC type across all loaded models.
  // The toolbar spaces toggle calls this. Adds the type to the managed set if
  // new, so the host can control arbitrary types ("show these / hide these").
  const setTypeVisible = async (arg: unknown): Promise<void> => {
    if (!ctxRef || !hider) return;
    const { type, visible } = (arg ?? {}) as { type?: string; visible?: boolean };
    if (typeof type !== 'string' || typeof visible !== 'boolean') return;
    const key = normalizeType(type);

    managedTypes.add(key);
    // Resolve the type's ids for any loaded model that hasn't been resolved yet.
    for (const [modelId, model] of ctxRef.models()) {
      let perType = exceptionIdsByModel.get(modelId);
      if (!perType) {
        perType = new Map();
        exceptionIdsByModel.set(modelId, perType);
      }
      if (!perType.has(key)) perType.set(key, await resolveCategory(model, key));
    }

    typeHidden.set(key, !visible);

    const items = exceptionItems(key);
    if (items.length === 0) return; // nothing loaded yet; state tracked for later loads

    if (visible) {
      for (const it of items) {
        const k = itemKey(it);
        hiddenSet.delete(k);
        hiddenItemMap.delete(k);
      }
      await hider.set(true, toModelIdMap(items)).catch(() => undefined);
    } else {
      for (const it of items) {
        const k = itemKey(it);
        hiddenSet.add(k);
        hiddenItemMap.set(k, it);
      }
      await hider.set(false, toModelIdMap(items)).catch(() => undefined);
    }

    emitChange();
    await hider.flush();
  };

  const showAll = async (): Promise<void> => {
    if (!ctxRef || !hider) return;
    // Capture the hider locally: `showAll` is fired-and-forgotten from
    // `uninstall()` and `setEnabled(false)`, both of which can null the closure
    // `hider` while we're awaiting below. Holding the reference here lets the
    // restore-all-visibility flush complete instead of throwing on a null.
    const h = hider;

    await h.set(true).catch(() => undefined);

    isolatedSet.clear();
    isolatedItems.clear();
    hiddenSet.clear();
    hiddenItemMap.clear();
    isolationActive = false;
    // Managed-hidden types (and any generic persistent items) stay hidden through
    // a full show-all — they are exceptions, controlled only by their toggle.
    await reapplyPersistent();
    emitChange();
    await h.flush();
  };

  const setEnabled = (next: boolean): void => {
    if (enabled === next) return;
    enabled = next;
    if (!enabled) {
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
      hider = createModelHider(ctx);

      // On model load, resolve the managed types for the new model and apply the
      // current toggle state (auto-hide the ones that should be hidden). This is
      // what makes IfcSpaces hidden-by-default without the host pushing ids, and
      // covers models that stream in after the toggle was already set.
      offModelLoaded = ctx.events.on('model:loaded', ({ modelId }) => {
        void (async () => {
          if (!hider) return;
          await resolveExceptionsForModel(modelId);
          // Fold this model's currently-hidden managed items into the persistent
          // set and re-hide everything persistent (idempotent across models).
          for (const key of managedTypes) {
            if (!typeHidden.get(key)) continue;
            for (const it of exceptionItems(key, modelId)) {
              persistentHidden.set(itemKey(it), it);
            }
          }
          const items = [...persistentHidden.values(), ...managedHiddenItems()];
          if (items.length === 0) return;
          await reapplyPersistent();
          emitChange();
          await hider.flush();
        })();
      });

      // Drop a removed model's resolved exception ids + its generic persistent
      // entries so they don't linger.
      offModelUnloaded = ctx.events.on('model:unloaded', ({ modelId }) => {
        exceptionIdsByModel.delete(modelId);
        for (const k of [...persistentHidden.keys()]) {
          if (k.startsWith(`${modelId}::`)) persistentHidden.delete(k);
        }
      });

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
        defaultShortcut: 'Alt+H',
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

      ctx.commands.register(
        'visibility.isolateAtPointer',
        (args: unknown) => isolateAtPointer(args),
        { title: 'Isolate element under cursor and frame' },
      );

      ctx.commands.register('visibility.getHidden', () => [...hiddenItemMap.values()], {
        title: 'Get hidden elements',
      });

      ctx.commands.register(
        'visibility.showItem',
        (args: unknown) => showItem(args),
        { title: 'Show specific hidden elements' },
      );

      ctx.commands.register('visibility.showAll', () => showAll(), {
        title: 'Show all elements',
        defaultShortcut: 'Shift+I',
      });

      ctx.commands.register(
        'visibility.setPersistentHidden',
        (args: unknown) => setPersistentHidden(args),
        { title: 'Set items that stay hidden through show-all' },
      );
      ctx.commands.register(
        'visibility.clearPersistentHidden',
        () => setPersistentHidden([]),
        { title: 'Clear the persistent-hidden set' },
      );

      // Type-based exception control (the toolbar spaces toggle calls this).
      ctx.commands.register(
        'visibility.setTypeVisible',
        (args: unknown) => setTypeVisible(args),
        { title: 'Show/hide all elements of a managed IFC type' },
      );
      ctx.commands.register(
        'visibility.getTypeVisible',
        (args: unknown) => {
          const type = typeof args === 'string' ? args : (args as { type?: string })?.type;
          if (typeof type !== 'string') return undefined;
          return !typeHidden.get(normalizeType(type));
        },
        { title: 'Get whether a managed IFC type is currently shown' },
      );
      ctx.commands.register('visibility.getManagedTypes', () => [...managedTypes], {
        title: 'List managed (exception) IFC types',
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

    async uninstall() {
      offModelLoaded?.();
      offModelLoaded = null;
      offModelUnloaded?.();
      offModelUnloaded = null;
      // Restore visibility synchronously-awaited so `disposeAll()` (which awaits
      // this) sequences it BEFORE `Viewer.unmount()` disposes the fragments
      // worker. Firing it fire-and-forget (the old `void showAll()`) let the
      // flush race the worker disposal — `ctx.fragments.update()` then hit a
      // torn-down worker ("handler is not a function") and `hider` could be
      // nulled mid-flight ("Cannot read properties of null (reading 'flush')").
      if (ctxRef && hider) {
        await showAll().catch(() => undefined);
      }
      hider = null;
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

// Pick-by-NDC arg shape — mirrors the selection plugin's dispatcher payload.
type PickArgs = { ndc?: { x: number; y: number } | null; x?: number; y?: number } | null | undefined;

function ndcOf(args: PickArgs): { x: number; y: number } | null {
  if (!args) return null;
  if (args.ndc) return args.ndc;
  if (typeof args.x === 'number' && typeof args.y === 'number') {
    return { x: args.x, y: args.y };
  }
  return null;
}

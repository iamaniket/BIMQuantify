'use client';

/**
 * Portal ⇄ viewer state bridge — echo-suppression contract
 * ========================================================
 *
 * Keeps two sources of truth in sync, in BOTH directions:
 *   - `useViewerEntityStore` (Zustand) — what the portal UI reads (tree rows,
 *     status bar, context menu).
 *   - the viewer plugins (selection / visibility / xray / …) — what the 3D
 *     canvas actually renders.
 *
 * Two sync paths run off this one hook:
 *
 *   1. viewer → store: the `handle.events.on(...)` listeners below. A user
 *      gesture in the canvas makes a plugin emit (e.g. `selection:change`);
 *      the listener mirrors it into the store via an `_applyViewer*` mutator.
 *
 *   2. store → viewer: the single `store.subscribe(...)` at the bottom. A
 *      portal UI mutation (e.g. clicking a tree row → `store.select(...)`)
 *      changes a store field; the subscriber dispatches the matching viewer
 *      command (e.g. `selection.set`).
 *
 * Left unguarded these form an infinite echo: viewer event → store update →
 * subscriber dispatches command → viewer re-emits the *same* event → store
 * update → … . `_syncDepth` (on the store) breaks the loop.
 *
 * THE CONTRACT
 * ------------
 *  - INVARIANT — the store subscriber dispatches commands ONLY while
 *    `_syncDepth === 0` (its first line is `if (state._syncDepth > 0) return;`).
 *    Any store change made while the counter is raised is read as "this came
 *    FROM the viewer — do not send it back".
 *
 *  - INCREMENT — every `_applyViewer*` mutator raises `_syncDepth` as part of
 *    the *same* atomic `set()` that writes the mirrored field (see
 *    `viewerEntityStore.ts`). Zustand notifies subscribers synchronously inside
 *    `set()`, so the subscriber is guaranteed to observe `_syncDepth > 0` for a
 *    viewer-originated change. The lone exception is the `selection:change`
 *    "cleared" branch, which raises the counter by hand right before calling the
 *    public `clearSelection()` (that mutator deliberately does NOT touch it).
 *
 *  - DECREMENT — each event listener lowers `_syncDepth` again inside a
 *    `queueMicrotask(...)`, exactly once per event, with `Math.max(0, …)` as an
 *    underflow guard (`_reset()` can zero the counter while a decrement is still
 *    queued).
 *
 * WHY `queueMicrotask`
 * --------------------
 * The decrement must land AFTER the subscriber has run for the viewer-driven
 * change (so it sees the raised counter and bails) but BEFORE the next genuine
 * UI mutation (so that one is NOT suppressed). A microtask hits exactly that
 * seam: it fires once the whole synchronous reaction to the event unwinds —
 * however many `set()` calls a single listener makes (the "cleared" branch makes
 * two) — and before any later task or user interaction. Decrementing
 * synchronously could disarm the guard partway through a multi-`set` listener;
 * deferring to a macrotask/timer would over-suppress real input arriving in the
 * meantime.
 *
 * Covered by `useViewerBridge.test.ts` — a viewer→store→viewer round-trip
 * dispatches each command exactly once (no echo). See review recommendation B3.
 */

import { useEffect } from 'react';

import type { ItemId, ViewerHandle } from '@bimdossier/viewer';

import {
  toEntityKey,
  parseEntityKey,
  useViewerEntityStore,
  type ViewerFeature,
} from '@/stores/viewerEntityStore';

function itemsToKeys(items: ItemId[]): string[] {
  return items.map((i) => toEntityKey(i.modelId, i.localId));
}

function keysToItems(keys: Iterable<string>): ItemId[] {
  const out: ItemId[] = [];
  for (const k of keys) {
    const parsed = parseEntityKey(k);
    if (parsed) out.push(parsed);
  }
  return out;
}

const FEATURE_TO_PLUGIN: Record<ViewerFeature, string> = {
  hover: 'hover',
  selection: 'selection',
  xray: 'xray',
  visibility: 'visibility',
};

const PLUGIN_TO_FEATURE: Record<string, ViewerFeature> = {
  'hover-highlight': 'hover',
  selection: 'selection',
  xray: 'xray',
  visibility: 'visibility',
};

export function useViewerBridge(handle: ViewerHandle | null, ready?: boolean): void {
  useEffect(() => {
    if (!handle) return undefined;

    const store = useViewerEntityStore;

    const existingModelId = handle.getModelId();
    if (existingModelId !== null) {
      store.getState()._setModelId(existingModelId);
    }

    const offModel = handle.events.on('model:loaded', ({ modelId }) => {
      store.getState()._setModelId(modelId);
    });

    const offElementCount = handle.events.on('model:elementCount', ({ count }) => {
      store.getState()._setTotalElements(count);
    });

    const offSelection = handle.events.on('selection:change', ({ selected, allSelected }) => {
      if (allSelected) {
        // O(1) regardless of model size — no key conversion, no Set build.
        store.getState()._applyViewerSelection([], true);
      } else if (selected.length === 0) {
        store.setState((s) => ({ _syncDepth: s._syncDepth + 1 }));
        store.getState().clearSelection();
      } else {
        store.getState()._applyViewerSelection(itemsToKeys(selected), false);
      }
      queueMicrotask(() => {
        store.setState((s) => ({ _syncDepth: Math.max(0, s._syncDepth - 1) }));
      });
    });

    const offVisibility = handle.events.on(
      'visibility:change',
      ({ hidden, isolated, isolationActive }) => {
        store.getState()._applyViewerVisibility(
          itemsToKeys(hidden),
          itemsToKeys(isolated),
          isolationActive,
        );
        queueMicrotask(() => {
          store.setState((s) => ({ _syncDepth: Math.max(0, s._syncDepth - 1) }));
        });
      },
    );

    const offXray = handle.events.on('xray:change', ({ xrayed, opacityOverrides }) => {
      store.getState()._applyViewerXray(itemsToKeys(xrayed));
      if (opacityOverrides) {
        const entries: [string, number][] = opacityOverrides.map((o) => [
          toEntityKey(o.item.modelId, o.item.localId),
          o.opacity,
        ]);
        store.getState()._applyViewerOpacity(entries);
      }
      queueMicrotask(() => {
        store.setState((s) => ({ _syncDepth: Math.max(0, s._syncDepth - 1) }));
      });
    });

    // Plugins emit `feature:enabled` only on genuine user toggles (the settings
    // UI). Transient suppression — e.g. interactive-performance pausing hover
    // during camera orbit — goes through `setPaused` and stays silent, so this
    // mirror tracks the user's intent and never flickers mid-orbit.
    const offFeature = handle.events.on('feature:enabled', ({ name, enabled }) => {
      const feature = PLUGIN_TO_FEATURE[name];
      if (!feature) return;
      store.getState()._applyViewerFeatureEnabled(feature, enabled);
      queueMicrotask(() => {
        store.setState((s) => ({ _syncDepth: Math.max(0, s._syncDepth - 1) }));
      });
    });

    const unsub = store.subscribe((state, prev) => {
      if (state._syncDepth > 0) return;

      if (state.selected !== prev.selected || state.selectedAll !== prev.selectedAll) {
        if (state.selectedAll) {
          void handle.commands.execute('selection.selectAll');
        } else {
          const items = keysToItems(state.selected);
          void handle.commands.execute('selection.set', items);
        }
      }

      if (state.hidden !== prev.hidden || state.isolated !== prev.isolated || state.isolationActive !== prev.isolationActive) {
        if (!state.isolationActive && !state.hidden.size) {
          void handle.commands.execute('visibility.showAll');
        } else if (state.isolationActive && state.isolated !== prev.isolated) {
          void handle.commands.execute('visibility.isolateItem', keysToItems(state.isolated));
        } else if (state.hidden !== prev.hidden) {
          const added = [...state.hidden].filter((k) => !prev.hidden.has(k));
          const removed = [...prev.hidden].filter((k) => !state.hidden.has(k));
          if (added.length > 0) {
            void handle.commands.execute('visibility.hideItem', keysToItems(new Set(added)));
          }
          if (removed.length > 0) {
            void handle.commands.execute('visibility.showItem', keysToItems(new Set(removed)));
          }
        }
      }

      if (state.xrayed !== prev.xrayed) {
        if (state.xrayed.size === 0) {
          void handle.commands.execute('xray.clear');
        } else {
          const added = [...state.xrayed].filter((k) => !prev.xrayed.has(k));
          const removed = [...prev.xrayed].filter((k) => !state.xrayed.has(k));
          if (removed.length > 0) {
            void handle.commands.execute('xray.remove', keysToItems(new Set(removed)));
          }
          if (added.length > 0) {
            void handle.commands.execute('xray.set', keysToItems(new Set(added)));
          }
        }
      }

      if (state.opacityOverrides !== prev.opacityOverrides) {
        const added: [string, number][] = [];
        const removed: string[] = [];
        for (const [k, o] of state.opacityOverrides) {
          if (prev.opacityOverrides.get(k) !== o) added.push([k, o]);
        }
        for (const k of prev.opacityOverrides.keys()) {
          if (!state.opacityOverrides.has(k)) removed.push(k);
        }
        if (added.length > 0) {
          const byOpacity = new Map<number, string[]>();
          for (const [k, o] of added) {
            let arr = byOpacity.get(o);
            if (!arr) { arr = []; byOpacity.set(o, arr); }
            arr.push(k);
          }
          for (const [opacity, keys] of byOpacity) {
            void handle.commands.execute('xray.setItemOpacity', {
              items: keysToItems(new Set(keys)),
              opacity,
            });
          }
        }
        if (removed.length > 0) {
          void handle.commands.execute('xray.resetItemOpacity', keysToItems(new Set(removed)));
        }
      }

      if (state.enabled !== prev.enabled) {
        for (const key of Object.keys(state.enabled) as ViewerFeature[]) {
          if (state.enabled[key] !== prev.enabled[key]) {
            const plugin = FEATURE_TO_PLUGIN[key];
            void handle.commands.execute(`${plugin}.setEnabled`, state.enabled[key]);
          }
        }
      }

      if (state._frameRequested !== prev._frameRequested) {
        void handle.commands.execute('camera.frameSelection');
      }
    });

    return () => {
      offModel();
      offElementCount();
      offSelection();
      offVisibility();
      offXray();
      offFeature();
      unsub();
      store.getState()._reset();
    };
    // `ready` triggers re-subscription after viewer rebuild (events.clear)
  }, [handle, ready]);
}

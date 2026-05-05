'use client';

import { useEffect } from 'react';

import type { ItemId, ViewerHandle } from '@bimstitch/viewer';

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

export function useViewerBridge(handle: ViewerHandle | null): void {
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

    const offSelection = handle.events.on('selection:change', ({ selected }) => {
      store.getState()._applyViewerSelection(itemsToKeys(selected));
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

    const offXray = handle.events.on('xray:change', ({ xrayed }) => {
      store.getState()._applyViewerXray(itemsToKeys(xrayed));
      queueMicrotask(() => {
        store.setState((s) => ({ _syncDepth: Math.max(0, s._syncDepth - 1) }));
      });
    });

    // Plugins emit `feature:enabled` whenever they toggle (e.g. the
    // interactive-performance plugin pauses hover during camera orbit).
    // Mirror that into the store so the UI stays accurate.
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

      if (state.selected !== prev.selected) {
        const items = keysToItems(state.selected);
        void handle.commands.execute('selection.set', items);
      }

      if (state.hidden !== prev.hidden || state.isolated !== prev.isolated || state.isolationActive !== prev.isolationActive) {
        if (!state.isolationActive && !state.hidden.size) {
          void handle.commands.execute('visibility.showAll');
        } else if (state.isolationActive && state.isolated !== prev.isolated) {
          void handle.commands.execute('visibility.isolateItem', keysToItems(state.isolated));
        } else if (state.hidden !== prev.hidden) {
          const added = [...state.hidden].filter((k) => !prev.hidden.has(k));
          if (added.length > 0) {
            void handle.commands.execute('visibility.hideItem', keysToItems(new Set(added)));
          }
        }
      }

      if (state.xrayed !== prev.xrayed) {
        if (state.xrayed.size === 0) {
          void handle.commands.execute('xray.clear');
        } else {
          void handle.commands.execute('xray.set', keysToItems(state.xrayed));
        }
      }

      // Forward feature toggle changes to the relevant plugins.
      if (state.enabled !== prev.enabled) {
        for (const key of Object.keys(state.enabled) as ViewerFeature[]) {
          if (state.enabled[key] !== prev.enabled[key]) {
            const plugin = FEATURE_TO_PLUGIN[key];
            void handle.commands.execute(`${plugin}.setEnabled`, state.enabled[key]);
          }
        }
      }
    });

    return () => {
      offModel();
      offSelection();
      offVisibility();
      offXray();
      offFeature();
      unsub();
      store.getState()._reset();
    };
  }, [handle]);
}

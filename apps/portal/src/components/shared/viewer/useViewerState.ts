'use client';

import { useEffect, useState } from 'react';

import type { ViewerHandle } from '@bimstitch/viewer';

export type ViewerState = {
  selectionCount: number;
  hasHidden: boolean;
  hasXray: boolean;
  isIsolated: boolean;
};

const INITIAL: ViewerState = {
  selectionCount: 0,
  hasHidden: false,
  hasXray: false,
  isIsolated: false,
};

export function useViewerState(handle: ViewerHandle | null): ViewerState {
  const [state, setState] = useState<ViewerState>(INITIAL);

  useEffect(() => {
    if (!handle) return undefined;

    const offSelection = handle.events.on('selection:change', (ev) => {
      // When `allSelected` is true the viewer event omits the enumerated
      // list; the truthy count below is enough for callers that only
      // check `selectionCount > 0` (e.g. context-menu enablement).
      // Callers needing the actual number must consult `totalElements`
      // from model metadata.
      setState((prev) => ({
        ...prev,
        selectionCount: ev.allSelected ? Number.MAX_SAFE_INTEGER : ev.selected.length,
      }));
    });

    const offVisibility = handle.events.on('visibility:change', (ev) => {
      setState((prev) => ({
        ...prev,
        hasHidden: ev.hidden.length > 0,
        isIsolated: ev.isolationActive,
      }));
    });

    const offXray = handle.events.on('xray:change', (ev) => {
      setState((prev) => ({ ...prev, hasXray: ev.xrayed.length > 0 }));
    });

    return () => {
      offSelection();
      offVisibility();
      offXray();
      setState(INITIAL);
    };
  }, [handle]);

  return state;
}

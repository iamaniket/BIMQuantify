'use client';

import { useEffect } from 'react';

import type { ViewerHandle } from '@bimstitch/viewer';

/**
 * Drives the visibility plugin's IfcSpace exception from the spaces toggle.
 *
 * The viewer owns space resolution now: the visibility plugin self-identifies
 * IfcSpace elements per model (`getItemsOfCategories`), auto-hides them at load,
 * and keeps them hidden through bulk show/hide. Here we only push the desired
 * on/off state via `visibility.setTypeVisible` whenever the toggle changes or the
 * viewer (re)mounts — late-loading / federated models are handled inside the
 * plugin, so no per-model metadata fetch is needed.
 */
export function useSpaceVisibility(
  handle: ViewerHandle | null,
  viewerReady: boolean | undefined,
  showSpaces: boolean,
): void {
  useEffect(() => {
    if (!handle || !viewerReady) return;
    handle.commands
      .execute('visibility.setTypeVisible', { type: 'IfcSpace', visible: showSpaces })
      .catch(() => undefined);
  }, [handle, viewerReady, showSpaces]);
}

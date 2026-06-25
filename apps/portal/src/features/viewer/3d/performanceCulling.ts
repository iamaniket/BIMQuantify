'use client';

import { useEffect } from 'react';

import type { CullingMode, ViewerHandle } from '@bimdossier/viewer';

/**
 * Drives the viewer's native frustum-culling policy from the settings control.
 *
 * The viewer owns the heavy lifting (resolving + applying the per-model
 * `LodMode`, plus temporarily un-culling for the contact-shadow bake). Here we
 * only push the desired policy via `performance.setCulling` whenever the setting
 * changes or the viewer (re)mounts. `setCullingMode` is idempotent per resolved
 * mode, so re-pushing the same value is a cheap no-op.
 */
export function usePerformanceCulling(
  handle: ViewerHandle | null,
  viewerReady: boolean | undefined,
  culling: CullingMode,
): void {
  useEffect(() => {
    if (!handle || !viewerReady) return;
    handle.commands
      .execute('performance.setCulling', { mode: culling })
      .catch(() => undefined);
  }, [handle, viewerReady, culling]);
}

'use client';

import { useEffect } from 'react';

import type { DisplayMode, ViewerHandle } from '@bimdossier/viewer';

/**
 * Re-applies the persisted viewer look (monochrome / clay / matcap) when the
 * viewer (re)mounts, so a page reload keeps the chosen look.
 *
 * The `display-mode` plugin owns the live single-mode state and the toolbar
 * drives it directly; this hook only handles the load/remount path. X-ray is
 * session-only — we never auto-ghost the whole model on load — so it (and
 * `normal`, the default) are skipped. `display.set` is a no-op when the viewer
 * is already in that mode.
 */
export function useDisplayMode(
  handle: ViewerHandle | null,
  viewerReady: boolean | undefined,
  mode: DisplayMode,
): void {
  useEffect(() => {
    if (!handle || !viewerReady) return;
    if (mode === 'normal' || mode === 'xray') return;
    handle.commands.execute('display.set', mode).catch(() => undefined);
  }, [handle, viewerReady, mode]);
}

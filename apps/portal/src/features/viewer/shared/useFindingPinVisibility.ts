'use client';

import { useEffect } from 'react';

import type { DocumentViewerHandle, ViewerHandle } from '@bimstitch/viewer';

/**
 * Drives the finding-pin layer's global visibility from a persisted setting,
 * mirroring {@link useSpaceVisibility}. The persisted flag is the source of
 * truth: we re-assert it onto the entity-marker plugin whenever the viewer
 * (re)mounts or the flag changes.
 *
 * The plugin's `sync()` re-applies its stored `globalVisible` to every marker
 * group, so a later finding re-sync keeps the chosen state — we only need to
 * push the value once per (handle, ready, visible) change. A fresh mount resets
 * the plugin's `globalVisible` to `true`, which the `viewerReady` dependency
 * re-corrects.
 */
export function useFindingPinVisibility(
  viewerHandle: ViewerHandle | null,
  documentHandle: DocumentViewerHandle | null,
  viewerReady: boolean | undefined,
  isIfc: boolean,
  isPdf: boolean,
  visible: boolean,
): void {
  // 3D finding pins (entity-marker plugin).
  useEffect(() => {
    if (!isIfc || !viewerHandle || !viewerReady) return;
    viewerHandle.commands
      .execute('entity-marker.setVisible', { visible })
      .catch(() => undefined);
  }, [isIfc, viewerHandle, viewerReady, visible]);

  // 2D finding pins (entity-marker-2d plugin). The document handle is only
  // present once the PDF viewer mounts, so key off the handle itself.
  useEffect(() => {
    if (!isPdf || !documentHandle) return;
    documentHandle.commands
      .execute('entity-marker-2d.setVisible', { visible })
      .catch(() => undefined);
  }, [isPdf, documentHandle, visible]);
}

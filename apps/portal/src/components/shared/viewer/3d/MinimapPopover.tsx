'use client';

import { useEffect, type JSX } from 'react';

import type { ViewerHandle } from '@bimstitch/viewer';

import { MinimapView } from '@/features/viewer/3d/minimap/MinimapView';
import type { ModelMetadata } from '@/lib/api/viewerTypes';

type Props = {
  handle: ViewerHandle | null;
  viewerReady: boolean;
  floorPlansUrl: string | null;
  metadata: ModelMetadata | undefined;
  /** Architectural model id in a federated view; omit for the single-file viewer. */
  planModelId?: string;
  onClose: () => void;
};

/**
 * Toolbar minimap pop-out — the floor-plan locator that floats above its toolbar
 * button. Mounts on open (and unmounts on close), so the minimap plugin
 * calibrates + seeds the "you are here" marker the moment it appears. Positioned
 * relative to the button's wrapper (`relative`), so it anchors to the button
 * with no pixel math. Closes on Esc — no outside-click dismissal, matching the
 * fly-nav / display-mode popovers.
 */
export function MinimapPopover({
  handle,
  viewerReady,
  floorPlansUrl,
  metadata,
  planModelId,
  onClose,
}: Props): JSX.Element {
  useEffect(() => {
    const onEsc = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('keydown', onEsc); };
  }, [onClose]);

  return (
    <div
      role="dialog"
      data-testid="viewer-minimap-popover"
      className="absolute bottom-[calc(100%+0.75rem)] left-1/2 z-50 -translate-x-1/2"
    >
      <MinimapView
        handle={handle}
        viewerReady={viewerReady}
        floorPlansUrl={floorPlansUrl}
        metadata={metadata}
        {...(planModelId ? { planModelId } : {})}
        variant="popover"
      />
    </div>
  );
}

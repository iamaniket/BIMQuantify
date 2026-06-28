'use client';

import { useTranslations } from 'next-intl';
import { type JSX } from 'react';

import { ModelLoadingOverlay } from '@/components/shared/viewer/shared/ModelLoadingOverlay';

export type ViewerLoadingOverlayProps = {
  progress: { loaded: number; total: number } | null;
  overlayFading: boolean;
  isIfc: boolean;
  viewerReady: boolean;
  viewerBusy: boolean;
  /** Translation accessor for the `viewer.loadingOverlay` namespace. */
  tLoad: ReturnType<typeof useTranslations>;
}

export function ViewerLoadingOverlay({
  progress,
  overlayFading,
  isIfc,
  viewerReady,
  viewerBusy,
  tLoad,
}: ViewerLoadingOverlayProps): JSX.Element {
  const overlayDeterminate = progress !== null && progress.total > 0;
  // "Updating view…" only for a later federated add/remove/unload
  // (viewer already ready, busy again). Initial load + PDFs keep
  // "Loading model…".
  const isSubsequentLoad = isIfc && viewerReady && viewerBusy;
  return (
    <ModelLoadingOverlay
      indeterminate={!overlayDeterminate}
      progress={overlayDeterminate ? (progress.loaded / progress.total) * 100 : (overlayFading ? 100 : 0)}
      fading={overlayFading}
      label={tLoad(isSubsequentLoad ? 'updating' : 'model')}
    />
  );
}

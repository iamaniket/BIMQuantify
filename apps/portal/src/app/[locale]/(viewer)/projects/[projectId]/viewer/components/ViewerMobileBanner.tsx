'use client';

import { type JSX } from 'react';

export interface ViewerMobileBannerProps {
  onDismiss: () => void;
}

export function ViewerMobileBanner({ onDismiss }: ViewerMobileBannerProps): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-body3 text-foreground md:hidden">
      <span>3D viewer works best on a larger screen.</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="shrink-0 rounded px-2 py-0.5 text-caption font-semibold hover:bg-warning/20"
      >
        OK
      </button>
    </div>
  );
}

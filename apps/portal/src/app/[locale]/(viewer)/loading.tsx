import type { JSX } from 'react';

import { Skeleton } from '@bimstitch/ui';

/**
 * Shown instantly by Next.js during the route transition from dashboard → viewer.
 * Mirrors the viewer chrome (header, canvas area, status bar) so the layout
 * swap doesn't feel like a jarring "jump".
 */
export default function ViewerLoading(): JSX.Element {
  return (
    <main className="flex min-h-0 w-full flex-1 flex-col animate-viewer-fade-in">
      {/* Header skeleton — matches ViewerHeader's 60px height + primary bg */}
      <div className="flex h-[60px] shrink-0 items-center gap-4 bg-primary px-4">
        <Skeleton className="h-8 w-8 rounded-md bg-white/10" />
        <Skeleton className="h-4 w-48 rounded bg-white/10" />
      </div>

      {/* Canvas area skeleton */}
      <div className="relative min-h-0 flex-1 bg-background">
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-border border-t-primary" />
          <span className="text-body3 text-foreground-secondary">
            Preparing viewer…
          </span>
        </div>
      </div>

      {/* Status bar skeleton — matches ViewerStatusBar's 22px height */}
      <div className="flex h-[22px] shrink-0 items-center border-t border-border bg-background/95 px-3">
        <Skeleton className="h-2.5 w-64 rounded bg-foreground/5" />
      </div>
    </main>
  );
}

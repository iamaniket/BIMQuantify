'use client';

import type { JSX } from 'react';

import { Skeleton, Spinner } from '@bimdossier/ui';

/**
 * Shown instantly by Next.js during the route transition from dashboard → viewer.
 * Mirrors the viewer chrome (toolbar strip, side rail, status bar) so the swap
 * into the mounted viewer page is visually seamless.
 */
export default function ViewerLoading(): JSX.Element {
  return (
    <main className="flex min-h-0 w-full flex-1 animate-viewer-fade-in">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Canvas area with chrome placeholders */}
      <div className="relative min-h-0 flex-1 bg-background">
        {/* Canvas skeleton */}
        <Skeleton className="absolute inset-0" />

        {/* Toolbar placeholder (matches showToolbarPlaceholder strip in the viewer page) */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-12 border-b border-border bg-background/95 backdrop-blur-sm"
        />

        {/* Centered "Preparing viewer…" spinner */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4">
          <Spinner size="lg" className="text-primary" />
          <span className="text-body3 text-foreground-secondary">
            Preparing viewer…
          </span>
        </div>
      </div>

      {/* Status bar skeleton — matches StatusBar's 22px height */}
      <div className="flex h-[22px] shrink-0 items-center border-t border-border bg-background/95 px-3">
        <Skeleton className="h-2.5 w-64 rounded bg-foreground/5" />
      </div>
      </div>

      {/* Side rail placeholder — matches w-[51px] right-aligned rail */}
      <div
        aria-hidden
        className="w-[51px] shrink-0 border-l border-sidebar-border"
        style={{
          background: 'linear-gradient(180deg, var(--brand-gradient-start) 0%, var(--brand-gradient-end) 100%)',
        }}
      />
    </main>
  );
}

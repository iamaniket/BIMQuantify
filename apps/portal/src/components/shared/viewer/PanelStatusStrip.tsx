'use client';

import type { JSX, ReactNode } from 'react';

import { cn } from '@bimstitch/ui';

type PanelStatusStripProps = {
  /** Drives the status-dot colour: `active` = green/live, `idle` = grey. */
  tone?: 'active' | 'idle';
  /** Hide the leading status dot entirely. */
  showDot?: boolean;
  /** Left/primary status content. */
  children: ReactNode;
  /** Right-aligned, de-emphasised metadata (e.g. counts, scope). */
  right?: ReactNode;
  className?: string;
};

/**
 * Shared side-panel footer status strip: a thin bottom bar with a coloured
 * status dot, primary status text, and optional right-aligned metadata.
 * Replaces the bespoke per-panel footers so every viewer panel reads alike.
 */
export function PanelStatusStrip({
  tone = 'active',
  showDot = true,
  children,
  right,
  className,
}: PanelStatusStripProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex min-h-7 shrink-0 items-center gap-2 border-t border-border bg-surface-low px-3 py-1 text-caption text-foreground-tertiary',
        className,
      )}
    >
      {showDot && (
        <span
          className={cn(
            'h-[7px] w-[7px] shrink-0 rounded-full',
            tone === 'active'
              ? 'bg-success ring-2 ring-success/20'
              : 'bg-foreground-tertiary ring-2 ring-foreground-tertiary/20',
          )}
        />
      )}
      <span className="flex min-w-0 items-center gap-1 truncate">{children}</span>
      {right !== undefined && (
        <span className="ml-auto shrink-0 tabular-nums text-foreground-tertiary/80">{right}</span>
      )}
    </div>
  );
}

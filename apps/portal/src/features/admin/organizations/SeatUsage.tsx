'use client';

import type { JSX } from 'react';

import { cn } from '@bimstitch/ui';

type Props = {
  seatCountUsed: number;
  seatLimit: number | null;
  className?: string;
};

/**
 * "3 / 10" style badge with red tint when full. `seat_limit === null` is
 * unlimited and renders with an infinity glyph so the user knows it's a
 * deliberate state, not a missing value.
 */
export function SeatUsage({ seatCountUsed, seatLimit, className }: Props): JSX.Element {
  const unlimited = seatLimit === null;
  const isFull = seatLimit !== null && seatCountUsed >= seatLimit;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-caption font-medium tabular-nums',
        isFull
          ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
          : 'bg-background-hover text-foreground-secondary',
        className,
      )}
    >
      <span>{seatCountUsed}</span>
      <span aria-hidden>/</span>
      <span>{unlimited ? '∞' : seatLimit}</span>
    </span>
  );
}

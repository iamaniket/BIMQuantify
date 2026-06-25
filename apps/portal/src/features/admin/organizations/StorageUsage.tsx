'use client';

import type { JSX } from 'react';

import { cn } from '@bimdossier/ui';

type Props = {
  usedGb: number;
  limitGb: number | null;
  className?: string;
};

export function StorageUsage({ usedGb, limitGb, className }: Props): JSX.Element {
  const unlimited = limitGb === null;
  const isFull = limitGb !== null && usedGb >= limitGb;
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
      <span>{usedGb}</span>
      <span aria-hidden>/</span>
      <span>{unlimited ? '∞' : limitGb}</span>
      <span className="text-foreground-tertiary">GB</span>
    </span>
  );
}

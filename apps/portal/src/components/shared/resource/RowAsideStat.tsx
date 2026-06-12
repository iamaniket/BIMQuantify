'use client';

import type { ComponentType, JSX, ReactNode } from 'react';

/**
 * Compact right-aligned icon+value stat for a `DetailCardRow` aside slot.
 * The leading icon replaces a text label to save space; omit `value` for a
 * pure icon indicator (e.g. "linked"), in which case `title` carries the meaning.
 */
type Props = {
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  value?: ReactNode;
  /** Tooltip — used as the accessible meaning, required when `value` is omitted. */
  title?: string;
};

export function RowAsideStat({ icon: Icon, value, title }: Props): JSX.Element {
  return (
    <span className="flex items-center gap-1" title={title}>
      <Icon className="h-3.5 w-3.5 shrink-0 text-foreground-tertiary" aria-hidden />
      {value !== undefined && (
        <span className="font-sans text-[11px] text-foreground-secondary tabular-nums">
          {value}
        </span>
      )}
    </span>
  );
}

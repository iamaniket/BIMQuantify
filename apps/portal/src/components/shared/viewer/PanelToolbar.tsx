'use client';

import type { JSX, ReactNode } from 'react';

import { cn } from '@bimstitch/ui';

type PanelToolbarProps = {
  /** Toolbar rows — typically a search row followed by an action button row. */
  children: ReactNode;
  className?: string;
};

/**
 * Shared side-panel toolbar shell: the bordered region directly under a panel
 * header / tabs that stacks a search row and action button rows with
 * consistent padding and spacing. Pairs with {@link PanelButtonRow}.
 */
export function PanelToolbar({ children, className }: PanelToolbarProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex shrink-0 flex-col gap-2 border-b border-border bg-surface-main px-3.5 py-2.5',
        className,
      )}
    >
      {children}
    </div>
  );
}

type PanelButtonRowProps = {
  children: ReactNode;
  className?: string;
};

/** A horizontal row of panel buttons with the standard inter-button gap. */
export function PanelButtonRow({ children, className }: PanelButtonRowProps): JSX.Element {
  return <div className={cn('flex gap-1.5', className)}>{children}</div>;
}

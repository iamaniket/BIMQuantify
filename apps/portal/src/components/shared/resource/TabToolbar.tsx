'use client';

import { Search } from '@bimstitch/ui/icons';
import type { JSX, ReactNode } from 'react';

/**
 * The shared toolbar for the project-detail resource tabs (Models, Attachments,
 * Findings, Certificates). Every tab renders the same `search + optional filter
 * + actions` row so the four tabs read identically. Store-agnostic: search state
 * and the filter/action controls flow in via props.
 */
type Props = {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  /** Optional filter control (typically a `<Select>`), rendered after search. */
  filter?: ReactNode;
  /** Primary action(s): a `Button` / `SplitButton`, plus any secondary action. */
  actions?: ReactNode;
};

export function TabToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  filter,
  actions,
}: Props): JSX.Element {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
      <div className="relative min-w-0">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-tertiary" />
        <input
          type="text"
          value={searchValue}
          onChange={(e) => { onSearchChange(e.target.value); }}
          placeholder={searchPlaceholder}
          className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-body3 text-foreground placeholder:text-foreground-disabled focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      {filter}
      {actions}
    </div>
  );
}

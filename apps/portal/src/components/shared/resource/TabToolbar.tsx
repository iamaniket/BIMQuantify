'use client';

import { Search } from '@bimstitch/ui/icons';
import type { JSX, ReactNode } from 'react';

import { Input } from '@bimstitch/ui';

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
      <Input
        inputSize="md"
        type="text"
        value={searchValue}
        onChange={(e) => { onSearchChange(e.target.value); }}
        placeholder={searchPlaceholder}
        leading={<Search className="h-3.5 w-3.5" />}
      />
      {filter}
      {actions}
    </div>
  );
}

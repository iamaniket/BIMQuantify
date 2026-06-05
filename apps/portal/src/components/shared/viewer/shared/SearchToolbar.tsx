'use client';

import { ChevronDown, ChevronUp, Search, X } from '@bimstitch/ui/icons';
import { type JSX, type ReactNode } from 'react';

import { IconButton, Input } from '@bimstitch/ui';

export type SearchToolbarProps = {
  query: string;
  onQueryChange: (q: string) => void;
  placeholder: string;
  clearLabel: string;
  isAllExpanded: boolean;
  onToggleExpand: () => void;
  expandLabel: string;
  collapseLabel: string;
  /** Extra trailing controls (e.g. check-all / select-all), rendered after the expand toggle. */
  children?: ReactNode;
};

/**
 * Shared viewer panel toolbar: a filter `Input` with a clear button plus an
 * expand/collapse-all toggle. The Tree and Properties panels share this shell;
 * the Tree panel passes its check-all / select-all buttons as `children`.
 */
export function SearchToolbar({
  query,
  onQueryChange,
  placeholder,
  clearLabel,
  isAllExpanded,
  onToggleExpand,
  expandLabel,
  collapseLabel,
  children,
}: SearchToolbarProps): JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-surface-low px-2 py-1.5">
      <div className="flex-1">
        <Input
          inputSize="sm"
          value={query}
          onChange={(e) => { onQueryChange(e.target.value); }}
          placeholder={placeholder}
          leading={<Search className="h-3.5 w-3.5" />}
          trailing={query.length > 0 ? (
            <IconButton
              size="sm"
              aria-label={clearLabel}
              onClick={() => { onQueryChange(''); }}
            >
              <X className="h-3 w-3" />
            </IconButton>
          ) : undefined}
        />
      </div>

      <IconButton
        aria-label={isAllExpanded ? collapseLabel : expandLabel}
        title={isAllExpanded ? collapseLabel : expandLabel}
        onClick={onToggleExpand}
      >
        {isAllExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </IconButton>

      {children}
    </div>
  );
}

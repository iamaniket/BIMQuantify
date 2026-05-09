'use client';

import type { JSX } from 'react';

import { cn } from '@bimstitch/ui';

type Props = {
  numPages: number | null;
  currentPage: number;
  onSelect: (page: number) => void;
};

export function PagesPanel({ numPages, currentPage, onSelect }: Props): JSX.Element {
  if (numPages === null) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-body3 text-foreground-secondary">Loading pages…</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-0.5 p-2">
      {Array.from({ length: numPages }, (_, i) => i + 1).map((page) => {
        const isActive = page === currentPage;
        return (
          <li key={page}>
            <button
              type="button"
              onClick={() => onSelect(page)}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-body3 transition-colors',
                isActive
                  ? 'border-primary-light bg-primary-lighter text-primary'
                  : 'border-transparent text-foreground hover:border-border hover:bg-background-secondary',
              )}
            >
              <span>Page {page}</span>
              {isActive ? (
                <span className="text-caption font-medium uppercase tracking-wide text-primary">
                  current
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

'use client';

import { Skeleton } from '@bimstitch/ui';
import type { JSX, ReactNode } from 'react';

/**
 * Owns the three list states the resource tabs used to diverge on:
 *  - loading   → three skeleton rows
 *  - empty     → the caller-supplied `empty` node (an `EmptyState`)
 *  - no-results→ a centered message when a search filtered everything out
 * Otherwise wraps the rows in the shared bordered list container. Keeping all of
 * this in one place is what makes the four tabs behave identically.
 */
type Props = {
  isLoading: boolean;
  /** Unfiltered item count — drives the empty state. */
  total: number;
  /** Item count after the active search — drives the no-results state. */
  filteredCount: number;
  /** Whether a search query is currently narrowing the list. */
  searchActive: boolean;
  /** Rendered when `total === 0`. Pass `null` to suppress (e.g. while uploading). */
  empty: ReactNode;
  noResultsLabel: string;
  children: ReactNode;
};

export function ResourceList({
  isLoading,
  total,
  filteredCount,
  searchActive,
  empty,
  noResultsLabel,
  children,
}: Props): JSX.Element {
  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (total === 0) {
    return <>{empty}</>;
  }

  if (filteredCount === 0 && searchActive) {
    return (
      <p className="py-6 text-center text-body3 text-foreground-tertiary">
        {noResultsLabel}
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      {children}
    </div>
  );
}

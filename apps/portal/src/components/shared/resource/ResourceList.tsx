'use client';

import { Skeleton } from '@bimstitch/ui';
import type { JSX, ReactNode } from 'react';

import { LoadMoreButton } from './LoadMoreButton';

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
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
};

export function ResourceList({
  isLoading,
  total,
  filteredCount,
  searchActive,
  empty,
  noResultsLabel,
  children,
  hasNextPage = false,
  isFetchingNextPage = false,
  onLoadMore,
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
    <div>
      <div className="overflow-hidden rounded-lg border border-border bg-background">
        {children}
      </div>
      {onLoadMore !== undefined && (
        <LoadMoreButton
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          fetchNextPage={onLoadMore}
        />
      )}
    </div>
  );
}

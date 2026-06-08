'use client';

import type { JSX } from 'react';
import { useTranslations } from 'next-intl';

type Props = {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
};

export function LoadMoreButton({
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: Props): JSX.Element | null {
  const t = useTranslations('common');

  if (!hasNextPage) return null;

  return (
    <button
      type="button"
      disabled={isFetchingNextPage}
      onClick={fetchNextPage}
      className="mt-2 w-full rounded-md bg-surface-high py-1.5 text-body3 font-medium text-foreground-secondary transition-colors hover:bg-surface-main hover:text-foreground disabled:opacity-60"
    >
      {isFetchingNextPage ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          {t('loadMore')}
        </span>
      ) : (
        t('loadMore')
      )}
    </button>
  );
}

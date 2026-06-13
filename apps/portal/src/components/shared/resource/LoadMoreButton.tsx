'use client';

import type { JSX } from 'react';
import { useTranslations } from 'next-intl';

import { Button, Spinner } from '@bimstitch/ui';

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
    <Button
      type="button"
      variant="secondary"
      size="md"
      disabled={isFetchingNextPage}
      onClick={fetchNextPage}
      className="mt-2 w-full"
    >
      {isFetchingNextPage ? <Spinner size="sm" /> : null}
      {t('loadMore')}
    </Button>
  );
}

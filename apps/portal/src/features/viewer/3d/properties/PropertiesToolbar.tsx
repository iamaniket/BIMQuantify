'use client';

import { type JSX } from 'react';
import { useTranslations } from 'next-intl';

import { SearchToolbar } from '@/components/shared/viewer/shared/SearchToolbar';

type PropertiesToolbarProps = {
  query: string;
  onQueryChange: (q: string) => void;
  isAllExpanded: boolean;
  onToggleExpand: () => void;
};

export function PropertiesToolbar({
  query,
  onQueryChange,
  isAllExpanded,
  onToggleExpand,
}: PropertiesToolbarProps): JSX.Element {
  const t = useTranslations('viewer.properties');

  return (
    <SearchToolbar
      query={query}
      onQueryChange={onQueryChange}
      placeholder={t('filter')}
      clearLabel={t('clear')}
      isAllExpanded={isAllExpanded}
      onToggleExpand={onToggleExpand}
      expandLabel={t('expandAll')}
      collapseLabel={t('collapseAll')}
    />
  );
}

'use client';

import { type JSX } from 'react';
import { useTranslations } from 'next-intl';

import { IconButton } from '@bimstitch/ui';

import { SearchToolbar } from '@/components/shared/viewer/SearchToolbar';

type TreeToolbarProps = {
  query: string;
  onQueryChange: (q: string) => void;
  isAllExpanded: boolean;
  onToggleExpand: () => void;
  allChecked: boolean;
  onToggleCheckAll: () => void;
  allSelected: boolean;
  onToggleSelectAll: () => void;
};

export function TreeToolbar({
  query,
  onQueryChange,
  isAllExpanded,
  onToggleExpand,
  allChecked,
  onToggleCheckAll,
  allSelected,
  onToggleSelectAll,
}: TreeToolbarProps): JSX.Element {
  const t = useTranslations('viewer.explorer');

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
    >
      <div className="h-4 w-px bg-border" />

      <IconButton
        active={allChecked}
        title={allChecked ? t('uncheckAll') : t('checkAll')}
        aria-label={allChecked ? t('uncheckAll') : t('checkAll')}
        onClick={onToggleCheckAll}
      >
        {allChecked ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="currentColor" />
            <polyline points="4.5,8.5 7,11 11.5,5" stroke="#fff" strokeWidth="1.8" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
          </svg>
        )}
      </IconButton>

      <div className="h-4 w-px bg-border" />

      <IconButton
        active={allSelected}
        title={allSelected ? t('deselectAll') : t('selectAll')}
        aria-label={allSelected ? t('deselectAll') : t('selectAll')}
        onClick={onToggleSelectAll}
      >
        {allSelected ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1.5" y="1.5" width="13" height="13" rx="2" stroke="currentColor" fill="currentColor" opacity="0.15" />
            <rect x="1.5" y="1.5" width="13" height="13" rx="2" stroke="currentColor" fill="none" />
            <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1.5" y="1.5" width="13" height="13" rx="2" stroke="currentColor" />
            <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" opacity="0.3" />
          </svg>
        )}
      </IconButton>
    </SearchToolbar>
  );
}

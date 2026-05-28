'use client';

import { Search, X } from 'lucide-react';
import { type JSX } from 'react';
import { useTranslations } from 'next-intl';

import { Input } from '@bimstitch/ui';

type TreeToolbarProps = {
  query: string;
  onQueryChange: (q: string) => void;
  isAllExpanded: boolean;
  onToggleExpand: () => void;
  allChecked: boolean;
  onToggleCheckAll: () => void;
};

const toolBtnClass = [
  'inline-grid h-[26px] w-[26px] cursor-pointer place-items-center',
  'rounded border border-transparent bg-transparent p-0',
  'hover:bg-[var(--bg-hover)]',
].join(' ');

export function TreeToolbar({
  query,
  onQueryChange,
  isAllExpanded,
  onToggleExpand,
  allChecked,
  onToggleCheckAll,
}: TreeToolbarProps): JSX.Element {
  const t = useTranslations('viewer.explorer');

  return (
    <div
      className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1.5"
      style={{ background: 'var(--surface-low)' }}
    >
      <div className="flex-1">
        <Input
          inputSize="sm"
          value={query}
          onChange={(e) => { onQueryChange(e.target.value); }}
          placeholder={t('filter')}
          leading={<Search className="h-3.5 w-3.5" />}
          trailing={query.length > 0 ? (
            <button
              type="button"
              onClick={() => { onQueryChange(''); }}
              className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-sm border-none bg-transparent p-0 hover:bg-background-tertiary"
              aria-label={t('clear')}
            >
              <X className="h-3 w-3" />
            </button>
          ) : undefined}
        />
      </div>

      {/* Expand / collapse all */}
      <button
        type="button"
        title={isAllExpanded ? t('collapseAll') : t('expandAll')}
        onClick={onToggleExpand}
        className={toolBtnClass}
        style={{ color: 'var(--fg-3)' }}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          {isAllExpanded
            ? <polyline points="3,10 8,5 13,10" />
            : <polyline points="3,6 8,11 13,6" />}
        </svg>
      </button>

      {/* Separator */}
      <div className="h-4 w-px" style={{ background: 'var(--border)' }} />

      {/* Check all / uncheck all */}
      <button
        type="button"
        title={allChecked ? t('uncheckAll') : t('checkAll')}
        onClick={onToggleCheckAll}
        className={toolBtnClass}
        style={{ color: allChecked ? 'var(--primary)' : 'var(--fg-3)' }}
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
      </button>
    </div>
  );
}

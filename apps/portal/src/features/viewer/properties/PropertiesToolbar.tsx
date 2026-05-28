'use client';

import { Search, X } from 'lucide-react';
import { type JSX } from 'react';
import { useTranslations } from 'next-intl';

import { Input } from '@bimstitch/ui';

type PropertiesToolbarProps = {
  query: string;
  onQueryChange: (q: string) => void;
  isAllExpanded: boolean;
  onToggleExpand: () => void;
};

/** Same button style as TreeToolbar — 26×26 icon-only buttons. */
const toolBtnClass = [
  'inline-grid h-[26px] w-[26px] cursor-pointer place-items-center',
  'rounded border border-transparent bg-transparent p-0',
  'hover:bg-[var(--bg-hover)]',
].join(' ');

export function PropertiesToolbar({
  query,
  onQueryChange,
  isAllExpanded,
  onToggleExpand,
}: PropertiesToolbarProps): JSX.Element {
  const t = useTranslations('viewer.properties');

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
          trailing={
            query.length > 0 ? (
              <button
                type="button"
                onClick={() => { onQueryChange(''); }}
                className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-sm border-none bg-transparent p-0 hover:bg-background-tertiary"
                aria-label={t('clear')}
              >
                <X className="h-3 w-3" />
              </button>
            ) : undefined
          }
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
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {isAllExpanded ? (
            <polyline points="3,10 8,5 13,10" />
          ) : (
            <polyline points="3,6 8,11 13,6" />
          )}
        </svg>
      </button>
    </div>
  );
}

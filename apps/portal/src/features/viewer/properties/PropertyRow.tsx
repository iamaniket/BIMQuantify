'use client';

import { Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type JSX, useCallback } from 'react';

import { cn } from '@bimstitch/ui';

import type { PropertyValue } from '@/lib/api/viewerTypes';

type PropertyRowProps = {
  name: string;
  value: PropertyValue;
  selected?: boolean | undefined;
  onSelect?: (() => void) | undefined;
};

function formatDisplay(
  value: PropertyValue,
  t: ReturnType<typeof useTranslations>,
): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? t('boolYes') : t('boolNo');
  return String(value);
}

function valueKind(value: PropertyValue): 'bool' | 'number' | 'string' | 'null' {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return 'number';
  return 'string';
}

export function PropertyRow({
  name,
  value,
  selected = false,
  onSelect,
}: PropertyRowProps): JSX.Element {
  const t = useTranslations('viewer.properties');
  const display = formatDisplay(value, t);
  const kind = valueKind(value);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      void navigator.clipboard.writeText(display);
    },
    [display],
  );

  return (
    <div
      onClick={onSelect}
      className={cn(
        'group grid min-h-[30px] cursor-default select-text items-center gap-2.5 border-l-2 pl-7 pr-2.5 transition-colors duration-100',
        selected
          ? 'border-primary bg-primary-light'
          : 'border-transparent hover:bg-background-hover',
      )}
      style={{ gridTemplateColumns: '44% 1fr auto' }}
    >
      {/* Key */}
      <span
        title={name}
        className={cn(
          'truncate font-sans text-micro leading-tight tracking-[-0.01em]',
          selected ? 'font-bold text-primary' : 'font-semibold text-foreground-secondary',
        )}
      >
        {name}
      </span>

      {/* Value */}
      <span
        className={cn(
          'inline-flex items-baseline gap-1 truncate font-sans font-normal text-micro leading-tight tabular-nums',
          kind === 'null' ? 'text-foreground-tertiary' : 'text-foreground',
        )}
      >
        {kind === 'bool' && (
          <span
            className={cn(
              'inline-block size-[7px] shrink-0 -translate-y-px rounded-full',
              value === true ? 'bg-success' : 'bg-foreground-disabled',
            )}
          />
        )}
        <span className="truncate">{display}</span>
      </span>

      {/* Copy button — visible on hover */}
      <button
        type="button"
        onClick={handleCopy}
        title={t('copyValue')}
        className="inline-grid size-[22px] cursor-pointer place-items-center rounded-[3px] border-none bg-transparent p-0 text-foreground-tertiary opacity-0 transition-opacity duration-100 group-hover:opacity-100"
      >
        <Copy className="h-3 w-3" />
      </button>
    </div>
  );
}

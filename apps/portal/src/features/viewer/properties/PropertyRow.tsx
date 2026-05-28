'use client';

import { Copy } from 'lucide-react';
import { type JSX, useState, useCallback } from 'react';

import { cn } from '@bimstitch/ui';

import type { PropertyValue } from '@/lib/api/viewerTypes';

/** Design tokens — shared with PropertySetGroup and the tree. */
const ROW_H = 30;
const FONT_KEY = 12;
const FONT_VAL = 13;
const INDENT_KEY = 28; // chevron gap

type PropertyRowProps = {
  name: string;
  value: PropertyValue;
  selected?: boolean | undefined;
  onSelect?: (() => void) | undefined;
};

function formatDisplay(value: PropertyValue): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
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
  const [hover, setHover] = useState(false);
  const display = formatDisplay(value);
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
      onMouseEnter={() => { setHover(true); }}
      onMouseLeave={() => { setHover(false); }}
      onClick={onSelect}
      className={cn(
        'grid select-text items-center gap-2.5 transition-colors duration-100',
        selected
          ? 'border-l-2 border-primary'
          : 'border-l-2 border-transparent',
      )}
      style={{
        gridTemplateColumns: '44% 1fr auto',
        minHeight: ROW_H,
        paddingLeft: INDENT_KEY,
        paddingRight: 10,
        cursor: 'default',
        background: selected
          ? 'var(--primary-light)'
          : hover
            ? 'var(--bg-hover)'
            : 'transparent',
      }}
    >
      {/* Key */}
      <span
        title={name}
        className="truncate leading-tight"
        style={{
          fontFamily: 'var(--mono)',
          fontSize: FONT_KEY,
          color: selected ? 'var(--primary)' : 'var(--fg-3)',
          fontWeight: selected ? 700 : 500,
          letterSpacing: '-0.01em',
        }}
      >
        {name}
      </span>

      {/* Value */}
      <span
        className="inline-flex items-baseline gap-1 truncate leading-tight"
        style={{
          fontFamily: kind === 'number' ? 'var(--mono)' : 'var(--sans)',
          fontSize: FONT_VAL,
          color: kind === 'null' ? 'var(--fg-3)' : 'var(--fg)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {kind === 'bool' && (
          <span
            className="inline-block shrink-0 rounded-full"
            style={{
              width: 7,
              height: 7,
              background:
                display === 'Yes' ? 'var(--success)' : 'var(--fg-disabled)',
              marginRight: 2,
              transform: 'translateY(-1px)',
            }}
          />
        )}
        <span className="truncate">{display}</span>
      </span>

      {/* Copy button — visible on hover */}
      <button
        type="button"
        onClick={handleCopy}
        title="Copy value"
        className="inline-grid place-items-center rounded-[3px] border-none bg-transparent p-0 transition-opacity duration-100"
        style={{
          width: 22,
          height: 22,
          color: 'var(--fg-3)',
          cursor: 'pointer',
          opacity: hover ? 1 : 0,
        }}
      >
        <Copy className="h-3 w-3" />
      </button>
    </div>
  );
}

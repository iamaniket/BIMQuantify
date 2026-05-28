'use client';

import type { JSX } from 'react';

import type { PropertySet } from '@/lib/api/viewerTypes';

import { PropertyRow } from './PropertyRow';

/** Design tokens — matches tree row vocabulary. */
const GROUP_H = 30;
const FONT_GROUP = 11;
const FONT_COUNT = 11.5;

type PropertySetGroupProps = {
  name: string;
  properties: PropertySet;
  open: boolean;
  onToggle: () => void;
  /** When a filter is active the group auto-expands and only matching entries show. */
  filter?: string | undefined;
  selectedKey?: string | null | undefined;
  onSelectKey?: ((key: string) => void) | undefined;
};

function matchesFilter(
  key: string,
  value: unknown,
  q: string,
): boolean {
  const lower = q.toLowerCase();
  if (key.toLowerCase().includes(lower)) return true;
  const valStr = value === null || value === undefined ? '' : String(value);
  return valStr.toLowerCase().includes(lower);
}

export function PropertySetGroup({
  name,
  properties,
  open,
  onToggle,
  filter,
  selectedKey,
  onSelectKey,
}: PropertySetGroupProps): JSX.Element | null {
  const entries = Object.entries(properties);
  const filtered = filter
    ? entries.filter(([k, v]) => matchesFilter(k, v, filter))
    : entries;

  // Hide entire group if filter eliminates all entries
  if (filter && filtered.length === 0) return null;

  // When a filter is active, force open
  const effectiveOpen = filter ? true : open;

  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      {/* Group header */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full select-none items-center gap-2 text-left transition-colors hover:bg-[var(--bg-hover)]"
        style={{
          height: GROUP_H,
          paddingLeft: 8,
          paddingRight: 12,
          cursor: 'pointer',
          background: 'transparent',
          border: 'none',
        }}
      >
        {/* Chevron */}
        <span
          aria-hidden="true"
          className="inline-grid shrink-0 place-items-center transition-transform duration-[120ms]"
          style={{
            width: 14,
            height: 14,
            color: 'var(--fg-3)',
            transform: effectiveOpen ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 8 8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="2.5,1.5 5.5,4 2.5,6.5" />
          </svg>
        </span>

        {/* Pset name */}
        <span
          title={name}
          className="flex-1 truncate"
          style={{
            fontFamily: 'var(--mono)',
            fontSize: FONT_GROUP,
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            color: 'var(--fg-2)',
            fontWeight: 700,
          }}
        >
          {name}
        </span>

        {/* Count chip */}
        <span
          style={{
            fontFamily: 'var(--mono)',
            fontSize: FONT_COUNT,
            color: 'var(--fg-3)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {filtered.length}
        </span>
      </button>

      {/* Property rows */}
      {effectiveOpen &&
        filtered.map(([propName, value]) => (
          <PropertyRow
            key={propName}
            name={propName}
            value={value}
            selected={selectedKey === `${name}.${propName}`}
            onSelect={
              onSelectKey
                ? () => { onSelectKey(`${name}.${propName}`); }
                : undefined
            }
          />
        ))}
    </div>
  );
}

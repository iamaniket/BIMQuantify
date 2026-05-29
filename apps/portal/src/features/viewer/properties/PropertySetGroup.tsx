'use client';

import { CountChip, Eyebrow } from '@bimstitch/ui';
import type { JSX } from 'react';

import type { PropertySet } from '@/lib/api/viewerTypes';

import { PropertyRow } from './PropertyRow';

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
    <div className="border-t border-border">
      {/* Group header */}
      <button
        type="button"
        onClick={onToggle}
        className="flex h-[30px] w-full cursor-pointer select-none items-center gap-2 border-none bg-transparent pl-2 pr-3 text-left transition-colors hover:bg-background-hover"
      >
        {/* Chevron */}
        <span
          aria-hidden="true"
          className="inline-grid h-3.5 w-3.5 shrink-0 place-items-center text-foreground-tertiary transition-transform duration-[120ms]"
          style={{ transform: effectiveOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
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
        <Eyebrow title={name} className="flex-1 truncate">
          {name}
        </Eyebrow>

        {/* Count chip */}
        <CountChip>{filtered.length}</CountChip>
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

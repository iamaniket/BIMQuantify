'use client';

import type { JSX } from 'react';

import type { PropertyValue } from '@/lib/api/viewerTypes';

type PropertyRowProps = {
  name: string;
  value: PropertyValue;
};

function formatValue(value: PropertyValue): string {
  if (value === null) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export function PropertyRow({ name, value }: PropertyRowProps): JSX.Element {
  return (
    <div className="grid grid-cols-[110px_1fr] items-start gap-2 border-b border-background-secondary px-3 py-1.5">
      <span
        title={name}
        className="truncate font-mono text-[10.5px] text-foreground-secondary"
      >
        {name}
      </span>
      <span className="break-words text-[11.5px] font-medium text-foreground">
        {formatValue(value)}
      </span>
    </div>
  );
}

'use client';

import type { JSX } from 'react';

import { Input, Label } from '@bimstitch/ui';

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
    <div className="flex items-center gap-2 px-3 py-1">
      <Label className="w-1/2 shrink-0 truncate text-caption text-foreground-secondary">
        {name}
      </Label>
      <Input
        inputSize="sm"
        value={formatValue(value)}
        disabled
        readOnly
        className="h-6 flex-1 text-caption"
      />
    </div>
  );
}

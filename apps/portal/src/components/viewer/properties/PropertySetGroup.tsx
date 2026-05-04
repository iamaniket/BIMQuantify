'use client';

import { ChevronRight } from 'lucide-react';
import { useState, type JSX } from 'react';

import { cn } from '@bimstitch/ui';

import type { PropertySet } from '@/lib/api/viewerTypes';

import { PropertyRow } from './PropertyRow';

type PropertySetGroupProps = {
  name: string;
  properties: PropertySet;
  defaultOpen?: boolean;
};

export function PropertySetGroup({
  name,
  properties,
  defaultOpen = false,
}: PropertySetGroupProps): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const entries = Object.entries(properties);

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        className="flex w-full items-center gap-1 px-3 py-1.5 text-left hover:bg-background-secondary"
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight
          className={cn(
            'h-3 w-3 shrink-0 transition-transform duration-150',
            open && 'rotate-90',
          )}
        />
        <span className="flex-1 truncate text-caption font-medium">
          {name}
        </span>
        <span className="text-caption text-foreground-tertiary">
          {String(entries.length)}
        </span>
      </button>
      {open ? (
        <div className="pb-1">
          {entries.map(([propName, value]) => (
            <PropertyRow key={propName} name={propName} value={value} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

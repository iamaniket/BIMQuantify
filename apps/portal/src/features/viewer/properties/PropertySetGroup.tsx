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
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors hover:bg-background-secondary"
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight
          className={cn(
            'h-3 w-3 shrink-0 text-foreground-secondary transition-transform duration-150',
            open && 'rotate-90',
          )}
        />
        <span
          title={name}
          className="flex-1 truncate font-mono text-caption font-bold uppercase tracking-[0.1em] text-foreground-secondary"
        >
          {name}
        </span>
        <span className="font-mono text-caption tabular-nums text-foreground-secondary/70">
          {entries.length}
        </span>
      </button>
      {open && (
        <div className="pb-1">
          {entries.map(([propName, value]) => (
            <PropertyRow key={propName} name={propName} value={value} />
          ))}
        </div>
      )}
    </div>
  );
}

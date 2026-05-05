'use client';

import type { JSX } from 'react';

type ElementHeaderProps = {
  name: string | null;
  type: string;
  globalId: string | null;
  selectionCount?: number;
};

export function ElementHeader({
  name,
  type,
  globalId,
  selectionCount,
}: ElementHeaderProps): JSX.Element {
  const showCount = selectionCount !== undefined && selectionCount > 1;
  return (
    <div className="border-b border-border bg-background px-3.5 py-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-foreground-secondary">
          {type}
        </span>
        <span className="rounded-sm bg-background-secondary px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-wider text-foreground-secondary">
          {showCount ? `${selectionCount} selected` : 'Selected'}
        </span>
      </div>
      <div className="mt-1 truncate text-[17px] font-medium leading-tight tracking-tight text-foreground">
        {name ?? 'Unnamed'}
      </div>
      {globalId !== null && (
        <div className="mt-0.5 truncate font-mono text-[10.5px] text-foreground-secondary">
          {globalId}
        </div>
      )}
    </div>
  );
}

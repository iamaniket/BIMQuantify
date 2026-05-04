'use client';

import type { JSX } from 'react';

type ElementHeaderProps = {
  name: string | null;
  type: string;
  globalId: string | null;
};

export function ElementHeader({
  name,
  type,
  globalId,
}: ElementHeaderProps): JSX.Element {
  return (
    <div className="border-b border-border px-3 py-2">
      <div className="text-body3 font-medium text-foreground">
        {name ?? 'Unnamed'}
      </div>
      <div className="text-caption text-foreground-secondary">{type}</div>
      {globalId != null ? (
        <div className="mt-0.5 truncate text-caption text-foreground-tertiary font-mono">
          {globalId}
        </div>
      ) : null}
    </div>
  );
}

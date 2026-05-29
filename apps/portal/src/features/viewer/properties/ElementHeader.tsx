'use client';

import type { JSX } from 'react';

import { Eyebrow } from '@bimstitch/ui';

type ElementHeaderProps = {
  name: string | null;
  type: string;
};

export function ElementHeader({
  name,
  type,
}: ElementHeaderProps): JSX.Element {
  return (
    <div className="flex items-center gap-2 truncate bg-surface-main px-[21px] py-2 leading-snug">
      <Eyebrow size="sm" className="shrink-0 tracking-[0.06em]">
        {type}
      </Eyebrow>
      <span className="shrink-0 text-foreground-tertiary">:</span>
      <span className="truncate font-sans text-body3 font-semibold normal-case text-foreground">
        {name ?? 'Unnamed'}
      </span>
    </div>
  );
}

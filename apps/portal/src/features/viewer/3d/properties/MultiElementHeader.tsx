'use client';

import { Eyebrow } from '@bimdossier/ui';
import type { JSX } from 'react';

import type { TypeBreakdown } from '@/features/viewer/shared/inspector/useMultiSelectedProperties';

type MultiElementHeaderProps = {
  typeBreakdown: TypeBreakdown;
};

export function MultiElementHeader({
  typeBreakdown,
}: MultiElementHeaderProps): JSX.Element {
  const label = typeBreakdown
    .map((entry) => `${String(entry.count)} × ${entry.type}`)
    .join(', ');

  const firstEntry = typeBreakdown[0];
  const eyebrowLabel = typeBreakdown.length === 1 && firstEntry !== undefined
    ? firstEntry.type
    : 'Multi';

  return (
    <div className="flex items-center gap-2 truncate bg-surface-main px-[21px] py-2 leading-snug">
      <Eyebrow size="sm" className="shrink-0 tracking-[0.06em]">
        {eyebrowLabel}
      </Eyebrow>
      <span className="shrink-0 text-foreground-tertiary">:</span>
      <span
        className="truncate font-sans text-body3 font-semibold normal-case text-foreground"
        title={label}
      >
        {label}
      </span>
    </div>
  );
}

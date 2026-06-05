'use client';

import { cn } from '@bimstitch/ui';
import type { ComponentType, JSX } from 'react';

/**
 * The uniform 40px rounded media tile for a resource row's left slot — a tinted
 * square centring a ~20px type glyph. Findings and Certificates use this so they
 * stop rendering a bare 20px icon floating in the 40px `DetailCardRow` media
 * column. Tones map to the existing badge token palette.
 */
export type MediaTileTone = 'neutral' | 'info' | 'warning' | 'success' | 'error' | 'primary';

const TONE_STYLES: Record<MediaTileTone, string> = {
  neutral: 'bg-background-tertiary text-foreground-secondary',
  info: 'bg-info-lighter text-info',
  warning: 'bg-warning-lighter text-warning',
  success: 'bg-success-lighter text-success',
  error: 'bg-error-lighter text-error',
  primary: 'bg-primary-lighter text-primary',
};

type Props = {
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  tone?: MediaTileTone;
  className?: string;
};

export function ResourceMediaTile({ icon: Icon, tone = 'neutral', className }: Props): JSX.Element {
  return (
    <span
      className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-md',
        TONE_STYLES[tone],
        className,
      )}
    >
      <Icon className="h-5 w-5" aria-hidden />
    </span>
  );
}

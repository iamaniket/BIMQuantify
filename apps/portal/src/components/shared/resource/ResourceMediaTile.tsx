'use client';

import { cn } from '@bimstitch/ui';
import type { ComponentType, JSX } from 'react';

/**
 * Bare icon tile for a resource row's left slot — a 28px glyph centred in the
 * 40px `DetailCardRow` media column. No background box — just the icon.
 */
export type MediaTileTone = 'neutral' | 'info' | 'warning' | 'success' | 'error' | 'primary';

const TONE_STYLES: Record<MediaTileTone, string> = {
  neutral: 'text-foreground-secondary',
  info: 'text-info',
  warning: 'text-warning',
  success: 'text-success',
  error: 'text-error',
  primary: 'text-primary',
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
        'flex h-10 w-10 shrink-0 items-center justify-center',
        TONE_STYLES[tone],
        className,
      )}
    >
      <Icon className="h-7 w-7" aria-hidden />
    </span>
  );
}

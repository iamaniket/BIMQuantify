import type { JSX } from 'react';

import type { AppIcon } from '@bimstitch/ui';

import type { CalendarTone } from './types';

/**
 * Tone → design-system status tokens. The single visual authority for calendar
 * colour, reused by the chips, the day-panel rows, and the legend so every
 * surface stays consistent. Colour means status; the icon means kind.
 */
export const TONE_STYLES: Record<CalendarTone, { chip: string; dot: string }> = {
  neutral: { chip: 'bg-surface-low text-foreground-secondary', dot: 'bg-foreground-tertiary' },
  info: { chip: 'bg-info-light text-info', dot: 'bg-info' },
  primary: { chip: 'bg-primary-light text-primary', dot: 'bg-primary' },
  success: { chip: 'bg-success-light text-success', dot: 'bg-success' },
  warning: { chip: 'bg-warning-light text-warning', dot: 'bg-warning' },
  error: { chip: 'bg-error-light text-error', dot: 'bg-error' },
};

type Props = {
  tone: CalendarTone;
  /** Kind icon — distinguishes item type without relying on colour (a11y). */
  icon: AppIcon;
  title: string;
};

/** A single colour-coded item rendered inside a day cell. Pure / props-only. */
export function CalendarEventChip({ tone, icon: IconCmp, title }: Props): JSX.Element {
  const style = TONE_STYLES[tone];
  return (
    <span
      title={title}
      className={`flex items-center gap-1 rounded px-1 py-0.5 text-caption font-medium leading-tight ${style.chip}`}
    >
      <IconCmp className="h-2.5 w-2.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{title}</span>
    </span>
  );
}

import type { JSX } from 'react';

import type { AppIcon } from '@bimdossier/ui';

import type { CalendarTone } from './types';

/**
 * Tone → design-system status tokens. The single visual authority for calendar
 * colour, reused by the chips, the day-panel rows, and the legend so every
 * surface stays consistent. Colour means status; the icon means kind.
 *
 * - `chip`: background + text for the chip / icon badge.
 * - `dot`: solid status colour (legend dot, the row's left accent bar).
 * - `bar`: matching `border-left-color` so a chip can wear a status accent.
 */
export const TONE_STYLES: Record<CalendarTone, { chip: string; dot: string; bar: string }> = {
  neutral: { chip: 'bg-surface-low text-foreground-secondary', dot: 'bg-foreground-tertiary', bar: 'border-l-foreground-tertiary' },
  info: { chip: 'bg-info-light text-info', dot: 'bg-info', bar: 'border-l-info' },
  primary: { chip: 'bg-primary-light text-primary', dot: 'bg-primary', bar: 'border-l-primary' },
  success: { chip: 'bg-success-light text-success', dot: 'bg-success', bar: 'border-l-success' },
  warning: { chip: 'bg-warning-light text-warning', dot: 'bg-warning', bar: 'border-l-warning' },
  error: { chip: 'bg-error-light text-error', dot: 'bg-error', bar: 'border-l-error' },
};

type Props = {
  tone: CalendarTone;
  /** Kind icon — distinguishes item type without relying on colour (a11y). */
  icon: AppIcon;
  title: string;
};

/**
 * A single colour-coded item rendered inside a day cell. Pure / props-only.
 * Reads like a mini event bar — a status-coloured left accent, the kind icon,
 * and the title — sized comfortably (≈22px) so it stays legible and is an easy
 * drag target.
 */
export function CalendarEventChip({ tone, icon: IconCmp, title }: Props): JSX.Element {
  const style = TONE_STYLES[tone];
  return (
    <span
      title={title}
      className={`flex h-[22px] items-center gap-1.5 rounded-md border-l-[3px] pl-1.5 pr-1 text-body3 font-medium leading-none transition-shadow hover:shadow-sm ${style.chip} ${style.bar}`}
    >
      <IconCmp className="h-3 w-3 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{title}</span>
    </span>
  );
}

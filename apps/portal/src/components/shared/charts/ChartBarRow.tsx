import type { JSX } from 'react';

type Props = {
  label: string;
  /** Drives the bar width as a proportion of `total`. */
  count: number;
  total: number;
  /** Bar fill — prefer a design token, e.g. `var(--primary)`. */
  color: string;
  /** Text shown in the value column. Defaults to `count`. Use this to render a
   * formatted value (e.g. `"12.3 MB"`) while the bar width still tracks `count`. */
  valueLabel?: string;
  /** Width utility for the value column. Defaults to `w-8` (fits small counts).
   * Widen (e.g. `w-16`) when `valueLabel` holds a longer formatted string. */
  valueClassName?: string;
};

/** Labeled horizontal proportional bar — `label` … bar … `value`. Pure
 * presentational; data flows in via props. */
export function ChartBarRow({
  label, count, total, color, valueLabel, valueClassName = 'w-8',
}: Props): JSX.Element {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 truncate text-body3 text-foreground-secondary">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-low">
        <div className="h-full rounded-full" style={{ width: `${String(pct)}%`, backgroundColor: color }} />
      </div>
      <span className={`${valueClassName} shrink-0 text-right text-body3 font-semibold tabular-nums text-foreground`}>
        {valueLabel ?? count}
      </span>
    </div>
  );
}

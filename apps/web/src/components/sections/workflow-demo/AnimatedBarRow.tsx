'use client';

// Adapted from apps/portal/src/components/shared/charts/ChartBarRow.tsx (the
// portal source is untouched). Web-side additions: a `drawn` reveal gate (bars
// grow from 0% with a per-row stagger), quicker CSS transitions for live data
// updates after the reveal, and reduced-motion suppression.

import { useEffect, useState, type JSX } from 'react';

import { useReducedMotion } from '@/hooks/useReducedMotion';

type Props = {
  label: string;
  /** Drives the bar width as a proportion of `total`. */
  count: number;
  total: number;
  /** Bar fill — prefer a design token, e.g. `var(--primary)`. */
  color: string;
  /** Reveal gate — `false` holds the bar at 0%. */
  drawn: boolean;
  /** Reveal stagger in ms; live updates after the reveal animate undelayed. */
  delay?: number;
};

/** Labeled horizontal proportional bar — `label` … bar … `count`. Pure
 * presentational; data flows in via props. */
export function AnimatedBarRow({
  label,
  count,
  total,
  color,
  drawn,
  delay = 0,
}: Props): JSX.Element {
  const reducedMotion = useReducedMotion();
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  // Once the grow-in has landed, later width changes use the quicker
  // data-update transition with no stagger delay.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!drawn) return undefined;
    if (reducedMotion) {
      setSettled(true);
      return undefined;
    }
    const timer = setTimeout(() => setSettled(true), delay + 700);
    return () => clearTimeout(timer);
  }, [drawn, reducedMotion, delay]);

  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 truncate text-body3 text-foreground-secondary">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-low">
        <div
          className="h-full rounded-full"
          style={{
            width: drawn || reducedMotion ? `${String(pct)}%` : '0%',
            backgroundColor: color,
            // Longhands only — mixing the `transition` shorthand with
            // `transitionDelay` across rerenders trips a React style warning.
            transitionProperty: reducedMotion ? undefined : 'width',
            transitionDuration: reducedMotion ? undefined : settled ? '400ms' : '700ms',
            transitionTimingFunction: reducedMotion ? undefined : 'ease',
            transitionDelay:
              !settled && !reducedMotion && delay > 0 ? `${String(delay)}ms` : undefined,
          }}
        />
      </div>
      <span className="w-6 shrink-0 text-right text-body3 font-semibold tabular-nums text-foreground">
        {count}
      </span>
    </div>
  );
}

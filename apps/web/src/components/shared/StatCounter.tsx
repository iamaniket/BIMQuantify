'use client';

import { useLocale } from 'next-intl';
import { useEffect, useRef, useState, type JSX } from 'react';

import { useInView } from '@/hooks/useInView';
import { useReducedMotion } from '@/hooks/useReducedMotion';

type StatCounterProps = {
  value: number;
  label: string;
  suffix?: string;
  durationMs?: number;
};

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

/**
 * Counts up from 0 to `value` the first time it scrolls into view, eased and
 * locale-formatted (Dutch `1.200`, English `1,200`). Reduced motion jumps
 * straight to the final value. The number is `tabular-nums` so the width never
 * changes mid-count — no reflow.
 */
export function StatCounter({
  value,
  label,
  suffix,
  durationMs = 1600,
}: StatCounterProps): JSX.Element {
  const locale = useLocale();
  const reducedMotion = useReducedMotion();
  const { ref, inView } = useInView<HTMLDivElement>({ once: true });
  const [display, setDisplay] = useState(0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!inView) return undefined;
    if (reducedMotion) {
      setDisplay(value);
      return undefined;
    }
    let start: number | null = null;
    const step = (now: number): void => {
      if (start === null) start = now;
      const progress = Math.min((now - start) / durationMs, 1);
      setDisplay(Math.round(easeOutCubic(progress) * value));
      if (progress < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [inView, reducedMotion, value, durationMs]);

  const formatted = new Intl.NumberFormat(locale).format(display);

  return (
    <div ref={ref} className="flex flex-col items-center gap-1 text-center">
      <span className="text-h3 font-semibold tabular-nums text-foreground">
        {formatted}
        {suffix}
      </span>
      <span className="text-body3 text-foreground-secondary">{label}</span>
    </div>
  );
}

'use client';

import { useEffect, useState, type RefObject } from 'react';

type FitOptions = {
  /** Height of a single row, in px. */
  rowHeight: number;
  /** Vertical gap between rows, in px. */
  gap?: number;
  /** Minimum rows to return (default 1). */
  min?: number;
  /** Maximum rows to return. */
  max: number;
};

/**
 * How many fixed-height rows fit inside `ref`'s measured (content) height.
 * Re-measures on mount and on container resize (`ResizeObserver`), with a
 * one-shot timeout fallback for headless environments where `ResizeObserver`
 * never fires (mirrors the `MonthCalendar` pattern).
 *
 * N rows occupy `N*rowHeight + (N-1)*gap`, so the fit is
 * `floor((h + gap) / (rowHeight + gap))`, clamped to `[min, max]`. Returns
 * `min` before the first measure to avoid a flash of zero rows.
 */
export function useFitCount<T extends HTMLElement>(
  ref: RefObject<T | null>,
  { rowHeight, gap = 0, min = 1, max }: FitOptions,
): number {
  const [count, setCount] = useState(min);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;

    const measure = (): void => {
      const fit = Math.floor((el.clientHeight + gap) / (rowHeight + gap));
      setCount(Math.max(min, Math.min(max, fit)));
    };

    measure();
    const ro = new ResizeObserver(() => { measure(); });
    ro.observe(el);
    const fallback = setTimeout(measure, 50);

    return () => {
      ro.disconnect();
      clearTimeout(fallback);
    };
  }, [ref, rowHeight, gap, min, max]);

  return count;
}

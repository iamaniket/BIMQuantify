'use client';

import { useEffect, useState } from 'react';

/**
 * Tracks whether the window has scrolled past `threshold` pixels (default 8).
 * One passive scroll listener whose handler only schedules a single
 * `requestAnimationFrame`; the rAF callback reads `window.scrollY` once and
 * sets state (React bails out on the unchanged boolean, so no re-render
 * storm). Runs the check once on mount so restored scroll positions (e.g.
 * back navigation) are picked up. SSR-safe: starts `false`. No reduced-motion
 * dependency — it reports state; consuming classes carry
 * `motion-reduce:transition-none` per house convention.
 */
export function useScrollThreshold(threshold = 8): boolean {
  const [passed, setPassed] = useState(false);

  useEffect(() => {
    let raf = 0;
    const update = (): void => {
      raf = 0;
      setPassed(window.scrollY > threshold);
    };
    const onScroll = (): void => {
      if (raf !== 0) return;
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [threshold]);

  return passed;
}

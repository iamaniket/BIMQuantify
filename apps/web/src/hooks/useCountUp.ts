'use client';

import { useEffect, useRef, useState } from 'react';

import { useReducedMotion } from './useReducedMotion';

type UseCountUpOptions = {
  /**
   * Gate for the tween — typically the owning section's `useInView` flag.
   * While `false` (post-mount, pre-reveal) the hook holds `0` so the first
   * reveal has something to count up from.
   */
  active: boolean;
  /** Tween length in ms. */
  duration?: number;
  /**
   * Delay before the FIRST tween starts, in ms (reveal stagger). Later
   * `target` changes animate immediately so live updates never feel laggy.
   */
  delay?: number;
};

/**
 * Animated integer counter (rAF + ease-out cubic). SSR-safe: the server and
 * first client render show `target` (static HTML carries the real value);
 * after mount the value drops to `0` until `active` flips true, then eases to
 * `target` — mirroring the hidden-until-reveal convention in `Reveal.tsx`.
 * Subsequent `target` changes while active ease from the currently displayed
 * value. `prefers-reduced-motion` renders every value instantly. The rAF loop
 * is cancelled on unmount and whenever the inputs change mid-flight.
 */
export function useCountUp(
  target: number,
  { active, duration = 900, delay = 0 }: UseCountUpOptions,
): number {
  const reducedMotion = useReducedMotion();
  const [display, setDisplay] = useState(target);
  // Mirrors `display` so the effect can read the current value without
  // re-triggering itself on every animation frame.
  const displayRef = useRef(target);
  const activatedRef = useRef(false);

  useEffect(() => {
    if (reducedMotion) {
      activatedRef.current = true;
      displayRef.current = target;
      setDisplay(target);
      return undefined;
    }
    if (!active) {
      // Mounted but not yet revealed: hold the zero state (invisible behind
      // the section's Reveal) so the reveal tween has a starting point.
      if (!activatedRef.current) {
        displayRef.current = 0;
        setDisplay(0);
      }
      return undefined;
    }
    const firstRun = !activatedRef.current;
    activatedRef.current = true;
    const from = displayRef.current;
    if (from === target) return undefined;

    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let start: number | null = null;
    const tick = (now: number): void => {
      if (start === null) start = now;
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - (1 - t) ** 3;
      const value = Math.round(from + (target - from) * eased);
      displayRef.current = value;
      setDisplay(value);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    const begin = (): void => {
      raf = requestAnimationFrame(tick);
    };
    if (firstRun && delay > 0) timer = setTimeout(begin, delay);
    else begin();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [target, active, reducedMotion, duration, delay]);

  return display;
}

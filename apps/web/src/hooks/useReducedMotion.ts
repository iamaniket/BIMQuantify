'use client';

import { useEffect, useState } from 'react';

/**
 * Tracks the user's `prefers-reduced-motion` setting. SSR-safe: starts `false`
 * (motion allowed) and resolves on mount, so the server and first client render
 * agree. Mirrors the `matchMedia` + `change`-listener idiom used elsewhere in
 * the monorepo (e.g. apps/portal `useIsMobile`).
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

type UseInViewOptions = {
  threshold?: number;
  rootMargin?: string;
  /** Stop observing after the first reveal (default true). */
  once?: boolean;
};

/**
 * Reveal-on-scroll primitive. Attaches one `IntersectionObserver` to the
 * returned ref; when the element enters the viewport `inView` flips true and
 * (when `once`) the observer disconnects immediately — no lingering observers.
 * Falls back to `inView: true` when `IntersectionObserver` is unavailable so
 * content is never hidden (progressive enhancement, content-first).
 */
export function useInView<T extends Element = HTMLDivElement>(
  options: UseInViewOptions = {},
): { ref: RefObject<T | null>; inView: boolean } {
  const { threshold = 0.15, rootMargin = '0px 0px -10% 0px', once = true } = options;
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            if (once) observer.disconnect();
          } else if (!once) {
            setInView(false);
          }
        }
      },
      { threshold, rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold, rootMargin, once]);

  return { ref, inView };
}

'use client';

import { useEffect, useState } from 'react';

/**
 * Reports which of the given section ids is currently "active" for nav
 * highlighting. One shared `IntersectionObserver` over all ids; the negative
 * rootMargin insets the top by the sticky-header height and the bottom by 60%
 * of the viewport, so a section counts as active while it occupies the reading
 * zone. When several sections intersect, the *last* one in `ids` order wins
 * (callers pass ids in document order). `enabled: false` (non-homepage routes)
 * attaches nothing and returns `null`; so does a missing
 * `IntersectionObserver` — the nav simply shows no section underline
 * (progressive enhancement, same spirit as `useInView`).
 */
export function useScrollSpy(ids: readonly string[], enabled: boolean): string | null {
  const [active, setActive] = useState<string | null>(null);
  // Depend on the joined key so callers can pass inline arrays without
  // re-subscribing every render.
  const idsKey = ids.join(',');

  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === 'undefined') {
      setActive(null);
      return undefined;
    }
    const idList = idsKey.split(',').filter((id) => id.length > 0);
    const intersecting = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          intersecting.set(entry.target.id, entry.isIntersecting);
        }
        let next: string | null = null;
        for (const id of idList) {
          if (intersecting.get(id) === true) next = id;
        }
        setActive((prev) => (prev === next ? prev : next));
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 },
    );
    for (const id of idList) {
      const el = document.getElementById(id);
      if (el !== null) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [enabled, idsKey]);

  return active;
}

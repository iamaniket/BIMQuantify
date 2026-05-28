'use client';

import { useCallback, useState } from 'react';

export type TreeExpansion = {
  expanded: Set<string>;
  toggle: (key: string) => void;
  expandAll: (keys: string[]) => void;
  collapseAll: () => void;
};

export function useTreeExpansion(initial?: Iterable<string>): TreeExpansion {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(initial ?? []),
  );

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const expandAll = useCallback((keys: string[]) => {
    setExpanded(new Set(keys));
  }, []);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  return {
    expanded, toggle, expandAll, collapseAll,
  };
}

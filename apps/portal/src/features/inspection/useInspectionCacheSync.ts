'use client';

import { useEffect, useRef } from 'react';

import type { Borgingsplan, ChecklistItemResult } from '@/lib/api/schemas';
import { cacheInspectionData } from '@/lib/offline/cache.js';

export function useInspectionCacheSync(
  projectId: string,
  momentId: string,
  plan: Borgingsplan | null | undefined,
  results: ChecklistItemResult[] | undefined,
): void {
  const hasCached = useRef(false);

  useEffect(() => {
    if (plan === null || plan === undefined) return;
    if (results === undefined) return;
    if (hasCached.current) return;

    hasCached.current = true;
    void cacheInspectionData(projectId, momentId, plan, results);
  }, [projectId, momentId, plan, results]);

  useEffect(() => {
    if (results === undefined) return;
    if (!hasCached.current) return;
    void cacheInspectionData(projectId, momentId, plan!, results);
  }, [projectId, momentId, plan, results]);
}

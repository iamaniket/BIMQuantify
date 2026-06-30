'use client';

import { useMemo } from 'react';

import { useIsPooledContext } from '@/hooks/useIsPooledContext';
import { listFindings } from '@/lib/api/findings';
import { listPooledFindings } from '@/lib/api/pooledFindings';
import type { Finding } from '@/lib/api/schemas';
import type { ModelMetadata } from '@/lib/api/viewerTypes';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

export type OrphanedElementItems = {
  findings: Finding[];
  total: number;
  /** True once the underlying queries AND the version metadata have resolved —
   * gates the notice so it never flashes a partial/empty state while loading. */
  ready: boolean;
};

const EMPTY: OrphanedElementItems = {
  findings: [],
  total: 0,
  ready: false,
};

/**
 * Findings attached to this model whose GlobalId is NOT present in the
 * currently-open version's metadata — i.e. the element was deleted or
 * re-exported with a new GlobalId, so the finding would otherwise silently
 * disappear from the viewer (#N9, "flag as orphaned"). Findings are the only
 * model-anchored item type; attachments and certificates live at the project
 * level and are never element-linked.
 *
 * Fully client-side: the present-GlobalId set comes from the metadata artifact
 * already loaded for the open version, so detecting orphans costs no extra
 * round-trip beyond listing the model's findings.
 */
export function useOrphanedElementItems(
  projectId: string,
  modelId: string,
  metadata: ModelMetadata | undefined,
  enabled = true,
): OrphanedElementItems {
  const { isPooled, ready } = useIsPooledContext();
  // Free-aware: free has no server element filter and no paid `/projects/*`
  // findings route (org-less JWT → 409). `modelId` is the container id, so we
  // list its snags directly; orphan detection is client-side either way.
  // `ready` defers the fetch until /auth/me resolves so the free/paid branch
  // isn't chosen prematurely (a 409 flash on the paid route).
  const findingsQuery = useAuthQuery({
    queryKey: ['projects', projectId, 'findings', 'model', modelId, isPooled] as const,
    queryFn: isPooled
      ? async (accessToken) => {
          // Free endpoint already returns the paid `Finding` shape (no adapter).
          const data = await listPooledFindings(accessToken, modelId);
          return { data, totalCount: data.length };
        }
      : (accessToken) => listFindings(accessToken, projectId, { linkedModelId: modelId }),
    enabled: ready && enabled,
    staleTime: 30_000,
  });

  const presentGlobalIds = useMemo(() => {
    const set = new Set<string>();
    for (const el of metadata?.elements ?? []) {
      if (el.globalId !== null) set.add(el.globalId);
    }
    return set;
  }, [metadata]);

  const findingsData = findingsQuery.data;

  return useMemo(() => {
    // Until the open version's metadata has loaded we cannot tell which
    // GlobalIds are present, so report nothing rather than flag everything.
    const haveMetadata = (metadata?.elements?.length ?? 0) > 0;
    if (!enabled || !haveMetadata || findingsQuery.isLoading) {
      return EMPTY;
    }

    const isOrphan = (g: string | null): g is string => g !== null && !presentGlobalIds.has(g);

    const fItems = findingsData?.data ?? [];
    const findings = fItems.filter((f) => isOrphan(f.linked_element_global_id));

    return {
      findings,
      total: findings.length,
      ready: true,
    };
  }, [
    enabled,
    metadata,
    presentGlobalIds,
    findingsQuery.isLoading,
    findingsData,
  ]);
}

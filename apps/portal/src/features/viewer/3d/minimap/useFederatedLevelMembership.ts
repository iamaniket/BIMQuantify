'use client';

import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { useCallback } from 'react';

import { storeysKey } from '@/features/storeys/queryKeys';
import { federatedModelId } from '@/features/viewer/3d/federation/federatedModelId';
import { buildStoreyMembership } from '@/features/viewer/3d/minimap/storeyMembership';
import { listStoreys } from '@/lib/api/storeys';
import type { ProjectViewerDocumentEntry, Storey } from '@/lib/api/schemas';
import type { ModelMetadata } from '@/lib/api/viewerTypes';
import { useAuth } from '@/providers/AuthProvider';

import { unionMembershipByLevel, type IsolateItem, type MembershipModel } from './levelMembership';

export type { IsolateItem } from './levelMembership';

/**
 * Union of every loaded discipline's storeys, keyed by the shared project Level:
 * `level_id -> [{ modelId, localId }]` across ALL federated models. Feeds
 * `minimap.isolateItemsAcrossModels` so isolating a Level hides off-level
 * elements from arch + structural + MEP together, not just the plan model.
 *
 * Per model it needs two things — the extraction `metadata` (element→storey
 * membership) and the `storeys` (storey→project-Level reconciliation) — fetched
 * for every entry in one `useQueries` (interleaved meta/storey) so `combine`
 * yields a referentially stable Map while the underlying data is unchanged.
 */
export function useFederatedLevelMembership(
  projectId: string,
  entries: ProjectViewerDocumentEntry[],
): Map<string, IsolateItem[]> {
  const { tokens } = useAuth();
  const accessToken = tokens?.access_token ?? null;

  // combine depends only on `entries` (itself memoized in the scope), so React
  // Query returns a stable Map until the metadata/storeys actually change.
  const combine = useCallback(
    (results: UseQueryResult<unknown>[]): Map<string, IsolateItem[]> => {
      const models: MembershipModel[] = [];
      entries.forEach((e, i) => {
        const md = results[2 * i]?.data as ModelMetadata | undefined;
        const storeys = (results[2 * i + 1]?.data as Storey[] | undefined) ?? [];
        if (!md) return;
        models.push({
          viewerModelId: federatedModelId(e.file_id),
          membership: buildStoreyMembership(md),
          storeys,
        });
      });
      return unionMembershipByLevel(models);
    },
    [entries],
  );

  return useQueries({
    queries: entries.flatMap((e) => [
      {
        queryKey: ['viewer', 'metadata', e.metadata_url] as const,
        queryFn: async (): Promise<ModelMetadata> => {
          const res = await fetch(e.metadata_url!);
          if (!res.ok) throw new Error(`Failed to fetch metadata: ${String(res.status)}`);
          return res.json() as Promise<ModelMetadata>;
        },
        enabled: e.metadata_url !== null,
        staleTime: Infinity,
        gcTime: 10 * 60 * 1000,
      },
      {
        queryKey: storeysKey(projectId, e.model_id),
        queryFn: () => {
          if (accessToken === null) throw new Error('Not authenticated');
          return listStoreys(accessToken, projectId, e.model_id);
        },
        enabled: accessToken !== null && e.model_id.length > 0,
        staleTime: 60_000,
      },
    ]),
    combine,
  });
}

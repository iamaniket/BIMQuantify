'use client';

import { useQueries } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import type { UseQueryResult } from '@tanstack/react-query';

import { federatedModelId } from '@/features/viewer/3d/federation/federatedModelId';
import type { ViewerScope } from '@/features/viewer/shared/useViewerScope';
import type { ModelMetadata } from '@/lib/api/viewerTypes';

import { pruneSpaceNodes, type ExplorerModel } from './treeBuilders';

function toExplorerModel(
  viewerModelId: string,
  modelName: string,
  metadata: ModelMetadata,
): ExplorerModel {
  // Spaces (IfcSpace) are excluded from every listing — their visibility is
  // controlled only by the toolbar toggle.
  const elements = (metadata.elements ?? []).filter((el) => el.type !== 'IfcSpace');
  const spatialTree = metadata.spatialTree ? pruneSpaceNodes(metadata.spatialTree) : null;
  return {
    viewerModelId, modelName, spatialTree, elements,
  };
}

/**
 * The model(s) the explorer tabs render. Single-file mode → one model built
 * from the active metadata. Federated mode → every loaded model's metadata,
 * fetched in parallel (URL-keyed, so it shares cache with the active fetch).
 * Uses `combine` so the returned array is referentially stable while the
 * underlying metadata is unchanged — the tabs memoize tree-building on it.
 */
export function useExplorerModels(
  scope: ViewerScope,
  activeMetadata: ModelMetadata | undefined,
): { models: ExplorerModel[]; isLoading: boolean } {
  const isMulti = scope.mode === 'multi';
  const { entries } = scope;

  // Stable `combine` (depends only on `entries`, itself memoized in the scope)
  // so React Query returns a referentially stable result — the tabs memoize
  // tree-building on `models`, so a new array each render would rebuild it.
  const combine = useCallback(
    (results: UseQueryResult<ModelMetadata>[]) => {
      const models: ExplorerModel[] = [];
      entries.forEach((e, i) => {
        const md = results[i]?.data;
        if (md) models.push(toExplorerModel(federatedModelId(e.file_id), e.model_name, md));
      });
      return { models, isLoading: results.some((r) => r.isLoading) };
    },
    [entries],
  );

  const multi = useQueries({
    queries: isMulti
      ? entries.map((e) => ({
        queryKey: ['viewer', 'metadata', e.metadata_url] as const,
        queryFn: async (): Promise<ModelMetadata> => {
          const res = await fetch(e.metadata_url!);
          if (!res.ok) throw new Error(`Failed to fetch metadata: ${String(res.status)}`);
          return res.json() as Promise<ModelMetadata>;
        },
        enabled: e.metadata_url !== null,
        staleTime: Infinity,
        gcTime: 10 * 60 * 1000,
      }))
      : [],
    combine,
  });

  const singleModels = useMemo<ExplorerModel[]>(() => {
    if (isMulti || activeMetadata === undefined) return [];
    return [toExplorerModel(scope.activeViewerModelId, '', activeMetadata)];
  }, [isMulti, activeMetadata, scope.activeViewerModelId]);

  if (isMulti) return { models: multi.models, isLoading: multi.isLoading };
  return { models: singleModels, isLoading: false };
}

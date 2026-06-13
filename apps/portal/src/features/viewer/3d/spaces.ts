'use client';

import { useQueries } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';

import type { ItemId, ViewerHandle } from '@bimstitch/viewer';
import type { UseQueryResult } from '@tanstack/react-query';

import { federatedModelId } from '@/features/viewer/3d/federation/federatedModelId';
import type { ViewerScope } from '@/features/viewer/shared/useViewerScope';
import type { ModelMetadata, SpatialNode } from '@/lib/api/viewerTypes';

/** IFC class for spaces/rooms, as emitted by the metadata pipeline (PascalCase). */
export const IFC_SPACE_TYPE = 'IfcSpace';

function collectSpatialSpaceIds(node: SpatialNode, out: Set<number>): void {
  if (node.type === IFC_SPACE_TYPE) out.add(node.expressID);
  for (const child of node.children) collectSpatialSpaceIds(child, out);
}

/**
 * Every localId (== expressID) that is an IfcSpace, unioned across the element
 * list, the spatial tree, and the zones grouping. These are the ids the
 * spaces toggle hides/shows; localId === expressID in this codebase.
 */
export function collectSpaceLocalIds(metadata: ModelMetadata | undefined): number[] {
  if (!metadata) return [];
  const ids = new Set<number>();
  for (const el of metadata.elements ?? []) {
    if (el.type === IFC_SPACE_TYPE) ids.add(el.expressID);
  }
  if (metadata.spatialTree) collectSpatialSpaceIds(metadata.spatialTree, ids);
  for (const zone of metadata.zones ?? []) {
    for (const space of zone.spaces) ids.add(space.expressID);
  }
  return [...ids];
}

/**
 * Drives the visibility plugin's persistent-hidden set from the spaces toggle.
 * When `showSpaces` is false, every IfcSpace across EVERY loaded model is
 * force-hidden (and stays hidden through "Show all"); when true, they are
 * released. Re-applies on viewer reload (`viewerReady`) and whenever the loaded
 * model set or toggle changes.
 *
 * Multi-model is the reason the items must be collected per model: each space's
 * `ItemId` carries the model it belongs to (`file-<fileId>`), so the plugin can
 * fan the hide out to the right model. Single mode uses the active metadata; multi
 * mode fetches every entry's metadata (URL-keyed, so it shares cache with the
 * active fetch and the explorer — no extra network).
 */
export function useSpaceVisibility(
  handle: ViewerHandle | null,
  viewerReady: boolean | undefined,
  scope: ViewerScope,
  metadata: ModelMetadata | undefined,
  showSpaces: boolean,
): void {
  const isMulti = scope.mode === 'multi';
  const { entries, activeViewerModelId } = scope;

  // Stable `combine` (depends only on `entries`) so React Query returns a
  // referentially stable array — the effect below depends on it.
  const combine = useCallback(
    (results: UseQueryResult<ModelMetadata>[]): ItemId[] => {
      const items: ItemId[] = [];
      entries.forEach((e, i) => {
        const md = results[i]?.data;
        if (!md) return;
        const modelId = federatedModelId(e.file_id);
        for (const localId of collectSpaceLocalIds(md)) items.push({ modelId, localId });
      });
      return items;
    },
    [entries],
  );

  const multiItems = useQueries({
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

  useEffect(() => {
    if (!handle || !viewerReady) return;

    if (showSpaces) {
      handle.commands.execute('visibility.clearPersistentHidden').catch(() => undefined);
      return;
    }

    const items: ItemId[] = isMulti
      ? multiItems
      : collectSpaceLocalIds(metadata).map((localId) => ({
        modelId: activeViewerModelId,
        localId,
      }));
    handle.commands.execute('visibility.setPersistentHidden', items).catch(() => undefined);
  }, [handle, viewerReady, isMulti, multiItems, metadata, activeViewerModelId, showSpaces]);
}

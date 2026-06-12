'use client';

import { useEffect } from 'react';

import type { ItemId, ViewerHandle } from '@bimstitch/viewer';

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
 * When `showSpaces` is false, every IfcSpace is force-hidden (and stays hidden
 * through "Show all"); when true, they are released. Re-applies on viewer
 * reload (`viewerReady`) and whenever the metadata or toggle changes.
 */
export function useSpaceVisibility(
  handle: ViewerHandle | null,
  viewerReady: boolean | undefined,
  metadata: ModelMetadata | undefined,
  showSpaces: boolean,
): void {
  useEffect(() => {
    if (!handle || !viewerReady) return;
    const modelId = handle.getModelId();
    if (modelId === null) return;

    if (showSpaces) {
      handle.commands.execute('visibility.clearPersistentHidden').catch(() => undefined);
      return;
    }

    const items: ItemId[] = collectSpaceLocalIds(metadata).map((localId) => ({
      modelId,
      localId,
    }));
    handle.commands.execute('visibility.setPersistentHidden', items).catch(() => undefined);
  }, [handle, viewerReady, metadata, showSpaces]);
}

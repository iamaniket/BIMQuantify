import type { ItemId } from '@bimstitch/viewer';

import type { ModelMetadata, SpatialNode } from '@/lib/api/viewerTypes';

/**
 * Build an IFC `GlobalId -> ItemId` map from a model's metadata, keyed by the
 * viewer's own `modelId` (the one baked into every ItemId it emits). The
 * element `expressID` IS the viewer's `localId`.
 *
 * Walks the same surfaces a BCF round-trip needs — project, the full spatial
 * tree, zones, and the flat element list — so any element a viewpoint or a
 * finding can reference resolves. Single source of truth shared by the BCF
 * plugin feed ({@link useBcfGlobalIdMap}) and the isolation-aware finding
 * filter.
 */
export function buildGlobalIdToLocalId(
  metadata: ModelMetadata | undefined,
  modelId: string,
): Map<string, ItemId> {
  const map = new Map<string, ItemId>();
  if (!metadata) return map;

  const add = (globalId: string | null, expressID: number): void => {
    if (globalId) map.set(globalId, { modelId, localId: expressID });
  };

  add(metadata.project.globalId, metadata.project.expressID);

  const walk = (node: SpatialNode): void => {
    add(node.globalId, node.expressID);
    node.children.forEach(walk);
  };
  if (metadata.spatialTree) walk(metadata.spatialTree);

  for (const zone of metadata.zones ?? []) {
    add(zone.globalId, zone.expressID);
  }
  for (const el of metadata.elements ?? []) {
    add(el.globalId, el.expressID);
  }

  return map;
}

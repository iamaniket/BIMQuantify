'use client';

import { useEffect } from 'react';

import type { ItemId, ViewerHandle } from '@bimstitch/viewer';

import type { ModelMetadata, SpatialNode } from '@/lib/api/viewerTypes';

/**
 * Feeds the viewer's BCF plugin an IFC GlobalId -> ItemId map so that the
 * selection/visibility components of a BCF viewpoint can round-trip. Without
 * this the plugin's reverse map is empty and those components silently
 * resolve to nothing.
 *
 * The map is keyed by the viewer's own `modelId` (the one baked into every
 * ItemId it emits), obtained from `getModelId()` / the `model:loaded` event —
 * NOT the portal route's modelId. The element `expressID` is the viewer's
 * `localId`.
 */
export function useBcfGlobalIdMap(
  handle: ViewerHandle | null,
  metadata: ModelMetadata | undefined,
): void {
  useEffect(() => {
    if (!handle || !metadata) return undefined;

    const apply = (modelId: string): void => {
      const map = new Map<string, ItemId>();
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

      if (map.size > 0) {
        handle.commands.execute('bcf.setGlobalIdMap', map).catch(() => undefined);
      }
    };

    const current = handle.getModelId();
    if (current !== null) apply(current);

    return handle.events.on('model:loaded', ({ modelId }) => {
      apply(modelId);
    });
  }, [handle, metadata]);
}

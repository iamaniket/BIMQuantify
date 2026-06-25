'use client';

import { useEffect } from 'react';

import type { ViewerHandle } from '@bimdossier/viewer';

import type { ModelMetadata } from '@/lib/api/viewerTypes';

import { buildGlobalIdToLocalId } from '../shared/buildGlobalIdToLocalId';

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
      const map = buildGlobalIdToLocalId(metadata, modelId);
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

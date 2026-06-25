'use client';

import { useEffect, useMemo, useState } from 'react';

import type { ItemId, ViewerHandle } from '@bimdossier/viewer';

import { useFileFindings } from '@/features/findings/useFindings';
import type { Finding } from '@/lib/api/schemas';
import type { ModelMetadata } from '@/lib/api/viewerTypes';
import { flattenPages } from '@/lib/query/useAuthInfiniteQuery';
import { parseEntityKey, useViewerEntityStore } from '@/stores/viewerEntityStore';

import { buildGlobalIdToLocalId } from '../shared/buildGlobalIdToLocalId';
import type { EntityMarker3D } from '../shared/entityMarkerTypes';
import { useModelFindingMarkers } from '../shared/useEntityMarkers';

/** World-unit (meters) slack so anchors placed on an element face still count
 * as inside its box. */
const BOX_EPSILON = 0.05;

type Box = { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };

function pointInBox(p: { x: number; y: number; z: number }, b: Box, eps: number): boolean {
  return (
    p.x >= b.min.x - eps && p.x <= b.max.x + eps &&
    p.y >= b.min.y - eps && p.y <= b.max.y + eps &&
    p.z >= b.min.z - eps && p.z <= b.max.z + eps
  );
}

export function useEntityMarkers3D(
  handle: ViewerHandle | null,
  projectId: string,
  fileId: string | null,
  viewerReady: boolean,
  metadata: ModelMetadata | undefined,
  // Single-file mode only. When false (federated mode) this hook does not sync
  // markers, so it never clobbers the federated marker source.
  enabled: boolean,
): {
  clickedFinding: Finding | null;
  clearClicked: () => void;
} {
  const findingMarkers = useModelFindingMarkers(projectId, fileId);

  const findingsQuery = useFileFindings(projectId, fileId);
  const findings = flattenPages(findingsQuery.data);
  const findingById = useMemo(() => new Map(findings.map((f) => [f.id, f])), [findings]);

  // GlobalId -> localId (expressID). The modelId passed is irrelevant here —
  // only the numeric localId is read for membership tests.
  const gidToLocal = useMemo(() => {
    const m = new Map<string, number>();
    for (const [gid, item] of buildGlobalIdToLocalId(metadata, '')) m.set(gid, item.localId);
    return m;
  }, [metadata]);

  // Isolation state mirrored from the viewer by `useViewerBridge`.
  const isolated = useViewerEntityStore((s) => s.isolated);
  const isolationActive = useViewerEntityStore((s) => s.isolationActive);
  const isolatedKey = useMemo(
    () => (isolationActive ? [...isolated].sort().join('|') : ''),
    [isolated, isolationActive],
  );

  // Merged bbox of the isolated element(s) — only needed for coordinate-only
  // findings (no linked element). Fetched async via the viewer; recomputed
  // whenever the isolated set changes.
  const [isolatedBox, setIsolatedBox] = useState<Box | null>(null);
  useEffect(() => {
    if (!handle || !isolationActive || isolated.size === 0) {
      setIsolatedBox(null);
      return undefined;
    }
    const items: ItemId[] = [];
    for (const k of isolated) {
      const p = parseEntityKey(k);
      if (p) items.push(p);
    }
    let cancelled = false;
    handle.commands
      .execute('bbox.getItems', { items })
      .then((box) => {
        if (!cancelled) setIsolatedBox((box as Box | null) ?? null);
      })
      .catch(() => {
        if (!cancelled) setIsolatedBox(null);
      });
    return () => {
      cancelled = true;
    };
    // `isolatedKey` captures the set contents; handle identity re-runs after rebuild.
  }, [handle, isolationActive, isolatedKey]);

  // Dim finding circles that aren't associated with the isolated object. A
  // finding associates either by its linked element (GlobalId -> localId in the
  // isolated set) or, when it has no element link, by its anchor point falling
  // inside the isolated bounding box.
  const markers: EntityMarker3D[] = useMemo(() => {
    if (!isolationActive) return findingMarkers;

    const isolatedLocalIds = new Set<number>();
    for (const k of isolated) {
      const p = parseEntityKey(k);
      if (p) isolatedLocalIds.add(p.localId);
    }

    return findingMarkers.map((mk) => {
      const f = findingById.get(mk.id);
      let associated = false;
      if (f) {
        if (f.linked_element_global_id) {
          const local = gidToLocal.get(f.linked_element_global_id);
          associated = local !== undefined && isolatedLocalIds.has(local);
        } else if (isolatedBox) {
          associated = pointInBox(mk.position, isolatedBox, BOX_EPSILON);
        }
      }
      return associated ? mk : { ...mk, dimmed: true };
    });
  }, [findingMarkers, isolationActive, isolated, gidToLocal, isolatedBox, findingById]);

  useEffect(() => {
    if (!handle || !viewerReady || !enabled) return;
    handle.commands.execute('entity-marker.sync', markers).catch((err: unknown) => {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[EntityMarkers3D] sync failed:', err);
      }
    });
  }, [handle, viewerReady, enabled, markers]);

  const [clickedFinding, setClickedFinding] = useState<Finding | null>(null);

  useEffect(() => {
    if (!handle) return undefined;
    return handle.events.on('entity-marker:click', (ev) => {
      if (ev.type === 'finding') {
        const f = findings.find((x) => x.id === ev.entityId) ?? null;
        if (f) setClickedFinding(f);
      }
    });
    // `viewerReady` triggers re-subscription after viewer rebuild (events.clear)
  }, [handle, viewerReady, findings]);

  const clearClicked = (): void => {
    setClickedFinding(null);
  };

  return { clickedFinding, clearClicked };
}

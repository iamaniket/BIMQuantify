'use client';

import { useEffect, useMemo, useState } from 'react';

import type { ViewerHandle } from '@bimdossier/viewer';

import { useFindings } from '@/features/findings/useFindings';
import type { Finding, ProjectViewerDocumentEntry } from '@/lib/api/schemas';
import { flattenPages } from '@/lib/query/useAuthInfiniteQuery';

import type { EntityMarker3D } from '../shared/entityMarkerTypes';
import { federatedModelId } from './federation/federatedModelId';

/**
 * Aggregated finding markers across every loaded model (federated mode). We
 * concatenate findings from all loaded files and sync once. Each anchor is in
 * its own model's local frame, so every marker carries its `modelId` and the
 * entity-marker plugin re-bases it via that model's autoCoordinate transform —
 * otherwise pins on non-first models render translated, the same way outlines
 * did. `enabled` gates the sync so this and the single-file hook
 * (`useEntityMarkers3D`) never both write the marker set.
 */
export function useFederatedEntityMarkers3D(
  handle: ViewerHandle | null,
  projectId: string,
  entries: ProjectViewerDocumentEntry[],
  viewerReady: boolean,
  enabled: boolean,
): { clickedFinding: Finding | null; clearClicked: () => void } {
  const allFindings = flattenPages(useFindings(projectId).data);

  const loadedFileIds = useMemo(
    () => new Set(entries.map((e) => e.file_id)),
    [entries],
  );

  const findings = useMemo(
    () => allFindings.filter(
      (f) => f.linked_file_id !== null && loadedFileIds.has(f.linked_file_id),
    ),
    [allFindings, loadedFileIds],
  );

  const markers = useMemo<EntityMarker3D[]>(
    () => findings
      .filter(
        (f) => f.linked_file_type === 'ifc'
          && f.anchor_x != null && f.anchor_y != null && f.anchor_z != null,
      )
      .map((f) => ({
        id: f.id,
        type: 'finding' as const,
        position: { x: f.anchor_x!, y: f.anchor_y!, z: f.anchor_z! },
        modelId: federatedModelId(f.linked_file_id!),
        label: f.title,
        entityId: f.id,
        status: f.status,
      })),
    [findings],
  );

  useEffect(() => {
    if (!handle || !viewerReady || !enabled) return;
    handle.commands.execute('entity-marker.sync', markers).catch(() => undefined);
  }, [handle, viewerReady, enabled, markers]);

  const [clickedFinding, setClickedFinding] = useState<Finding | null>(null);
  useEffect(() => {
    if (!handle || !enabled) return undefined;
    return handle.events.on('entity-marker:click', (ev) => {
      if (ev.type === 'finding') {
        const f = findings.find((x) => x.id === ev.entityId) ?? null;
        if (f) setClickedFinding(f);
      }
    });
  }, [handle, viewerReady, enabled, findings]);

  const clearClicked = (): void => { setClickedFinding(null); };

  return { clickedFinding, clearClicked };
}

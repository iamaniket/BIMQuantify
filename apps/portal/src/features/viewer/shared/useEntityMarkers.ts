'use client';

import { useMemo } from 'react';

import { useFileFindings } from '@/features/findings/useFindings';
import { useFlattenedPages } from '@/lib/query/useAuthInfiniteQuery';

import { federatedModelId } from '../3d/federation/federatedModelId';
import type { EntityMarker2D, EntityMarker3D } from './entityMarkerTypes';
import { useFindingPinPreviewStore } from './findingPinPreviewStore';

export function usePageFindingMarkers(
  projectId: string,
  fileId: string | null,
  page: number | null,
): EntityMarker2D[] {
  const data = useFlattenedPages(useFileFindings(projectId, fileId).data);
  const preview = useFindingPinPreviewStore((s) => s.preview);
  return useMemo(() => {
    const base: EntityMarker2D[] =
      data.length === 0 || page === null
        ? []
        : data
            .filter(
              (f) =>
                f.linked_file_type === 'pdf' &&
                f.anchor_page === page &&
                f.anchor_x != null &&
                f.anchor_y != null,
            )
            .map((f) => ({
              id: f.id,
              type: 'finding' as const,
              x: f.anchor_x!,
              y: f.anchor_y!,
              label: f.title,
              entityId: f.id,
              status: f.status,
            }));

    // Overlay the staged draft pin for the finding being edited (PDF anchors
    // only, on the matching page): drop it on a staged removal, override the
    // server marker's position, or append it if the finding had no prior pin.
    if (preview === null) return base;
    if (preview.anchor === null) return base.filter((m) => m.id !== preview.findingId);
    if (preview.anchor.kind !== 'pdf' || preview.anchor.page !== page) return base;
    const { x, y } = preview.anchor;
    let found = false;
    const merged = base.map((m) =>
      m.id === preview.findingId ? ((found = true), { ...m, x, y, draft: true }) : m,
    );
    if (!found) {
      merged.push({
        id: preview.findingId,
        type: 'finding',
        x,
        y,
        label: preview.label,
        entityId: preview.findingId,
        status: preview.status,
        draft: true,
      });
    }
    return merged;
  }, [data, page, fileId, preview]);
}

export function useModelFindingMarkers(
  projectId: string,
  fileId: string | null,
): EntityMarker3D[] {
  const data = useFlattenedPages(useFileFindings(projectId, fileId).data);
  const preview = useFindingPinPreviewStore((s) => s.preview);
  return useMemo(() => {
    const base: EntityMarker3D[] =
      data.length === 0
        ? []
        : data
            .filter(
              (f) =>
                f.linked_file_type === 'ifc' &&
                f.anchor_x != null &&
                f.anchor_y != null &&
                f.anchor_z != null,
            )
            .map((f) => ({
              id: f.id,
              type: 'finding' as const,
              position: { x: f.anchor_x!, y: f.anchor_y!, z: f.anchor_z! },
              modelId: federatedModelId(fileId ?? ''),
              label: f.title,
              entityId: f.id,
              status: f.status,
            }));

    // Overlay the staged draft pin for the finding being edited (IFC anchors
    // only): drop it on a staged removal, override the server marker's position,
    // or append it if the finding had no prior pin. Keyed by findingId so there
    // is never a double marker. This shared base also feeds the floor-plan hook,
    // so the draft shows on the plan for free.
    if (preview === null) return base;
    if (preview.anchor === null) return base.filter((m) => m.id !== preview.findingId);
    if (preview.anchor.kind !== 'ifc') return base;
    const position = { x: preview.anchor.x, y: preview.anchor.y, z: preview.anchor.z };
    let found = false;
    const merged = base.map((m) =>
      m.id === preview.findingId ? ((found = true), { ...m, position, draft: true }) : m,
    );
    if (!found) {
      merged.push({
        id: preview.findingId,
        type: 'finding',
        position,
        modelId: federatedModelId(fileId ?? ''),
        label: preview.label,
        entityId: preview.findingId,
        status: preview.status,
        draft: true,
      });
    }
    return merged;
  }, [data, fileId, preview]);
}

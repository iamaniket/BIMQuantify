'use client';

import { useMemo } from 'react';

import { useFileFindings } from '@/features/findings/useFindings';
import { flattenPages } from '@/lib/query/useAuthInfiniteQuery';

import type { EntityMarker2D, EntityMarker3D } from './entityMarkerTypes';

export function usePageFindingMarkers(
  projectId: string,
  fileId: string | null,
  page: number | null,
): EntityMarker2D[] {
  const data = flattenPages(useFileFindings(projectId, fileId).data);
  return useMemo(() => {
    if (data.length === 0 || page === null) return [];
    return data
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
      }));
  }, [data, page, fileId]);
}

export function useModelFindingMarkers(
  projectId: string,
  fileId: string | null,
): EntityMarker3D[] {
  const data = flattenPages(useFileFindings(projectId, fileId).data);
  return useMemo(() => {
    if (data.length === 0) return [];
    return data
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
        label: f.title,
        entityId: f.id,
      }));
  }, [data, fileId]);
}

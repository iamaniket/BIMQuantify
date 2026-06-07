'use client';

import { useMemo } from 'react';

import { useFileCertificates } from '@/features/certificates/useCertificates';
import { useFileFindings } from '@/features/findings/useFindings';

import type { EntityMarker2D, EntityMarker3D } from './entityMarkerTypes';

export function usePageFindingMarkers(
  projectId: string,
  fileId: string | null,
  page: number | null,
): EntityMarker2D[] {
  const { data } = useFileFindings(projectId, fileId);
  return useMemo(() => {
    if (!data || page === null) return [];
    if (process.env.NODE_ENV === 'development' && data.length > 0) {
      console.log('[EntityMarkers] PDF findings for file:', fileId, 'page:', page, 'total:', data.length,
        'with anchors:', data.filter((f) => f.linked_file_type === 'pdf' && f.anchor_x != null).length,
        'sample linked_file_type values:', [...new Set(data.map((f) => f.linked_file_type))]);
    }
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

export function usePageCertificateMarkers(
  projectId: string,
  fileId: string | null,
  page: number | null,
): EntityMarker2D[] {
  const { data } = useFileCertificates(projectId, fileId);
  return useMemo(() => {
    if (!data || page === null) return [];
    return data
      .filter(
        (c) =>
          c.linked_file_type === 'pdf' &&
          c.anchor_page === page &&
          c.anchor_x != null &&
          c.anchor_y != null,
      )
      .map((c) => ({
        id: c.id,
        type: 'certificate' as const,
        x: c.anchor_x!,
        y: c.anchor_y!,
        label: c.original_filename,
        entityId: c.id,
      }));
  }, [data, page]);
}

export function useModelFindingMarkers(
  projectId: string,
  fileId: string | null,
): EntityMarker3D[] {
  const { data } = useFileFindings(projectId, fileId);
  return useMemo(() => {
    if (!data) return [];
    if (process.env.NODE_ENV === 'development' && data.length > 0) {
      console.log('[EntityMarkers] IFC findings for file:', fileId, 'total:', data.length, 'with 3D anchors:', data.filter((f) => f.linked_file_type === 'ifc' && f.anchor_x != null && f.anchor_z != null).length);
    }
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

export function useModelCertificateMarkers(
  projectId: string,
  fileId: string | null,
): EntityMarker3D[] {
  const { data } = useFileCertificates(projectId, fileId);
  return useMemo(() => {
    if (!data) return [];
    return data
      .filter(
        (c) =>
          c.linked_file_type === 'ifc' &&
          c.anchor_x != null &&
          c.anchor_y != null &&
          c.anchor_z != null,
      )
      .map((c) => ({
        id: c.id,
        type: 'certificate' as const,
        position: { x: c.anchor_x!, y: c.anchor_y!, z: c.anchor_z! },
        label: c.original_filename,
        entityId: c.id,
      }));
  }, [data]);
}

'use client';

import { useMemo } from 'react';

import { useIfcFileAttachments } from '@/features/attachments/useAttachments';
import { useFileCertificates } from '@/features/certificates/useCertificates';
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
  const data = flattenPages(useFileCertificates(projectId, fileId).data);
  return useMemo(() => {
    if (data.length === 0 || page === null) return [];
    if (process.env.NODE_ENV === 'development' && data.length > 0) {
      console.log('[EntityMarkers] PDF certificates for file:', fileId, 'page:', page, 'total:', data.length,
        'with anchors:', data.filter((c) => c.linked_file_type === 'pdf' && c.anchor_x != null).length,
        'sample linked_file_type values:', [...new Set(data.map((c) => c.linked_file_type))]);
    }
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
  }, [data, page, fileId]);
}

export function useModelFindingMarkers(
  projectId: string,
  fileId: string | null,
): EntityMarker3D[] {
  const data = flattenPages(useFileFindings(projectId, fileId).data);
  return useMemo(() => {
    if (data.length === 0) return [];
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
  const data = flattenPages(useFileCertificates(projectId, fileId).data);
  return useMemo(() => {
    if (data.length === 0) return [];
    if (process.env.NODE_ENV === 'development' && data.length > 0) {
      console.log('[EntityMarkers] IFC certificates for file:', fileId, 'total:', data.length, 'with 3D anchors:', data.filter((c) => c.linked_file_type === 'ifc' && c.anchor_x != null && c.anchor_z != null).length);
    }
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
  }, [data, fileId]);
}

export function useModelAttachmentMarkers(
  projectId: string,
  fileId: string | null,
): EntityMarker3D[] {
  const query = useIfcFileAttachments(projectId, fileId);
  const data = flattenPages(query.data);
  return useMemo(() => {
    if (data.length === 0) return [];
    if (process.env.NODE_ENV === 'development' && data.length > 0) {
      console.log('[EntityMarkers] IFC attachments for file:', fileId, 'total:', data.length, 'with 3D anchors:', data.filter((a) => a.anchor_x != null && a.anchor_z != null).length);
    }
    return data
      .filter(
        (a) =>
          a.linked_file_type === 'ifc' &&
          a.anchor_x != null &&
          a.anchor_y != null &&
          a.anchor_z != null,
      )
      .map((a) => ({
        id: a.id,
        type: 'attachment' as const,
        position: { x: a.anchor_x!, y: a.anchor_y!, z: a.anchor_z! },
        label: a.original_filename,
        entityId: a.id,
      }));
  }, [data, fileId]);
}

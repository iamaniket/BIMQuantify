'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listAttachments } from '@/lib/api/attachments';
import type { AttachmentCategoryValue, AttachmentList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { attachmentsKey, elementAttachmentsKey } from './queryKeys';

export function useAttachments(
  projectId: string,
  category?: AttachmentCategoryValue,
): UseQueryResult<AttachmentList> {
  return useAuthQuery({
    queryKey: [...attachmentsKey(projectId), category ?? 'all'] as const,
    queryFn: (accessToken) => listAttachments(accessToken, projectId, category !== undefined ? { category } : undefined),
  });
}

export function useElementAttachments(
  projectId: string,
  modelId: string,
  globalId: string | null,
): UseQueryResult<AttachmentList> {
  return useAuthQuery({
    queryKey: elementAttachmentsKey(projectId, modelId, globalId ?? ''),
    queryFn: (accessToken) => {
      if (globalId === null) throw new Error('Missing globalId');
      // Version-independent identity: (model, GlobalId), so an attachment
      // follows the element across re-uploaded file versions.
      return listAttachments(accessToken, projectId, {
        linkedModelId: modelId,
        linkedElementGlobalId: globalId,
      });
    },
    enabled: globalId !== null,
    staleTime: 30_000,
  });
}

/**
 * Office documents not yet tagged to a dossier slot — powers the dossier
 * checklist "Link existing" picker.
 */
export function useUnslottedDocuments(
  projectId: string,
  enabled = true,
): UseQueryResult<AttachmentList> {
  return useAuthQuery({
    queryKey: [...attachmentsKey(projectId), 'unslotted', 'office'] as const,
    queryFn: (accessToken) =>
      listAttachments(accessToken, projectId, { unslotted: true, category: 'office' }),
    enabled,
    staleTime: 15_000,
  });
}

export function useProjectAttachments(
  projectId: string,
  enabled = true,
): UseQueryResult<AttachmentList> {
  return useAuthQuery({
    queryKey: [...attachmentsKey(projectId), 'unlinked'] as const,
    queryFn: (accessToken) => listAttachments(accessToken, projectId, { unlinked: true }),
    enabled,
    staleTime: 30_000,
  });
}

export function useProjectAttachmentCount(projectId: string, enabled = true): number {
  return useProjectAttachments(projectId, enabled).data?.length ?? 0;
}

export function useFileAttachmentCount(
  projectId: string,
  fileId: string | null,
): number {
  const query = useAuthQuery({
    queryKey: [...attachmentsKey(projectId), 'file', fileId ?? ''] as const,
    queryFn: (accessToken) => {
      if (fileId === null) throw new Error('Missing fileId');
      return listAttachments(accessToken, projectId, { linkedFileId: fileId });
    },
    enabled: fileId !== null,
    staleTime: 30_000,
  });
  return query.data?.length ?? 0;
}

/**
 * IFC-file-scoped attachments — powers the 3D entity marker overlay.
 * Returns all attachments linked to this IFC file regardless of element.
 */
export function useIfcFileAttachments(
  projectId: string,
  fileId: string | null,
): UseQueryResult<AttachmentList> {
  return useAuthQuery({
    queryKey: [...attachmentsKey(projectId), 'ifc-file', fileId ?? ''] as const,
    queryFn: (accessToken) => {
      if (fileId === null) throw new Error('Missing fileId');
      return listAttachments(accessToken, projectId, {
        linkedFileId: fileId,
        linkedFileType: 'ifc',
      });
    },
    enabled: fileId !== null,
    staleTime: 30_000,
  });
}

/**
 * Page-scoped attachments — ONLY for the in-canvas pin overlay
 * (`AnnotationPinLayer`), which renders pins for the visible page. Don't
 * reuse this for inspector listings; use `usePdfFileAttachments` instead.
 */
export function usePdfPageAttachments(
  projectId: string,
  fileId: string,
  page: number | null,
): UseQueryResult<AttachmentList> {
  return useAuthQuery({
    queryKey: [...attachmentsKey(projectId), 'pdf-page', fileId, page ?? 0] as const,
    queryFn: (accessToken) => {
      if (page === null) throw new Error('Missing page');
      return listAttachments(accessToken, projectId, {
        linkedFileId: fileId,
        linkedFileType: 'pdf',
        anchorPage: page,
      });
    },
    enabled: page !== null,
    staleTime: 30_000,
  });
}

/**
 * File-scoped attachments for the PDF inspector — every attachment linked to
 * this PDF, regardless of whether it's pinned to a specific page. Mirrors
 * `useFileFindings` / `useFileCertificates`.
 */
export function usePdfFileAttachments(
  projectId: string,
  fileId: string | null,
): UseQueryResult<AttachmentList> {
  return useAuthQuery({
    queryKey: [...attachmentsKey(projectId), 'pdf-file', fileId ?? ''] as const,
    queryFn: (accessToken) => {
      if (fileId === null) throw new Error('Missing fileId');
      return listAttachments(accessToken, projectId, {
        linkedFileId: fileId,
        linkedFileType: 'pdf',
      });
    },
    enabled: fileId !== null,
    staleTime: 30_000,
  });
}

/** File-scoped attachment count — drives the PDF inspector's Attachments tab
 * pill. Shares the cache entry with usePdfFileAttachments. */
export function usePdfFileAttachmentCount(
  projectId: string,
  fileId: string | null,
): number {
  return usePdfFileAttachments(projectId, fileId).data?.length ?? 0;
}

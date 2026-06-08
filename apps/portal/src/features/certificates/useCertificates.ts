'use client';

import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';

import { listCertificates } from '@/lib/api/certificates';
import type { PaginatedResponse } from '@/lib/api/client';
import type { Certificate, CertificateTypeValue } from '@/lib/api/schemas';
import { useAuthInfiniteQuery, totalFromPages } from '@/lib/query/useAuthInfiniteQuery';

import { certificatesKey, projectCertificatesKey } from './queryKeys';

export function useCertificates(
  projectId: string,
  certificateType?: CertificateTypeValue,
): UseInfiniteQueryResult<InfiniteData<PaginatedResponse<Certificate[]>>> {
  return useAuthInfiniteQuery({
    queryKey: [...certificatesKey(projectId), certificateType ?? 'all'] as const,
    queryFn: (accessToken, offset, limit) =>
      listCertificates(
        accessToken,
        projectId,
        certificateType !== undefined ? { certificateType, limit, offset } : { limit, offset },
      ),
  });
}

export function useProjectCertificates(
  projectId: string,
  enabled = true,
): UseInfiniteQueryResult<InfiniteData<PaginatedResponse<Certificate[]>>> {
  return useAuthInfiniteQuery({
    queryKey: projectCertificatesKey(projectId),
    queryFn: (accessToken, offset, limit) =>
      listCertificates(accessToken, projectId, { unlinked: true, limit, offset }),
    enabled,
  });
}

export function useProjectCertificateCount(projectId: string, enabled = true): number {
  const query = useProjectCertificates(projectId, enabled);
  return totalFromPages(query.data);
}

/** File-scoped certificates — those linked to a given file (e.g. a PDF
 * document). Shown in the viewer inspector when a PDF is open (no element to
 * anchor to), mirroring useFileFindings. */
export function useFileCertificates(
  projectId: string,
  fileId: string | null,
): UseInfiniteQueryResult<InfiniteData<PaginatedResponse<Certificate[]>>> {
  return useAuthInfiniteQuery({
    queryKey: [...certificatesKey(projectId), 'file', fileId ?? ''] as const,
    queryFn: (accessToken, offset, limit) => {
      if (fileId === null) throw new Error('Missing fileId');
      return listCertificates(accessToken, projectId, { linkedFileId: fileId, limit, offset });
    },
    enabled: fileId !== null,
  });
}

export function useFileCertificateCount(
  projectId: string,
  fileId: string | null,
): number {
  const query = useFileCertificates(projectId, fileId);
  return totalFromPages(query.data);
}

'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listCertificates } from '@/lib/api/certificates';
import type { CertificateList, CertificateTypeValue } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { certificatesKey, projectCertificatesKey } from './queryKeys';

export function useCertificates(
  projectId: string,
  certificateType?: CertificateTypeValue,
): UseQueryResult<CertificateList> {
  return useAuthQuery({
    queryKey: [...certificatesKey(projectId), certificateType ?? 'all'] as const,
    queryFn: (accessToken) =>
      listCertificates(
        accessToken,
        projectId,
        certificateType !== undefined ? { certificateType } : undefined,
      ),
  });
}

export function useProjectCertificates(
  projectId: string,
  enabled = true,
): UseQueryResult<CertificateList> {
  return useAuthQuery({
    queryKey: projectCertificatesKey(projectId),
    queryFn: (accessToken) => listCertificates(accessToken, projectId, { unlinked: true }),
    enabled,
    staleTime: 30_000,
  });
}

export function useProjectCertificateCount(projectId: string, enabled = true): number {
  return useProjectCertificates(projectId, enabled).data?.length ?? 0;
}

/** File-scoped certificates — those linked to a given file (e.g. a PDF
 * document). Shown in the viewer inspector when a PDF is open (no element to
 * anchor to), mirroring useFileFindings. */
export function useFileCertificates(
  projectId: string,
  fileId: string | null,
): UseQueryResult<CertificateList> {
  return useAuthQuery({
    queryKey: [...certificatesKey(projectId), 'file', fileId ?? ''] as const,
    queryFn: (accessToken) => {
      if (fileId === null) throw new Error('Missing fileId');
      return listCertificates(accessToken, projectId, { linkedFileId: fileId });
    },
    enabled: fileId !== null,
    staleTime: 30_000,
  });
}

export function useFileCertificateCount(
  projectId: string,
  fileId: string | null,
): number {
  return useFileCertificates(projectId, fileId).data?.length ?? 0;
}

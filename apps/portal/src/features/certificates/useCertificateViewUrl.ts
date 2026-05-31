'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { getCertificateViewUrl } from '@/lib/api/certificates';
import type { CertificateDownloadResponse } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { certificateViewUrlKey } from './queryKeys';

/** Presigned inline-disposition URL for previewing a certificate in the viewer dialog. */
export function useCertificateViewUrl(
  projectId: string,
  certificateId: string | null,
): UseQueryResult<CertificateDownloadResponse> {
  return useAuthQuery({
    queryKey: certificateViewUrlKey(projectId, certificateId ?? ''),
    queryFn: (accessToken) => {
      if (certificateId === null) throw new Error('Missing certificateId');
      return getCertificateViewUrl(accessToken, projectId, certificateId);
    },
    enabled: certificateId !== null,
    staleTime: 10 * 60 * 1000,
  });
}

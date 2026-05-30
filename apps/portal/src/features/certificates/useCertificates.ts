'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listCertificates } from '@/lib/api/certificates';
import type { CertificateList, CertificateTypeValue } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { certificatesKey } from './queryKeys';

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

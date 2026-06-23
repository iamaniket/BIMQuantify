'use client';

import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';

import { listCertificates } from '@/lib/api/certificates';
import type { PaginatedResponse } from '@/lib/api/client';
import type { Certificate, CertificateTypeValue } from '@/lib/api/schemas';
import { useAuthInfiniteQuery } from '@/lib/query/useAuthInfiniteQuery';

import { certificatesKey } from './queryKeys';

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

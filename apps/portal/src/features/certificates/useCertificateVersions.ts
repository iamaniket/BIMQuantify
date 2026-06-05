'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listCertificateVersions } from '@/lib/api/certificates';
import type { CertificateList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { certificateVersionsKey } from './queryKeys';

/** Full version history of one logical certificate, newest version first (#35).
 * `certificateId` may be any version in the group; the head is the first item.
 * Pass `null` / `enabled = false` to keep the query idle (e.g. dialog closed). */
export function useCertificateVersions(
  projectId: string,
  certificateId: string | null,
): UseQueryResult<CertificateList> {
  return useAuthQuery({
    queryKey: certificateVersionsKey(projectId, certificateId ?? ''),
    queryFn: (accessToken) => {
      if (certificateId === null) throw new Error('Missing certificateId');
      return listCertificateVersions(accessToken, projectId, certificateId);
    },
    enabled: certificateId !== null,
    staleTime: 30_000,
  });
}

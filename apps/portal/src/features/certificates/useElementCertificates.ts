'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listCertificates } from '@/lib/api/certificates';
import type { CertificateList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { elementCertificatesKey } from './queryKeys';

export function useElementCertificates(
  projectId: string,
  modelId: string,
  globalId: string | null,
): UseQueryResult<CertificateList> {
  return useAuthQuery({
    queryKey: elementCertificatesKey(projectId, modelId, globalId ?? ''),
    queryFn: (accessToken) => {
      if (globalId === null) throw new Error('Missing globalId');
      // Version-independent identity: (model, GlobalId), so a certificate
      // follows the element across re-uploaded file versions.
      return listCertificates(accessToken, projectId, {
        linkedModelId: modelId,
        linkedElementGlobalId: globalId,
      });
    },
    enabled: globalId !== null,
    staleTime: 30_000,
  });
}

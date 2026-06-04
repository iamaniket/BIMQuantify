'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { linkFromLibrary } from '@/lib/api/orgCertificates';
import type { Certificate } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';
import { certificatesKey } from '@/features/certificates/queryKeys';

export function useLinkFromLibrary(
  projectId: string,
): UseMutationResult<Certificate, Error, string> {
  return useAuthMutation({
    mutationFn: (accessToken, orgCertificateId) =>
      linkFromLibrary(accessToken, projectId, orgCertificateId),
    invalidateKeys: [certificatesKey(projectId)],
  });
}

'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { deleteOrgCertificate } from '@/lib/api/orgCertificates';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { orgCertificatesKey, orgCertificateStatsKey } from './queryKeys';

export function useDeleteOrgCertificate(): UseMutationResult<void, Error, string> {
  return useAuthMutation({
    mutationFn: (accessToken, certificateId) =>
      deleteOrgCertificate(accessToken, certificateId),
    invalidateKeys: [orgCertificatesKey(), orgCertificateStatsKey()],
  });
}

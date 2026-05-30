'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { deleteCertificate } from '@/lib/api/certificates';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { certificatesKey } from './queryKeys';

export function useDeleteCertificate(
  projectId: string,
): UseMutationResult<void, Error, string> {
  return useAuthMutation({
    mutationFn: (accessToken, certificateId) =>
      deleteCertificate(accessToken, projectId, certificateId),
    invalidateKeys: [certificatesKey(projectId)],
  });
}

'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { importBcf } from '@/lib/api/bcf';
import type { BcfImportResponse } from '@/lib/api/schemas/bcf';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { bcfKeys } from './queryKeys';

export function useImportBcf(
  projectId: string,
): UseMutationResult<BcfImportResponse, Error, File> {
  return useAuthMutation({
    mutationFn: (accessToken, file) => importBcf(accessToken, projectId, file),
    invalidateKeys: [bcfKeys.list(projectId)],
  });
}

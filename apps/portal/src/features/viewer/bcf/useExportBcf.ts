'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { exportBcf } from '@/lib/api/bcf';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

export function useExportBcf(
  projectId: string,
): UseMutationResult<void, Error, void> {
  return useAuthMutation({
    mutationFn: (accessToken) => exportBcf(accessToken, projectId),
  });
}

'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { deleteOrganization } from '@/lib/api/admin';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { adminOrganizationsKey } from './queryKeys';

export function useDeleteOrganization(): UseMutationResult<void, Error, string> {
  return useAuthMutation({
    mutationFn: (accessToken, id) => deleteOrganization(accessToken, id),
    invalidateKeys: [adminOrganizationsKey],
  });
}

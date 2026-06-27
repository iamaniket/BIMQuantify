'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { purgeOrganization } from '@/lib/api/admin';
import type { OrganizationRead } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { adminOrganizationsKey } from './queryKeys';

export function usePurgeOrganization(): UseMutationResult<OrganizationRead, Error, string> {
  return useAuthMutation({
    mutationFn: (accessToken, id) => purgeOrganization(accessToken, id),
    invalidateKeys: [adminOrganizationsKey],
  });
}

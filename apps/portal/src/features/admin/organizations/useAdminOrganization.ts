'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { getOrganization } from '@/lib/api/admin';
import type { OrganizationRead } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { adminOrganizationKey } from './queryKeys';

export function useAdminOrganization(
  id: string,
): UseQueryResult<OrganizationRead> {
  return useAuthQuery({
    queryKey: adminOrganizationKey(id),
    queryFn: (accessToken) => getOrganization(accessToken, id),
  });
}

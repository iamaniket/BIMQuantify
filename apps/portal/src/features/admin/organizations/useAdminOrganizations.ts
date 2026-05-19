'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listOrganizations, type ListOrganizationsParams } from '@/lib/api/admin';
import type { OrganizationRead } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { adminOrganizationsListKey } from './queryKeys';

export function useAdminOrganizations(
  params: ListOrganizationsParams = {},
): UseQueryResult<OrganizationRead[]> {
  return useAuthQuery({
    queryKey: adminOrganizationsListKey(params),
    queryFn: (accessToken) => listOrganizations(accessToken, params),
  });
}

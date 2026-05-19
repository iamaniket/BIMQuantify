'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listAdminUsers, type ListAdminUsersParams } from '@/lib/api/admin';
import type { AdminUserRead } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { adminUsersListKey } from './queryKeys';

export function useAdminUsers(
  params: ListAdminUsersParams = {},
): UseQueryResult<AdminUserRead[]> {
  return useAuthQuery({
    queryKey: adminUsersListKey(params),
    queryFn: (accessToken) => listAdminUsers(accessToken, params),
  });
}

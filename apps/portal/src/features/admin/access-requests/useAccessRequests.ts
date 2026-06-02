'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listAccessRequests, type ListAccessRequestsParams } from '@/lib/api/admin';
import type { AccessRequestRead } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { adminAccessRequestsListKey } from './queryKeys';

export function useAccessRequests(
  params: ListAccessRequestsParams = {},
): UseQueryResult<AccessRequestRead[]> {
  return useAuthQuery({
    queryKey: adminAccessRequestsListKey(params),
    queryFn: (accessToken) => listAccessRequests(accessToken, params),
  });
}

'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listMembers, type ListMembersParams } from '@/lib/api/members';
import type { MemberRead } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { orgMembersKey } from './queryKeys';

export function useOrgMembers(
  organizationId: string,
  params: ListMembersParams = {},
): UseQueryResult<MemberRead[]> {
  return useAuthQuery({
    queryKey: [...orgMembersKey(organizationId), params] as const,
    queryFn: (accessToken) => listMembers(accessToken, organizationId, params),
  });
}

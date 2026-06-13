'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listSelectableMembers } from '@/lib/api/members';
import type { SelectableMember } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { selectableOrgMembersKey } from './queryKeys';

/** Active, non-guest org members for "add member" pickers. Callable by any
 * active member (the full `useOrgMembers` list is org-admin only), so a
 * non-admin project creator or owner can populate the selection dropdown. */
export function useSelectableOrgMembers(
  organizationId: string | null,
): UseQueryResult<SelectableMember[]> {
  return useAuthQuery({
    queryKey: selectableOrgMembersKey(organizationId ?? 'none'),
    queryFn: (accessToken) => listSelectableMembers(accessToken, organizationId ?? ''),
    enabled: organizationId !== null,
  });
}

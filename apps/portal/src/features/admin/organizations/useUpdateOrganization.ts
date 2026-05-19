'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { updateOrganization } from '@/lib/api/admin';
import type { OrganizationRead, OrganizationUpdateInput } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { adminOrganizationKey, adminOrganizationsKey } from './queryKeys';

type Variables = { id: string; input: OrganizationUpdateInput };

export function useUpdateOrganization(): UseMutationResult<
  OrganizationRead,
  Error,
  Variables
  > {
  return useAuthMutation({
    mutationFn: (accessToken, { id, input }) => updateOrganization(accessToken, id, input),
    invalidateKeys: ({ id }) => [adminOrganizationsKey, adminOrganizationKey(id)],
  });
}

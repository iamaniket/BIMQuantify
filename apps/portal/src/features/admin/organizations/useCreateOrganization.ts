'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { createOrganization } from '@/lib/api/admin';
import type { OrganizationCreateInput, OrganizationCreateResponse } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { adminOrganizationsKey } from './queryKeys';

export function useCreateOrganization(): UseMutationResult<
  OrganizationCreateResponse,
  Error,
  OrganizationCreateInput
  > {
  return useAuthMutation({
    mutationFn: (accessToken, input) => createOrganization(accessToken, input),
    invalidateKeys: [adminOrganizationsKey],
  });
}

'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { createContractor } from '@/lib/api/contractors';
import type { Contractor, ContractorCreateInput } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { contractorsKey } from './queryKeys';

export function useCreateContractor(): UseMutationResult<Contractor, Error, ContractorCreateInput> {
  return useAuthMutation({
    mutationFn: (accessToken, input) => createContractor(accessToken, input),
    invalidateKeys: [contractorsKey],
  });
}

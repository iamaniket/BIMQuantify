'use client';

import {
  useMutation, useQueryClient, type UseMutationResult,
} from '@tanstack/react-query';

import { createContractor } from '@/lib/api/contractors';
import type { Contractor, ContractorCreateInput } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { contractorsKey } from './queryKeys';

export function useCreateContractor(): UseMutationResult<Contractor, Error, ContractorCreateInput> {
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;
  const queryClient = useQueryClient();

  return useMutation<Contractor, Error, ContractorCreateInput>({
    mutationFn: async (input) => {
      if (accessToken === null) {
        throw new Error('Not authenticated');
      }
      return createContractor(accessToken, input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: contractorsKey });
    },
  });
}

'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { listContractors } from '@/lib/api/contractors';
import type { ContractorList } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { contractorsKey } from './queryKeys';

export function useContractors(): UseQueryResult<ContractorList> {
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;

  return useQuery({
    queryKey: contractorsKey,
    queryFn: async (): Promise<ContractorList> => {
      if (accessToken === null) {
        throw new Error('Not authenticated');
      }
      return listContractors(accessToken);
    },
    enabled: accessToken !== null,
  });
}

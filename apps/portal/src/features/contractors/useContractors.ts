'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listContractors } from '@/lib/api/contractors';
import type { ContractorList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { contractorsKey } from './queryKeys';

export function useContractors(): UseQueryResult<ContractorList> {
  return useAuthQuery({
    queryKey: contractorsKey,
    queryFn: (accessToken) => listContractors(accessToken),
  });
}

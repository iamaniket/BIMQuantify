'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listFindingTemplates } from '@/lib/api/findingTemplates';
import type { FindingTemplateList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { findingTemplatesKey } from './queryKeys';

export function useFindingTemplates(): UseQueryResult<FindingTemplateList> {
  return useAuthQuery({
    queryKey: findingTemplatesKey(),
    queryFn: (accessToken) => listFindingTemplates(accessToken),
    staleTime: 60_000,
  });
}

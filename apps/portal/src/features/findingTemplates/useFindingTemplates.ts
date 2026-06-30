'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { useIsFreeUser } from '@/hooks/useIsFreeUser';
import { listFindingTemplates } from '@/lib/api/findingTemplates';
import type { FindingTemplateList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { findingTemplatesKey } from './queryKeys';

export function useFindingTemplates(): UseQueryResult<FindingTemplateList> {
  // Finding templates are an org-only feature — there is no `/free/*` templates
  // endpoint, so a free (org-less) user hitting `/org-templates` 409s. Gate the
  // query off for free users; `EntityFindingsBody` degrades to the standard form.
  // `ready` keeps it disabled until the free context is known, avoiding a 409 flash.
  const { isFreeUser, ready } = useIsFreeUser();
  return useAuthQuery({
    queryKey: findingTemplatesKey(),
    queryFn: (accessToken) => listFindingTemplates(accessToken),
    enabled: ready && !isFreeUser,
    staleTime: 60_000,
  });
}

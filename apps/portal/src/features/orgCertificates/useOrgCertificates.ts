'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { useIsPooledContext } from '@/hooks/useIsPooledContext';
import { listOrgCertificates, getOrgCertificateStats } from '@/lib/api/orgCertificates';
import type { OrgCertificateList, OrgCertificateStats, CertificateTypeValue } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { orgCertificatesKey, orgCertificateStatsKey } from './queryKeys';

// The org certificate library is org-scoped (`/org-certificates`, behind
// `require_active_organization`) — a free (org-less) caller 409s
// (`NO_ACTIVE_ORGANIZATION`). Gate both hooks on free context so the query never
// fires; `ready` avoids a 409 flash before `/auth/me` resolves the context.
export function useOrgCertificates(
  certificateType?: CertificateTypeValue,
  search?: string,
): UseQueryResult<OrgCertificateList> {
  const { isPooled, ready } = useIsPooledContext();
  return useAuthQuery({
    queryKey: [...orgCertificatesKey(), certificateType ?? 'all', search ?? ''] as const,
    queryFn: (accessToken) => {
      const filters: Parameters<typeof listOrgCertificates>[1] = {};
      if (certificateType !== undefined) filters.certificateType = certificateType;
      if (search !== undefined && search.length > 0) filters.search = search;
      return listOrgCertificates(accessToken, filters);
    },
    enabled: ready && !isPooled,
  });
}

export function useOrgCertificateStats(): UseQueryResult<OrgCertificateStats> {
  const { isPooled, ready } = useIsPooledContext();
  return useAuthQuery({
    queryKey: orgCertificateStatsKey(),
    queryFn: (accessToken) => getOrgCertificateStats(accessToken),
    enabled: ready && !isPooled,
    staleTime: 60_000,
  });
}

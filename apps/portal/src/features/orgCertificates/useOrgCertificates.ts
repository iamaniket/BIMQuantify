'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listOrgCertificates, getOrgCertificateStats } from '@/lib/api/orgCertificates';
import type { OrgCertificateList, OrgCertificateStats, CertificateTypeValue } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { orgCertificatesKey, orgCertificateStatsKey } from './queryKeys';

export function useOrgCertificates(
  certificateType?: CertificateTypeValue,
  search?: string,
): UseQueryResult<OrgCertificateList> {
  return useAuthQuery({
    queryKey: [...orgCertificatesKey(), certificateType ?? 'all', search ?? ''] as const,
    queryFn: (accessToken) => {
      const filters: Parameters<typeof listOrgCertificates>[1] = {};
      if (certificateType !== undefined) filters.certificateType = certificateType;
      if (search !== undefined && search.length > 0) filters.search = search;
      return listOrgCertificates(accessToken, filters);
    },
  });
}

export function useOrgCertificateStats(): UseQueryResult<OrgCertificateStats> {
  return useAuthQuery({
    queryKey: orgCertificateStatsKey(),
    queryFn: (accessToken) => getOrgCertificateStats(accessToken),
    staleTime: 60_000,
  });
}

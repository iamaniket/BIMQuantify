'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import {
  listOrgAuditLog,
  type ListAuditLogParams,
} from '@/lib/api/admin';
import type { AuditEntry } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

export function useOrgAuditLog(
  organizationId: string,
  params: Omit<ListAuditLogParams, 'organization_id'> = {},
): UseQueryResult<AuditEntry[]> {
  return useAuthQuery({
    queryKey: ['admin', 'audit-log', 'org', organizationId, params] as const,
    queryFn: (accessToken) => listOrgAuditLog(accessToken, organizationId, params),
  });
}

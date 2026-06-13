'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { getPermissionMatrix } from '@/lib/api/permissions';
import type { PermissionMatrix } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { permissionMatrixKey } from './queryKeys';

/**
 * The role -> resource -> actions matrix, served verbatim from the API. It's
 * static reference data (only changes on deploy), so it's cached for the whole
 * session — one fetch, shared across every gating call site.
 */
export function usePermissionMatrix(): UseQueryResult<PermissionMatrix> {
  return useAuthQuery({
    queryKey: permissionMatrixKey,
    queryFn: (accessToken) => getPermissionMatrix(accessToken),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

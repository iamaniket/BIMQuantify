'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listBcfMarkup2d } from '@/lib/api/bcf';
import type { BcfMarkup2DItem } from '@/lib/api/schemas/bcf';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { bcfKeys } from './queryKeys';

/** All 2D markup topics linked to a PDF file (for rendering on the page). */
export function useBcfMarkup2d(
  projectId: string,
  fileId: string | null,
  enabled: boolean,
): UseQueryResult<BcfMarkup2DItem[]> {
  return useAuthQuery({
    queryKey: bcfKeys.markup2d(projectId, fileId ?? '__none__'),
    queryFn: (accessToken) => listBcfMarkup2d(accessToken, projectId, fileId as string),
    enabled: enabled && fileId !== null,
    staleTime: 30_000,
  });
}

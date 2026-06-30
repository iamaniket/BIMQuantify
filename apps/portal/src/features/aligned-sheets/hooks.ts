'use client';

import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import {
  type AlignedSheetFilters,
  calibrateAlignedSheet,
  createAlignedSheet,
  deleteAlignedSheet,
  listAlignedSheets,
  updateAlignedSheet,
} from '@/lib/api/alignedSheets';
import type {
  AlignedSheet,
  AlignedSheetCreateInput,
  AlignedSheetList,
  AlignedSheetUpdateInput,
  CalibrateAlignedSheetInput,
} from '@/lib/api/schemas';
import { useIsPooledContext } from '@/hooks/useIsPooledContext';
import { useAuthMutation, useAuthQuery } from '@/lib/query/useAuthQuery';

import { alignedSheetsKey } from './queryKeys';

/** Free-aware: free projects now have their own pooled aligned sheets
 * (`/pooled/projects/{id}/aligned-sheets`, same schema with a null page_id), so
 * both tiers fetch the real list. The free list is unfiltered (small; the caller
 * filters client-side). */
export function useAlignedSheets(
  projectId: string,
  filters: AlignedSheetFilters = {},
): UseQueryResult<AlignedSheetList> {
  const { isPooled, ready } = useIsPooledContext();
  return useAuthQuery({
    // Filter values are part of the cache key so each scope caches separately.
    queryKey: [
      ...alignedSheetsKey(projectId),
      filters.modelId ?? null,
      filters.levelId ?? null,
      filters.pdfModelId ?? null,
    ] as const,
    queryFn: (accessToken) => listAlignedSheets(accessToken, projectId, filters, isPooled),
    // `ready` defers the fetch until /auth/me resolves the free/paid branch (409).
    enabled: ready && projectId.length > 0,
  });
}

type CreateInput = { projectId: string; input: AlignedSheetCreateInput };

export function useCreateAlignedSheet(): UseMutationResult<
  AlignedSheet,
  Error,
  CreateInput
> {
  const { isPooled } = useIsPooledContext();
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, input }) =>
      createAlignedSheet(accessToken, projectId, input, isPooled),
    invalidateKeys: ({ projectId }) => [alignedSheetsKey(projectId)],
  });
}

type UpdateInput = {
  projectId: string;
  sheetId: string;
  input: AlignedSheetUpdateInput;
};

export function useUpdateAlignedSheet(): UseMutationResult<
  AlignedSheet,
  Error,
  UpdateInput
> {
  const { isPooled } = useIsPooledContext();
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, sheetId, input }) =>
      updateAlignedSheet(accessToken, projectId, sheetId, input, isPooled),
    invalidateKeys: ({ projectId }) => [alignedSheetsKey(projectId)],
  });
}

type CalibrateInput = {
  projectId: string;
  sheetId: string;
  input: CalibrateAlignedSheetInput;
};

export function useCalibrateAlignedSheet(): UseMutationResult<
  AlignedSheet,
  Error,
  CalibrateInput
> {
  const { isPooled } = useIsPooledContext();
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, sheetId, input }) =>
      calibrateAlignedSheet(accessToken, projectId, sheetId, input, isPooled),
    invalidateKeys: ({ projectId }) => [alignedSheetsKey(projectId)],
  });
}

type DeleteInput = { projectId: string; sheetId: string };

export function useDeleteAlignedSheet(): UseMutationResult<
  void,
  Error,
  DeleteInput
> {
  const { isPooled } = useIsPooledContext();
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, sheetId }) =>
      deleteAlignedSheet(accessToken, projectId, sheetId, isPooled),
    invalidateKeys: ({ projectId }) => [alignedSheetsKey(projectId)],
  });
}

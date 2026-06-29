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
import {
  calibrateFreeAlignedSheet,
  createFreeAlignedSheet,
  deleteFreeAlignedSheet,
  listFreeAlignedSheets,
  updateFreeAlignedSheet,
} from '@/lib/api/freeAlignedSheets';
import type {
  AlignedSheet,
  AlignedSheetCreateInput,
  AlignedSheetList,
  AlignedSheetUpdateInput,
  CalibrateAlignedSheetInput,
} from '@/lib/api/schemas';
import { useIsFreeUser } from '@/hooks/useIsFreeUser';
import { useAuthMutation, useAuthQuery } from '@/lib/query/useAuthQuery';

import { alignedSheetsKey } from './queryKeys';

/** Free-aware: free projects now have their own pooled aligned sheets
 * (`/free/projects/{id}/aligned-sheets`, same schema with a null page_id), so
 * both tiers fetch the real list. The free list is unfiltered (small; the caller
 * filters client-side). */
export function useAlignedSheets(
  projectId: string,
  filters: AlignedSheetFilters = {},
): UseQueryResult<AlignedSheetList> {
  const { isFreeUser } = useIsFreeUser();
  return useAuthQuery({
    // Filter values are part of the cache key so each scope caches separately.
    queryKey: [
      ...alignedSheetsKey(projectId),
      filters.modelId ?? null,
      filters.levelId ?? null,
      filters.pdfModelId ?? null,
    ] as const,
    queryFn: (accessToken) =>
      isFreeUser
        ? listFreeAlignedSheets(accessToken, projectId)
        : listAlignedSheets(accessToken, projectId, filters),
    enabled: projectId.length > 0,
  });
}

type CreateInput = { projectId: string; input: AlignedSheetCreateInput };

export function useCreateAlignedSheet(): UseMutationResult<
  AlignedSheet,
  Error,
  CreateInput
> {
  const { isFreeUser } = useIsFreeUser();
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, input }) =>
      isFreeUser
        ? createFreeAlignedSheet(accessToken, projectId, input)
        : createAlignedSheet(accessToken, projectId, input),
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
  const { isFreeUser } = useIsFreeUser();
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, sheetId, input }) =>
      isFreeUser
        ? updateFreeAlignedSheet(accessToken, projectId, sheetId, input)
        : updateAlignedSheet(accessToken, projectId, sheetId, input),
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
  const { isFreeUser } = useIsFreeUser();
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, sheetId, input }) =>
      isFreeUser
        ? calibrateFreeAlignedSheet(accessToken, projectId, sheetId, input)
        : calibrateAlignedSheet(accessToken, projectId, sheetId, input),
    invalidateKeys: ({ projectId }) => [alignedSheetsKey(projectId)],
  });
}

type DeleteInput = { projectId: string; sheetId: string };

export function useDeleteAlignedSheet(): UseMutationResult<
  void,
  Error,
  DeleteInput
> {
  const { isFreeUser } = useIsFreeUser();
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, sheetId }) =>
      isFreeUser
        ? deleteFreeAlignedSheet(accessToken, projectId, sheetId)
        : deleteAlignedSheet(accessToken, projectId, sheetId),
    invalidateKeys: ({ projectId }) => [alignedSheetsKey(projectId)],
  });
}

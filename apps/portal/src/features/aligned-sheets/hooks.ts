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
import { useAuthMutation, useAuthQuery } from '@/lib/query/useAuthQuery';

import { alignedSheetsKey } from './queryKeys';

export function useAlignedSheets(
  projectId: string,
  filters: AlignedSheetFilters = {},
): UseQueryResult<AlignedSheetList> {
  return useAuthQuery({
    // Filter values are part of the cache key so each scope caches separately.
    queryKey: [
      ...alignedSheetsKey(projectId),
      filters.modelId ?? null,
      filters.levelId ?? null,
      filters.pdfModelId ?? null,
    ] as const,
    queryFn: (accessToken) => listAlignedSheets(accessToken, projectId, filters),
    enabled: projectId.length > 0,
  });
}

type CreateInput = { projectId: string; input: AlignedSheetCreateInput };

export function useCreateAlignedSheet(): UseMutationResult<
  AlignedSheet,
  Error,
  CreateInput
> {
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, input }) =>
      createAlignedSheet(accessToken, projectId, input),
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
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, sheetId, input }) =>
      updateAlignedSheet(accessToken, projectId, sheetId, input),
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
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, sheetId, input }) =>
      calibrateAlignedSheet(accessToken, projectId, sheetId, input),
    invalidateKeys: ({ projectId }) => [alignedSheetsKey(projectId)],
  });
}

type DeleteInput = { projectId: string; sheetId: string };

export function useDeleteAlignedSheet(): UseMutationResult<
  void,
  Error,
  DeleteInput
> {
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, sheetId }) =>
      deleteAlignedSheet(accessToken, projectId, sheetId),
    invalidateKeys: ({ projectId }) => [alignedSheetsKey(projectId)],
  });
}

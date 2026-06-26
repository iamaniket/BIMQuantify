'use client';

import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import {
  createLevel,
  deleteLevel,
  listLevels,
  updateLevel,
} from '@/lib/api/levels';
import type {
  Level,
  LevelCreateInput,
  LevelList,
  LevelUpdateInput,
} from '@/lib/api/schemas';
import { useAuthMutation, useAuthQuery } from '@/lib/query/useAuthQuery';

import { levelsKey } from './queryKeys';

export function useProjectLevels(projectId: string): UseQueryResult<LevelList> {
  return useAuthQuery({
    queryKey: levelsKey(projectId),
    queryFn: (accessToken) => listLevels(accessToken, projectId),
    enabled: projectId.length > 0,
  });
}

type CreateInput = { projectId: string; input: LevelCreateInput };

export function useCreateLevel(): UseMutationResult<Level, Error, CreateInput> {
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, input }) =>
      createLevel(accessToken, projectId, input),
    invalidateKeys: ({ projectId }) => [levelsKey(projectId)],
  });
}

type UpdateInput = { projectId: string; levelId: string; input: LevelUpdateInput };

export function useUpdateLevel(): UseMutationResult<Level, Error, UpdateInput> {
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, levelId, input }) =>
      updateLevel(accessToken, projectId, levelId, input),
    invalidateKeys: ({ projectId }) => [levelsKey(projectId)],
  });
}

type DeleteInput = { projectId: string; levelId: string };

export function useDeleteLevel(): UseMutationResult<void, Error, DeleteInput> {
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, levelId }) =>
      deleteLevel(accessToken, projectId, levelId),
    invalidateKeys: ({ projectId }) => [levelsKey(projectId)],
  });
}

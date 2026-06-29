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
import { useIsFreeUser } from '@/hooks/useIsFreeUser';
import { useAuthMutation, useAuthQuery } from '@/lib/query/useAuthQuery';

import { levelsKey } from './queryKeys';

/** Free-aware: free projects now have their own pooled Levels (`/free/projects/
 * {id}/levels`, identical paid schema), so both tiers fetch the real list. */
export function useProjectLevels(projectId: string): UseQueryResult<LevelList> {
  const { isFreeUser } = useIsFreeUser();
  return useAuthQuery({
    queryKey: levelsKey(projectId),
    queryFn: (accessToken) => listLevels(accessToken, projectId, isFreeUser),
    enabled: projectId.length > 0,
  });
}

type CreateInput = { projectId: string; input: LevelCreateInput };

export function useCreateLevel(): UseMutationResult<Level, Error, CreateInput> {
  const { isFreeUser } = useIsFreeUser();
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, input }) =>
      createLevel(accessToken, projectId, input, isFreeUser),
    invalidateKeys: ({ projectId }) => [levelsKey(projectId)],
  });
}

type UpdateInput = { projectId: string; levelId: string; input: LevelUpdateInput };

export function useUpdateLevel(): UseMutationResult<Level, Error, UpdateInput> {
  const { isFreeUser } = useIsFreeUser();
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, levelId, input }) =>
      updateLevel(accessToken, projectId, levelId, input, isFreeUser),
    invalidateKeys: ({ projectId }) => [levelsKey(projectId)],
  });
}

type DeleteInput = { projectId: string; levelId: string };

export function useDeleteLevel(): UseMutationResult<void, Error, DeleteInput> {
  const { isFreeUser } = useIsFreeUser();
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, levelId }) =>
      deleteLevel(accessToken, projectId, levelId, isFreeUser),
    invalidateKeys: ({ projectId }) => [levelsKey(projectId)],
  });
}

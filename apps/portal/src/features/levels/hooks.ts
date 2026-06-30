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
import { useIsPooledContext } from '@/hooks/useIsPooledContext';
import { useAuthMutation, useAuthQuery } from '@/lib/query/useAuthQuery';

import { levelsKey } from './queryKeys';

/** Free-aware: free projects now have their own pooled Levels (`/pooled/projects/
 * {id}/levels`, identical paid schema), so both tiers fetch the real list. */
export function useProjectLevels(projectId: string): UseQueryResult<LevelList> {
  const { isPooled, ready } = useIsPooledContext();
  return useAuthQuery({
    queryKey: levelsKey(projectId),
    queryFn: (accessToken) => listLevels(accessToken, projectId, isPooled),
    // `ready` defers the fetch until /auth/me resolves the free/paid branch (409).
    enabled: ready && projectId.length > 0,
  });
}

type CreateInput = { projectId: string; input: LevelCreateInput };

export function useCreateLevel(): UseMutationResult<Level, Error, CreateInput> {
  const { isPooled } = useIsPooledContext();
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, input }) =>
      createLevel(accessToken, projectId, input, isPooled),
    invalidateKeys: ({ projectId }) => [levelsKey(projectId)],
  });
}

type UpdateInput = { projectId: string; levelId: string; input: LevelUpdateInput };

export function useUpdateLevel(): UseMutationResult<Level, Error, UpdateInput> {
  const { isPooled } = useIsPooledContext();
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, levelId, input }) =>
      updateLevel(accessToken, projectId, levelId, input, isPooled),
    invalidateKeys: ({ projectId }) => [levelsKey(projectId)],
  });
}

type DeleteInput = { projectId: string; levelId: string };

export function useDeleteLevel(): UseMutationResult<void, Error, DeleteInput> {
  const { isPooled } = useIsPooledContext();
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, levelId }) =>
      deleteLevel(accessToken, projectId, levelId, isPooled),
    invalidateKeys: ({ projectId }) => [levelsKey(projectId)],
  });
}

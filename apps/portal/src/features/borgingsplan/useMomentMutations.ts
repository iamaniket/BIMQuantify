'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import {
  createMoment,
  deleteMoment,
  reorderMoments,
  updateMoment,
} from '@/lib/api/borgingsplan';
import type {
  Borgingsmoment,
  BorgingsmomentCreateInput,
  BorgingsmomentUpdateInput,
  MomentReorderInput,
} from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { borgingsplanKey } from './queryKeys';

type UpdateVars = { momentId: string; input: BorgingsmomentUpdateInput };

export function useCreateMoment(
  projectId: string,
  planId: string,
): UseMutationResult<Borgingsmoment, Error, BorgingsmomentCreateInput> {
  return useAuthMutation({
    mutationFn: (accessToken, input) => createMoment(accessToken, planId, input),
    invalidateKeys: [borgingsplanKey(projectId)],
  });
}

export function useUpdateMoment(
  projectId: string,
  planId: string,
): UseMutationResult<Borgingsmoment, Error, UpdateVars> {
  return useAuthMutation({
    mutationFn: (accessToken, { momentId, input }) =>
      updateMoment(accessToken, planId, momentId, input),
    invalidateKeys: [borgingsplanKey(projectId)],
  });
}

export function useDeleteMoment(
  projectId: string,
  planId: string,
): UseMutationResult<void, Error, string> {
  return useAuthMutation({
    mutationFn: (accessToken, momentId) => deleteMoment(accessToken, planId, momentId),
    invalidateKeys: [borgingsplanKey(projectId)],
  });
}

export function useReorderMoments(
  projectId: string,
  planId: string,
): UseMutationResult<Borgingsmoment[], Error, MomentReorderInput> {
  return useAuthMutation({
    mutationFn: (accessToken, input) => reorderMoments(accessToken, planId, input),
    invalidateKeys: [borgingsplanKey(projectId)],
  });
}

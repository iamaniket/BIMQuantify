'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import {
  generateBorgingsplan,
  newBorgingsplanVersion,
  publishBorgingsplan,
  resetBorgingsplan,
  updateBorgingsplan,
} from '@/lib/api/borgingsplan';
import type {
  Borgingsplan,
  BorgingsplanUpdateInput,
  GenerateOptionsInput,
} from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { borgingsplanKey, borgingsplanVersionsKey } from './queryKeys';

function planKeys(projectId: string): (readonly string[])[] {
  return [
    [...borgingsplanKey(projectId)],
    [...borgingsplanVersionsKey(projectId)],
  ];
}

export function useGenerateBorgingsplan(
  projectId: string,
): UseMutationResult<Borgingsplan, Error, GenerateOptionsInput> {
  return useAuthMutation({
    mutationFn: (accessToken, input) => generateBorgingsplan(accessToken, projectId, input),
    invalidateKeys: planKeys(projectId),
  });
}

export function useUpdateBorgingsplan(
  projectId: string,
): UseMutationResult<Borgingsplan, Error, BorgingsplanUpdateInput> {
  return useAuthMutation({
    mutationFn: (accessToken, input) => updateBorgingsplan(accessToken, projectId, input),
    invalidateKeys: planKeys(projectId),
  });
}

export function usePublishBorgingsplan(
  projectId: string,
): UseMutationResult<Borgingsplan, Error, void> {
  return useAuthMutation({
    mutationFn: (accessToken) => publishBorgingsplan(accessToken, projectId),
    invalidateKeys: planKeys(projectId),
  });
}

export function useNewBorgingsplanVersion(
  projectId: string,
): UseMutationResult<Borgingsplan, Error, void> {
  return useAuthMutation({
    mutationFn: (accessToken) => newBorgingsplanVersion(accessToken, projectId),
    invalidateKeys: planKeys(projectId),
  });
}

export function useResetBorgingsplan(
  projectId: string,
): UseMutationResult<Borgingsplan, Error, string> {
  return useAuthMutation({
    mutationFn: (accessToken, planId) => resetBorgingsplan(accessToken, projectId, planId),
    invalidateKeys: planKeys(projectId),
  });
}

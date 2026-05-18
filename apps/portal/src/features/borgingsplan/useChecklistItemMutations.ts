'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import {
  createChecklistItem,
  deleteChecklistItem,
  reorderChecklistItems,
  updateChecklistItem,
} from '@/lib/api/borgingsplan';
import type {
  ChecklistItem,
  ChecklistItemCreateInput,
  ChecklistItemReorderInput,
  ChecklistItemUpdateInput,
} from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { borgingsplanKey } from './queryKeys';

type UpdateVars = { itemId: string; input: ChecklistItemUpdateInput };

export function useCreateChecklistItem(
  projectId: string,
  momentId: string,
): UseMutationResult<ChecklistItem, Error, ChecklistItemCreateInput> {
  return useAuthMutation({
    mutationFn: (accessToken, input) => createChecklistItem(accessToken, momentId, input),
    invalidateKeys: [borgingsplanKey(projectId)],
  });
}

export function useUpdateChecklistItem(
  projectId: string,
  momentId: string,
): UseMutationResult<ChecklistItem, Error, UpdateVars> {
  return useAuthMutation({
    mutationFn: (accessToken, { itemId, input }) =>
      updateChecklistItem(accessToken, momentId, itemId, input),
    invalidateKeys: [borgingsplanKey(projectId)],
  });
}

export function useDeleteChecklistItem(
  projectId: string,
  momentId: string,
): UseMutationResult<void, Error, string> {
  return useAuthMutation({
    mutationFn: (accessToken, itemId) => deleteChecklistItem(accessToken, momentId, itemId),
    invalidateKeys: [borgingsplanKey(projectId)],
  });
}

export function useReorderChecklistItems(
  projectId: string,
  momentId: string,
): UseMutationResult<ChecklistItem[], Error, ChecklistItemReorderInput> {
  return useAuthMutation({
    mutationFn: (accessToken, input) => reorderChecklistItems(accessToken, momentId, input),
    invalidateKeys: [borgingsplanKey(projectId)],
  });
}

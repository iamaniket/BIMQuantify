'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import {
  createFindingComment,
  deleteFindingComment,
  updateFindingComment,
} from '@/lib/api/findings';
import type { FindingComment, FindingCommentCreateInput } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { findingCommentsKey } from './queryKeys';

type CreateVars = { input: FindingCommentCreateInput };
type UpdateVars = { commentId: string; input: FindingCommentCreateInput };
type DeleteVars = { commentId: string };

export function useCreateFindingComment(
  projectId: string,
  findingId: string,
): UseMutationResult<FindingComment, Error, CreateVars> {
  return useAuthMutation({
    mutationFn: (accessToken, { input }) => createFindingComment(
      accessToken,
      projectId,
      findingId,
      input,
    ),
    invalidateKeys: [findingCommentsKey(projectId, findingId)],
  });
}

export function useUpdateFindingComment(
  projectId: string,
  findingId: string,
): UseMutationResult<FindingComment, Error, UpdateVars> {
  return useAuthMutation({
    mutationFn: (accessToken, { commentId, input }) => updateFindingComment(
      accessToken,
      projectId,
      findingId,
      commentId,
      input,
    ),
    invalidateKeys: [findingCommentsKey(projectId, findingId)],
  });
}

export function useDeleteFindingComment(
  projectId: string,
  findingId: string,
): UseMutationResult<void, Error, DeleteVars> {
  return useAuthMutation({
    mutationFn: (accessToken, { commentId }) => deleteFindingComment(
      accessToken,
      projectId,
      findingId,
      commentId,
    ),
    invalidateKeys: [findingCommentsKey(projectId, findingId)],
  });
}

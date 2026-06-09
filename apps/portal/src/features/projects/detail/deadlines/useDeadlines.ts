import type { UseQueryResult, UseMutationResult } from '@tanstack/react-query';

import {
  fileDeadline,
  getDeadlineReadiness,
  listDeadlines,
} from '@/lib/api/deadlines';
import type {
  Deadline,
  DeadlineList,
  DeadlineReadiness,
  FileDeadlineBody,
} from '@/lib/api/schemas/deadlines';
import { useAuthMutation, useAuthQuery } from '@/lib/query/useAuthQuery';

import { projectDeadlinesKey } from '../../queryKeys';

export function useDeadlines(
  projectId: string,
): UseQueryResult<DeadlineList> {
  return useAuthQuery({
    queryKey: [...projectDeadlinesKey(projectId)] as const,
    queryFn: (token) => listDeadlines(token, projectId),
  });
}

export function useFileDeadline(
  projectId: string,
): UseMutationResult<Deadline, Error, { deadlineId: string; body?: FileDeadlineBody }> {
  return useAuthMutation({
    mutationFn: (token, { deadlineId, body }) =>
      fileDeadline(token, projectId, deadlineId, body),
    invalidateKeys: () => [projectDeadlinesKey(projectId)],
  });
}

export function useDeadlineReadiness(
  projectId: string,
  deadlineId: string | null,
): UseQueryResult<DeadlineReadiness> {
  return useAuthQuery({
    queryKey: [...projectDeadlinesKey(projectId), deadlineId, 'readiness'] as const,
    queryFn: (token) => getDeadlineReadiness(token, projectId, deadlineId!),
    enabled: deadlineId !== null,
  });
}

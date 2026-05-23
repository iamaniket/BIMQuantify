import type { UseQueryResult, UseMutationResult } from '@tanstack/react-query';

import { listDeadlines, markDeadlineMet } from '@/lib/api/deadlines';
import type { DeadlineList } from '@/lib/api/schemas/deadlines';
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

export function useMarkDeadlineMet(
  projectId: string,
): UseMutationResult<void, Error, { deadlineId: string }> {
  return useAuthMutation({
    mutationFn: (token, { deadlineId }) => markDeadlineMet(token, projectId, deadlineId),
    invalidateKeys: () => [projectDeadlinesKey(projectId)],
  });
}

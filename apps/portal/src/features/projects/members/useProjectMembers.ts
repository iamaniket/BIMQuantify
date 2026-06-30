'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { useIsFreeContext } from '@/hooks/useIsFreeUser';
import { listProjectMembers } from '@/lib/api/projectMembers';
import type { ProjectMemberList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { projectMembersKey } from '../queryKeys';

/**
 * Free-aware: in the free workspace, members come from the pooled
 * `/pooled/projects/{id}/members` endpoint (owner + up to 3 invited). In org
 * context the org-scoped paid endpoint is used. `ready` defers the fetch until
 * /auth/me resolves so the free/paid branch isn't chosen prematurely.
 */
export function useProjectMembers(
  projectId: string,
  opts?: { enabled?: boolean },
): UseQueryResult<ProjectMemberList> {
  const { isFreeUser, ready } = useIsFreeContext();
  return useAuthQuery({
    queryKey: projectMembersKey(projectId),
    queryFn: (accessToken) =>
      listProjectMembers(accessToken, projectId, isFreeUser),
    enabled: ready && (opts?.enabled ?? true),
  });
}

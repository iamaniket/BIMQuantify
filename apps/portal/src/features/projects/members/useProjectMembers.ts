'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listProjectMembers } from '@/lib/api/projectMembers';
import type { ProjectMemberList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { projectMembersKey } from '../queryKeys';

export function useProjectMembers(projectId: string): UseQueryResult<ProjectMemberList> {
  return useAuthQuery({
    queryKey: projectMembersKey(projectId),
    queryFn: (accessToken) => listProjectMembers(accessToken, projectId),
  });
}

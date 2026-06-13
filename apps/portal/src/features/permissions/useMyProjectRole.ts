'use client';

import { useMemo } from 'react';

import type { ProjectRole } from '@/lib/api/schemas';
import { useProjectMembers } from '@/features/projects/members/useProjectMembers';
import { useAuth } from '@/providers/AuthProvider';

export type MyProjectRole = {
  /** The caller's role on this project, or null when they have no membership
   * row (e.g. an org admin/superuser reaching it via bypass). */
  role: ProjectRole | null;
  isOrgAdmin: boolean;
  isSuperuser: boolean;
  isLoading: boolean;
};

/**
 * Resolves the current user's project role from the (shared, cached) members
 * query plus their org-level flags from /auth/me. This is the single place the
 * portal derives "what can I do here" inputs — replaces the ad-hoc
 * `members.find(m => m.user_id === currentUserId)` repeated across features.
 */
export function useMyProjectRole(projectId: string): MyProjectRole {
  const { me, activeMembership } = useAuth();
  const membersQuery = useProjectMembers(projectId);
  const currentUserId = me?.user.id ?? null;

  const role = useMemo<ProjectRole | null>(() => {
    if (currentUserId === null || membersQuery.data === undefined) return null;
    return membersQuery.data.find((m) => m.user_id === currentUserId)?.role ?? null;
  }, [membersQuery.data, currentUserId]);

  return {
    role,
    isOrgAdmin: activeMembership?.is_org_admin ?? false,
    isSuperuser: me?.user.is_superuser ?? false,
    isLoading: membersQuery.isLoading,
  };
}

'use client';

import { useMemo } from 'react';

import { useIsPooledContext } from '@/hooks/useIsPooledContext';
import { useProjectMembers } from '@/features/projects/members/useProjectMembers';
import type {
  PermissionAction,
  PermissionResource,
  ProjectRole,
} from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { can } from './can';
import { useMyProjectRole } from './useMyProjectRole';
import { usePermissionMatrix } from './usePermissionMatrix';

export type ProjectPermissions = {
  role: ProjectRole | null;
  isOrgAdmin: boolean;
  isSuperuser: boolean;
  /** True until both the matrix and the caller's role have resolved. Callers
   * that want to avoid a flash of hidden controls can wait on this. */
  isLoading: boolean;
  /** Matrix-backed check, mirroring the API exactly. */
  can: (resource: PermissionResource, action: PermissionAction) => boolean;
  /** Finding verify (resolved -> verified) is inspector-only on the API,
   * outside the matrix. */
  canVerifyFinding: boolean;
  /** Add/remove/role-change of project members: owner or org-admin/superuser,
   * mirroring `_require_member_manager`. */
  canManageMembers: boolean;
};

/**
 * One hook every project surface uses to gate its controls. Combines the static
 * permission matrix with the caller's project role + org flags and exposes a
 * `can(resource, action)` plus the two named policy exceptions.
 */
export function useProjectPermissions(projectId: string): ProjectPermissions {
  const { isPooled } = useIsPooledContext();
  const { me } = useAuth();
  const matrixQuery = usePermissionMatrix();
  const { role, isOrgAdmin, isSuperuser, isLoading } = useMyProjectRole(projectId);
  // Resolve the caller's free role from the members list (owner / editor /
  // viewer). Gated to free so paid surfaces don't take an extra members fetch.
  const pooledMembersQuery = useProjectMembers(projectId, { enabled: isPooled });
  const myUserId = me?.user.id ?? null;

  return useMemo<ProjectPermissions>(() => {
    if (isPooled) {
      // Free projects now have owner + up to 3 editor/viewer members. Owner:
      // manages containers + members + snags. Editor: works snags incl. CREATE
      // (pinned in the 3D viewer or filed from the board; no model upload —
      // that's owner-only). Viewer: read-only. No compliance / certificate
      // surface. Backend RLS + role checks are authoritative; this only gates
      // the UI.
      const myMember = (pooledMembersQuery.data ?? []).find((m) => m.user_id === myUserId);
      const pooledRole: ProjectRole = myMember?.role ?? 'owner';
      const isOwner = pooledRole === 'owner';
      const canWrite = isOwner || pooledRole === 'editor';
      return {
        role: pooledRole,
        isOrgAdmin: false,
        isSuperuser: false,
        isLoading: pooledMembersQuery.isLoading,
        can: (resource, _action) => {
          // Model/container management is owner-only in the free tier.
          if (resource === 'document') return isOwner;
          // Findings: owner + editor may create / update / delete (full snag
          // lifecycle); viewers are read-only.
          if (resource === 'finding') return canWrite;
          return false;
        },
        canVerifyFinding: canWrite,
        canManageMembers: isOwner,
      };
    }
    const ctx = {
      isOrgAdmin,
      isSuperuser,
    };
    return {
      role,
      isOrgAdmin,
      isSuperuser,
      isLoading: isLoading || matrixQuery.isLoading,
      can: (resource, action) => can(matrixQuery.data, role, resource, action, ctx),
      canVerifyFinding: role === 'inspector',
      canManageMembers: isSuperuser || isOrgAdmin || role === 'owner',
    };
  }, [
    matrixQuery.data,
    matrixQuery.isLoading,
    role,
    isOrgAdmin,
    isSuperuser,
    isLoading,
    isPooled,
    pooledMembersQuery.data,
    pooledMembersQuery.isLoading,
    myUserId,
  ]);
}

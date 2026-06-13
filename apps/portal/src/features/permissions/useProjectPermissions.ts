'use client';

import { useMemo } from 'react';

import type {
  PermissionAction,
  PermissionResource,
  ProjectRole,
} from '@/lib/api/schemas';

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
  const matrixQuery = usePermissionMatrix();
  const { role, isOrgAdmin, isSuperuser, isLoading } = useMyProjectRole(projectId);

  return useMemo<ProjectPermissions>(() => {
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
  }, [matrixQuery.data, matrixQuery.isLoading, role, isOrgAdmin, isSuperuser, isLoading]);
}

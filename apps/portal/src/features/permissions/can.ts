import type {
  PermissionAction,
  PermissionMatrix,
  PermissionResource,
  ProjectRole,
} from '@/lib/api/schemas';

export type PermissionContext = {
  isOrgAdmin: boolean;
  isSuperuser: boolean;
};

/**
 * Pure mirror of the API's authorization contract (see apps/api routers +
 * auth/permissions.py). Keep this in lock-step with the backend:
 *
 * - Reads: org-admin / superuser bypass everything — matches
 *   `_require_project_read_access`, which returns early for them.
 * - Writes: pure role-matrix, NO admin bypass. The API gates writes on
 *   `require_permission(membership.role, ...)`; admins act through their own
 *   project membership role (auto-added as `editor` on project creation). A
 *   caller with no role on the project (role === null) gets nothing — which
 *   matches the API's 404/403 for a non-member write.
 *
 * The two policy exceptions that are NOT in the matrix (finding `verify` =
 * inspector only, member management = owner/org-admin) live as named flags on
 * `useProjectPermissions`, not here.
 */
export function can(
  matrix: PermissionMatrix | undefined,
  role: ProjectRole | null,
  resource: PermissionResource,
  action: PermissionAction,
  ctx: PermissionContext,
): boolean {
  if (action === 'read' && (ctx.isOrgAdmin || ctx.isSuperuser)) return true;
  if (matrix === undefined || role === null) return false;
  return matrix[role]?.[resource]?.includes(action) ?? false;
}

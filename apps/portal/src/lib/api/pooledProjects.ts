import { apiClient } from './client';
import {
  FindingListSchema,
  ProjectMemberSchema,
  type Finding,
  type ProjectMember,
  type ProjectRole,
} from './schemas';

/**
 * Free-tier endpoints that genuinely DIVERGE from paid (everything path-only has
 * collapsed into the paid modules behind a `free` flag — see `lib/api/scope.ts`).
 *
 * What remains here:
 *  - `listPooledProjectSnags` — the board feed is currently an un-paginated adapter
 *    over the free snags (Phase 2 will fold this into the paid finding list).
 *  - `invitePooledProjectMember` — free invites by email straight to `/members`
 *    (returning a `ProjectMember`), unlike paid's `/invitations` flow.
 */

/** Board feed — every snag across the project's models adapted to the paid
 * `Finding` shape so the kanban board + finding cards render unchanged. */
export async function listPooledProjectSnags(
  accessToken: string,
  id: string,
): Promise<Finding[]> {
  return apiClient.get<Finding[]>(
    `/pooled/projects/${id}/findings`,
    FindingListSchema,
    accessToken,
  );
}

export type FreeMemberInviteInput = { email: string; role: ProjectRole };

/** Invite a member to a free project by email (owner-only, max 3). Unlike paid's
 * `/invitations` flow this posts straight to `/members` and returns the created
 * `ProjectMember`. */
export async function invitePooledProjectMember(
  accessToken: string,
  id: string,
  input: FreeMemberInviteInput,
): Promise<ProjectMember> {
  return apiClient.post<ProjectMember>(
    `/pooled/projects/${id}/members`,
    input,
    ProjectMemberSchema,
    accessToken,
  );
}

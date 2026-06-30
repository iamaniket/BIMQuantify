import { apiClient } from './client';
import { projectScope } from './scope';
import {
  ProjectInvitationResponseSchema,
  ProjectMemberListSchema,
  ProjectMemberSchema,
  type ProjectInvitationResponse,
  type ProjectMember,
  type ProjectMemberCreateInput,
  type ProjectMemberList,
  type ProjectMemberUpdateInput,
} from './schemas';

export type { ProjectInvitationResponse } from './schemas';

// `free` swaps the `/pooled/projects` vs `/projects` prefix for the shared member
// ops (list/update-role/remove). Adding a member differs by tier: paid invites an
// existing org member by user_id (`addProjectMember`) or by email via
// `/invitations` (`inviteToProject`); free invites by email straight to `/members`
// (`inviteFreeProjectMember`, in freeProjects.ts) — both paid-only here.
const membersBase = (projectId: string, free: boolean): string =>
  `${projectScope(projectId, free)}/members`;

export async function listProjectMembers(
  accessToken: string,
  projectId: string,
  free = false,
): Promise<ProjectMemberList> {
  return apiClient.get<ProjectMemberList>(
    membersBase(projectId, free),
    ProjectMemberListSchema,
    accessToken,
  );
}

export async function addProjectMember(
  accessToken: string,
  projectId: string,
  input: ProjectMemberCreateInput,
): Promise<ProjectMember> {
  return apiClient.post<ProjectMember>(
    membersBase(projectId, false),
    input,
    ProjectMemberSchema,
    accessToken,
  );
}

export async function updateProjectMemberRole(
  accessToken: string,
  projectId: string,
  userId: string,
  input: ProjectMemberUpdateInput,
  free = false,
): Promise<ProjectMember> {
  return apiClient.patch<ProjectMember>(
    `${membersBase(projectId, free)}/${userId}`,
    input,
    ProjectMemberSchema,
    accessToken,
  );
}

export async function removeProjectMember(
  accessToken: string,
  projectId: string,
  userId: string,
  free = false,
): Promise<void> {
  return apiClient.delete(
    `${membersBase(projectId, free)}/${userId}`,
    accessToken,
  );
}

export type ProjectInvitationInput = {
  email: string;
  role?: string;
  full_name?: string | null;
};

export async function inviteToProject(
  accessToken: string,
  projectId: string,
  input: ProjectInvitationInput,
): Promise<ProjectInvitationResponse> {
  return apiClient.post<ProjectInvitationResponse>(
    `/projects/${projectId}/invitations`,
    input,
    ProjectInvitationResponseSchema,
    accessToken,
  );
}

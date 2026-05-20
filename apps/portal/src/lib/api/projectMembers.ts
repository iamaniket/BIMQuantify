import { apiClient } from './client';
import {
  ProjectMemberListSchema,
  ProjectMemberSchema,
  type ProjectMember,
  type ProjectMemberCreateInput,
  type ProjectMemberList,
  type ProjectMemberUpdateInput,
} from './schemas';

export async function listProjectMembers(
  accessToken: string,
  projectId: string,
): Promise<ProjectMemberList> {
  return apiClient.get<ProjectMemberList>(
    `/projects/${projectId}/members`,
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
    `/projects/${projectId}/members`,
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
): Promise<ProjectMember> {
  return apiClient.patch<ProjectMember>(
    `/projects/${projectId}/members/${userId}`,
    input,
    ProjectMemberSchema,
    accessToken,
  );
}

export async function removeProjectMember(
  accessToken: string,
  projectId: string,
  userId: string,
): Promise<void> {
  return apiClient.delete(
    `/projects/${projectId}/members/${userId}`,
    accessToken,
  );
}

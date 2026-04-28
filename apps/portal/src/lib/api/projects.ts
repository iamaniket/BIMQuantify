import { apiClient } from './client';
import {
  ProjectListSchema,
  ProjectSchema,
  type Project,
  type ProjectCreateInput,
  type ProjectList,
  type ProjectUpdateInput,
} from './schemas';

export async function listProjects(accessToken: string): Promise<ProjectList> {
  return apiClient.get<ProjectList>('/projects', ProjectListSchema, accessToken);
}

export async function createProject(
  accessToken: string,
  input: ProjectCreateInput,
): Promise<Project> {
  return apiClient.post<Project>('/projects', input, ProjectSchema, accessToken);
}

export async function updateProject(
  accessToken: string,
  id: string,
  input: ProjectUpdateInput,
): Promise<Project> {
  return apiClient.patch<Project>(`/projects/${id}`, input, ProjectSchema, accessToken);
}

export async function deleteProject(accessToken: string, id: string): Promise<void> {
  return apiClient.delete(`/projects/${id}`, accessToken);
}

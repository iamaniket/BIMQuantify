import { apiClient } from '@/lib/api/client';
import {
  ProjectListSchema,
  ProjectSchema,
  type Project,
  type ProjectList,
} from '@/lib/api/schemas/projects';

export async function listProjects(accessToken: string): Promise<ProjectList> {
  return apiClient.get<ProjectList>('/projects', ProjectListSchema, accessToken);
}

export async function getProject(accessToken: string, projectId: string): Promise<Project> {
  return apiClient.get<Project>(`/projects/${projectId}`, ProjectSchema, accessToken);
}

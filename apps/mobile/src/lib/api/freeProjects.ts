import { apiClient } from '@/lib/api/client';
import {
  ProjectListSchema,
  ProjectSchema,
  type Project,
  type ProjectList,
} from '@/lib/api/schemas/projects';

// FREE-tier project endpoints. The API returns the identical paid `ProjectRead`
// shape (server-adapted from free_projects), so the same Zod schemas validate.

export async function listFreeProjects(accessToken: string): Promise<ProjectList> {
  return apiClient.get<ProjectList>('/free/projects', ProjectListSchema, accessToken);
}

export async function getFreeProject(accessToken: string, projectId: string): Promise<Project> {
  return apiClient.get<Project>(`/free/projects/${projectId}`, ProjectSchema, accessToken);
}

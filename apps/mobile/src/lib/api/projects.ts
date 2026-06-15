import { apiClient } from '@/lib/api/client';
import { ProjectListSchema, type ProjectList } from '@/lib/api/schemas/projects';

export async function listProjects(accessToken: string): Promise<ProjectList> {
  return apiClient.get<ProjectList>('/projects', ProjectListSchema, accessToken);
}

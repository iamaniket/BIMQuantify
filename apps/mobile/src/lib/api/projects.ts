import { apiClient } from '@/lib/api/client';
import { projectScope, projectsScope } from '@/lib/api/scope';
import {
  ProjectListSchema,
  ProjectSchema,
  type Project,
  type ProjectList,
} from '@/lib/api/schemas/projects';

// Free (org-less) and paid endpoints return the identical paid `ProjectRead`
// shape (the API adapts free_projects server-side), so the same Zod schemas
// validate both. `free` routes the path via scope.ts.

export async function listProjects(accessToken: string, free = false): Promise<ProjectList> {
  return apiClient.get<ProjectList>(projectsScope(free), ProjectListSchema, accessToken);
}

export async function getProject(
  accessToken: string,
  projectId: string,
  free = false,
): Promise<Project> {
  return apiClient.get<Project>(projectScope(projectId, free), ProjectSchema, accessToken);
}

import { apiClient } from './client';
import { projectScope, projectsScope } from './scope';
import {
  ProjectListSchema,
  ProjectOverviewSchema,
  ProjectSchema,
  type Project,
  type ProjectCreateInput,
  type ProjectList,
  type ProjectOverview,
  type ProjectUpdateInput,
} from './schemas';

// Free (org-less) and paid callers share these fetchers; `free` swaps the
// `/pooled/projects` vs `/projects` prefix. Both surfaces return the IDENTICAL paid
// schema (the API zeroes the org-only blocks for free). `createProjectWithThumbnail`
// is paid-only (free uploads the cover separately via `uploadProjectThumbnail`).

export async function listProjects(accessToken: string, free = false): Promise<ProjectList> {
  return apiClient.get<ProjectList>(projectsScope(free), ProjectListSchema, accessToken);
}

export async function getProject(
  accessToken: string,
  id: string,
  free = false,
): Promise<Project> {
  return apiClient.get<Project>(projectScope(id, free), ProjectSchema, accessToken);
}

/** BFF aggregate for the project-detail dashboard — one call assembles project
 * metadata, the completeness donut, header KPIs, and capped previews + exact
 * counts for findings/certificates/attachments/reports/deadlines, plus members
 * and the weekly activity trend. Replaces the ~10 cold-load requests the page
 * used to fire. (Free zeroes the org-only blocks.) */
export async function getProjectOverview(
  accessToken: string,
  id: string,
  free = false,
): Promise<ProjectOverview> {
  return apiClient.get<ProjectOverview>(
    `${projectScope(id, free)}/overview`,
    ProjectOverviewSchema,
    accessToken,
  );
}

export async function createProject(
  accessToken: string,
  input: ProjectCreateInput,
  free = false,
): Promise<Project> {
  return apiClient.post<Project>(projectsScope(free), input, ProjectSchema, accessToken);
}

export async function createProjectWithThumbnail(
  accessToken: string,
  input: ProjectCreateInput,
  thumbnailFile: File,
): Promise<Project> {
  const formData = new FormData();
  formData.append('name', input.name);
  if (input.description !== null && input.description !== undefined) {
    formData.append('description', input.description);
  }
  formData.append('thumbnail', thumbnailFile);
  return apiClient.postMultipart<Project>('/projects/with-thumbnail', formData, ProjectSchema, accessToken);
}

export async function updateProject(
  accessToken: string,
  id: string,
  input: ProjectUpdateInput,
  free = false,
): Promise<Project> {
  return apiClient.patch<Project>(projectScope(id, free), input, ProjectSchema, accessToken);
}

export async function uploadProjectThumbnail(
  accessToken: string,
  projectId: string,
  file: File,
  free = false,
): Promise<Project> {
  const formData = new FormData();
  formData.append('thumbnail', file);
  return apiClient.postMultipart<Project>(
    `${projectScope(projectId, free)}/thumbnail`,
    formData,
    ProjectSchema,
    accessToken,
  );
}

export async function deleteProject(
  accessToken: string,
  id: string,
  free = false,
): Promise<void> {
  return apiClient.delete(projectScope(id, free), accessToken);
}

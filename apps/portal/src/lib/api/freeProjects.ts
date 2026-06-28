import { apiClient } from './client';
import {
  DocumentWithVersionsListSchema,
  FindingListSchema,
  ProjectListSchema,
  ProjectOverviewSchema,
  ProjectSchema,
  type DocumentWithVersions,
  type Finding,
  type Project,
  type ProjectCreateInput,
  type ProjectList,
  type ProjectOverview,
  type ProjectUpdateInput,
} from './schemas';

/**
 * Free-tier project API — the org-less analogue of `lib/api/projects.ts`.
 *
 * Every endpoint returns the IDENTICAL paid schema (the API zeroes the org-only
 * blocks), so the portal reuses the exact paid Zod schemas + components. The
 * free-aware data hooks (`useProjects`, `useProjectOverview`, …) branch to these
 * functions for an org-less user; the paid path is byte-identical.
 */

export async function listFreeProjects(accessToken: string): Promise<ProjectList> {
  return apiClient.get<ProjectList>('/free/projects', ProjectListSchema, accessToken);
}

export async function getFreeProject(accessToken: string, id: string): Promise<Project> {
  return apiClient.get<Project>(`/free/projects/${id}`, ProjectSchema, accessToken);
}

export async function createFreeProject(
  accessToken: string,
  input: ProjectCreateInput,
): Promise<Project> {
  return apiClient.post<Project>('/free/projects', input, ProjectSchema, accessToken);
}

export async function updateFreeProject(
  accessToken: string,
  id: string,
  input: ProjectUpdateInput,
): Promise<Project> {
  return apiClient.patch<Project>(`/free/projects/${id}`, input, ProjectSchema, accessToken);
}

export async function deleteFreeProject(accessToken: string, id: string): Promise<void> {
  return apiClient.delete(`/free/projects/${id}`, accessToken);
}

/** The free project-detail BFF — same `ProjectOverview` shape as the paid one,
 * with dossier/deadlines/certificates/attachments/reports zeroed. */
export async function getFreeProjectOverview(
  accessToken: string,
  id: string,
): Promise<ProjectOverview> {
  return apiClient.get<ProjectOverview>(
    `/free/projects/${id}/overview`,
    ProjectOverviewSchema,
    accessToken,
  );
}

/** Containers for a free project — the project's free models adapted to the paid
 * `DocumentWithVersions` shape (single ready version, no levels/aligned sheets). */
export async function listFreeProjectDocuments(
  accessToken: string,
  id: string,
): Promise<DocumentWithVersions[]> {
  return apiClient.get<DocumentWithVersions[]>(
    `/free/projects/${id}/documents`,
    DocumentWithVersionsListSchema,
    accessToken,
  );
}

/** Board feed — every snag across the project's models adapted to the paid
 * `Finding` shape so the kanban board + finding cards render unchanged. */
export async function listFreeProjectSnags(
  accessToken: string,
  id: string,
): Promise<Finding[]> {
  return apiClient.get<Finding[]>(
    `/free/projects/${id}/snags`,
    FindingListSchema,
    accessToken,
  );
}

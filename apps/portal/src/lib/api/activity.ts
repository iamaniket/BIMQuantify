import type { SortQueryParams } from './admin';
import { apiClient, type PaginatedResponse } from './client';
import {
  ProjectActivityListSchema,
  type ActivityCategory,
  type ProjectActivityList,
} from './schemas/activity';

/** Filter + pagination + sort params for the project activity feed. */
export type ListProjectActivityParams = {
  category?: ActivityCategory | undefined;
  since?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
} & SortQueryParams;

function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = [];
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined) return;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  });
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

/** Paginated page of project activity — items plus total (via X-Total-Count). */
export async function listProjectActivityPage(
  accessToken: string,
  projectId: string,
  params: ListProjectActivityParams = {},
): Promise<PaginatedResponse<ProjectActivityList>> {
  const query = buildQuery(params);
  return apiClient.getWithMeta<ProjectActivityList>(
    `/projects/${projectId}/activity${query}`,
    ProjectActivityListSchema,
    accessToken,
  );
}

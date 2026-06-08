import { apiClient, type PaginatedResponse } from './client';
import {
  ProjectActivityListSchema,
  type ActivityCategory,
  type ProjectActivityList,
} from './schemas/activity';

export async function getProjectActivity(
  accessToken: string,
  projectId: string,
  category?: ActivityCategory,
  limit = 50,
  offset = 0,
  since?: string,
): Promise<PaginatedResponse<ProjectActivityList>> {
  const params = new URLSearchParams();
  if (category !== undefined) params.set('category', category);
  if (since !== undefined) params.set('since', since);
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  const qs = params.toString();
  return apiClient.getWithMeta<ProjectActivityList>(
    `/projects/${projectId}/activity?${qs}`,
    ProjectActivityListSchema,
    accessToken,
  );
}

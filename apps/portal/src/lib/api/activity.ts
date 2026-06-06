import { apiClient } from './client';
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
  since?: string,
): Promise<ProjectActivityList> {
  const params = new URLSearchParams();
  if (category !== undefined) params.set('category', category);
  if (since !== undefined) params.set('since', since);
  params.set('limit', String(limit));
  const qs = params.toString();
  return apiClient.get<ProjectActivityList>(
    `/projects/${projectId}/activity?${qs}`,
    ProjectActivityListSchema,
    accessToken,
  );
}

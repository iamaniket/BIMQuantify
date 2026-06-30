import { apiClient } from './client';
import { LevelListSchema, type LevelList } from './schemas';

// Free (org-less) users hit the pooled `/pooled/projects/...` levels surface, which
// returns the IDENTICAL paid Level schema; paid hit the org endpoints.
const base = (projectId: string, free: boolean): string =>
  `${free ? '/pooled/projects' : '/projects'}/${projectId}/levels`;

export async function listLevels(
  accessToken: string,
  projectId: string,
  free = false,
): Promise<LevelList> {
  return apiClient.get<LevelList>(base(projectId, free), LevelListSchema, accessToken);
}

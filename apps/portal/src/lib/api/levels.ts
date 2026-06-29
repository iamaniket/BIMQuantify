import { apiClient } from './client';
import {
  LevelListSchema,
  LevelSchema,
  type Level,
  type LevelCreateInput,
  type LevelList,
  type LevelUpdateInput,
} from './schemas';

// Free (org-less) users hit the pooled `/free/projects/...` levels surface, which
// returns the IDENTICAL paid Level schema; paid hit the org endpoints.
const base = (projectId: string, free: boolean): string =>
  `${free ? '/free/projects' : '/projects'}/${projectId}/levels`;

export async function listLevels(
  accessToken: string,
  projectId: string,
  free = false,
): Promise<LevelList> {
  return apiClient.get<LevelList>(base(projectId, free), LevelListSchema, accessToken);
}

export async function createLevel(
  accessToken: string,
  projectId: string,
  input: LevelCreateInput,
  free = false,
): Promise<Level> {
  return apiClient.post<Level>(base(projectId, free), input, LevelSchema, accessToken);
}

export async function updateLevel(
  accessToken: string,
  projectId: string,
  levelId: string,
  input: LevelUpdateInput,
  free = false,
): Promise<Level> {
  return apiClient.patch<Level>(
    `${base(projectId, free)}/${levelId}`,
    input,
    LevelSchema,
    accessToken,
  );
}

export async function deleteLevel(
  accessToken: string,
  projectId: string,
  levelId: string,
  free = false,
): Promise<void> {
  return apiClient.delete(`${base(projectId, free)}/${levelId}`, accessToken);
}

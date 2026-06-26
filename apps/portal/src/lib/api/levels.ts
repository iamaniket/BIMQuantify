import { apiClient } from './client';
import {
  LevelListSchema,
  LevelSchema,
  type Level,
  type LevelCreateInput,
  type LevelList,
  type LevelUpdateInput,
} from './schemas';

export async function listLevels(
  accessToken: string,
  projectId: string,
): Promise<LevelList> {
  return apiClient.get<LevelList>(
    `/projects/${projectId}/levels`,
    LevelListSchema,
    accessToken,
  );
}

export async function createLevel(
  accessToken: string,
  projectId: string,
  input: LevelCreateInput,
): Promise<Level> {
  return apiClient.post<Level>(
    `/projects/${projectId}/levels`,
    input,
    LevelSchema,
    accessToken,
  );
}

export async function updateLevel(
  accessToken: string,
  projectId: string,
  levelId: string,
  input: LevelUpdateInput,
): Promise<Level> {
  return apiClient.patch<Level>(
    `/projects/${projectId}/levels/${levelId}`,
    input,
    LevelSchema,
    accessToken,
  );
}

export async function deleteLevel(
  accessToken: string,
  projectId: string,
  levelId: string,
): Promise<void> {
  return apiClient.delete(`/projects/${projectId}/levels/${levelId}`, accessToken);
}

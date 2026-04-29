import { apiClient } from './client';
import {
  ModelListSchema,
  ModelSchema,
  ModelWithVersionsSchema,
  type Model,
  type ModelCreateInput,
  type ModelList,
  type ModelUpdateInput,
  type ModelWithVersions,
} from './schemas';

export async function listModels(
  accessToken: string,
  projectId: string,
): Promise<ModelList> {
  return apiClient.get<ModelList>(
    `/projects/${projectId}/models`,
    ModelListSchema,
    accessToken,
  );
}

export async function getModel(
  accessToken: string,
  projectId: string,
  modelId: string,
): Promise<ModelWithVersions> {
  return apiClient.get<ModelWithVersions>(
    `/projects/${projectId}/models/${modelId}`,
    ModelWithVersionsSchema,
    accessToken,
  );
}

export async function createModel(
  accessToken: string,
  projectId: string,
  input: ModelCreateInput,
): Promise<Model> {
  return apiClient.post<Model>(
    `/projects/${projectId}/models`,
    input,
    ModelSchema,
    accessToken,
  );
}

export async function updateModel(
  accessToken: string,
  projectId: string,
  modelId: string,
  input: ModelUpdateInput,
): Promise<Model> {
  return apiClient.patch<Model>(
    `/projects/${projectId}/models/${modelId}`,
    input,
    ModelSchema,
    accessToken,
  );
}

export async function deleteModel(
  accessToken: string,
  projectId: string,
  modelId: string,
): Promise<void> {
  return apiClient.delete(
    `/projects/${projectId}/models/${modelId}`,
    accessToken,
  );
}

import { apiClient } from './client';
import { StoreyListSchema, type StoreyList } from './schemas';

export async function listStoreys(
  accessToken: string,
  projectId: string,
  modelId: string,
): Promise<StoreyList> {
  return apiClient.get<StoreyList>(
    `/projects/${projectId}/documents/${modelId}/storeys`,
    StoreyListSchema,
    accessToken,
  );
}

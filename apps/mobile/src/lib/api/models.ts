import { apiClient } from '@/lib/api/client';
import {
  ModelWithVersionsListSchema,
  type ModelWithVersionsList,
} from '@/lib/api/schemas/models';

// GET /projects/{id}/models?include=versions — models plus their files, so the
// list can pick each model's latest ready file id for the viewer.
export async function listModelsWithVersions(
  accessToken: string,
  projectId: string,
): Promise<ModelWithVersionsList> {
  return apiClient.get<ModelWithVersionsList>(
    `/projects/${projectId}/models?include=versions`,
    ModelWithVersionsListSchema,
    accessToken,
  );
}

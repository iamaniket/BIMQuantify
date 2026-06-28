import { z } from 'zod';

import { apiClient } from './client';

// Mirrors the API's FreeModelRead (routers/free_viewer.py).
export const FreeModelSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  original_filename: z.string(),
  status: z.string(),
  extraction_status: z.string(),
  ifc_schema: z.string().nullable(),
  size_bytes: z.number().int(),
  rejection_reason: z.string().nullable(),
  extraction_error: z.string().nullable(),
  converted_to_file_id: z.string().uuid().nullable(),
});
export type FreeModel = z.infer<typeof FreeModelSchema>;
export const FreeModelListSchema = z.array(FreeModelSchema);

export const FreeModelInitiateResponseSchema = z.object({
  model_id: z.string().uuid(),
  upload_url: z.string().url(),
  storage_key: z.string(),
  expires_in: z.number().int().positive(),
});
export type FreeModelInitiateResponse = z.infer<typeof FreeModelInitiateResponseSchema>;

export const FreeViewerBundleSchema = z.object({
  model_id: z.string().uuid(),
  scene_id: z.string(),
  fragments_url: z.string().url(),
  metadata_url: z.string().url().nullable(),
  outline_url: z.string().url().nullable(),
  properties_url: z.string().url().nullable(),
});
export type FreeViewerBundle = z.infer<typeof FreeViewerBundleSchema>;

export async function listFreeModels(accessToken: string): Promise<FreeModel[]> {
  return apiClient.get<FreeModel[]>('/free/models', FreeModelListSchema, accessToken);
}

export async function getFreeModel(
  accessToken: string,
  modelId: string,
): Promise<FreeModel> {
  return apiClient.get<FreeModel>(`/free/models/${modelId}`, FreeModelSchema, accessToken);
}

export async function getFreeViewerBundle(
  accessToken: string,
  modelId: string,
): Promise<FreeViewerBundle> {
  return apiClient.get<FreeViewerBundle>(
    `/free/models/${modelId}/viewer-bundle`,
    FreeViewerBundleSchema,
    accessToken,
  );
}

export async function deleteFreeModel(
  accessToken: string,
  modelId: string,
): Promise<void> {
  return apiClient.delete(`/free/models/${modelId}`, accessToken);
}

/** Two-phase free upload: initiate → presigned PUT → complete. The free
 * `initiate` accepts an optional content_sha256, which we omit (the processor
 * re-validates the IFC header server-side at complete). */
export async function uploadFreeModel(
  accessToken: string,
  file: File,
): Promise<FreeModel> {
  const contentType = file.type === '' ? 'application/octet-stream' : file.type;
  const initiated = await apiClient.post<FreeModelInitiateResponse>(
    '/free/models/initiate',
    { filename: file.name, size_bytes: file.size, content_type: contentType },
    FreeModelInitiateResponseSchema,
    accessToken,
  );
  await apiClient.putRaw(initiated.upload_url, file, contentType);
  return apiClient.post<FreeModel>(
    `/free/models/${initiated.model_id}/complete`,
    {},
    FreeModelSchema,
    accessToken,
  );
}

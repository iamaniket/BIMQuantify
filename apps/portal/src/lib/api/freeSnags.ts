import { z } from 'zod';

import { apiClient } from './client';

// Mirrors the API's FreeSnagRead (routers/free_viewer.py).
export const FreeSnagSchema = z.object({
  id: z.string().uuid(),
  free_model_id: z.string().uuid(),
  title: z.string(),
  note: z.string().nullable(),
  severity: z.string(),
  status: z.string(),
  linked_file_type: z.string(),
  anchor_x: z.number().nullable(),
  anchor_y: z.number().nullable(),
  anchor_z: z.number().nullable(),
  anchor_page: z.number().int().nullable(),
  linked_element_global_id: z.string().nullable(),
});
export type FreeSnag = z.infer<typeof FreeSnagSchema>;
export const FreeSnagListSchema = z.array(FreeSnagSchema);

export type FreeSnagCreateInput = {
  title: string;
  note?: string | null;
  severity: 'low' | 'medium' | 'high';
  linked_file_type?: string;
  anchor_x?: number | null;
  anchor_y?: number | null;
  anchor_z?: number | null;
  anchor_page?: number | null;
  linked_element_global_id?: string | null;
};

export type FreeSnagUpdateInput = {
  title?: string;
  note?: string | null;
  severity?: 'low' | 'medium' | 'high';
  status?: 'open' | 'closed';
};

export async function listFreeSnags(
  accessToken: string,
  modelId: string,
): Promise<FreeSnag[]> {
  return apiClient.get<FreeSnag[]>(
    `/free/models/${modelId}/snags`,
    FreeSnagListSchema,
    accessToken,
  );
}

export async function createFreeSnag(
  accessToken: string,
  modelId: string,
  input: FreeSnagCreateInput,
): Promise<FreeSnag> {
  return apiClient.post<FreeSnag>(
    `/free/models/${modelId}/snags`,
    input,
    FreeSnagSchema,
    accessToken,
  );
}

export async function updateFreeSnag(
  accessToken: string,
  snagId: string,
  input: FreeSnagUpdateInput,
): Promise<FreeSnag> {
  return apiClient.patch<FreeSnag>(
    `/free/snags/${snagId}`,
    input,
    FreeSnagSchema,
    accessToken,
  );
}

export async function deleteFreeSnag(
  accessToken: string,
  snagId: string,
): Promise<void> {
  return apiClient.delete(`/free/snags/${snagId}`, accessToken);
}

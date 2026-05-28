import { apiClient } from './client.js';
import {
  ElementInspectionsResponseSchema,
  type ElementInspectionsResponse,
} from './schemas/elementInspections.js';

/**
 * Fetch all checklist items linked to a specific IFC element in a file,
 * together with their inspection results (if any).
 */
export async function getElementInspections(
  accessToken: string,
  projectId: string,
  fileId: string,
  globalId: string,
): Promise<ElementInspectionsResponse> {
  const params = new URLSearchParams({ global_id: globalId });
  return apiClient.get<ElementInspectionsResponse>(
    `/projects/${projectId}/files/${fileId}/element-inspections?${params.toString()}`,
    ElementInspectionsResponseSchema,
    accessToken,
  );
}

import { apiClient } from '@/lib/api/client';
import {
  DocumentWithVersionsListSchema,
  type DocumentWithVersionsList,
} from '@/lib/api/schemas/documents';

// GET /projects/{id}/documents?include=versions — documents plus their files, so
// the list can pick each document's latest ready file id for the viewer.
export async function listDocumentsWithVersions(
  accessToken: string,
  projectId: string,
): Promise<DocumentWithVersionsList> {
  return apiClient.get<DocumentWithVersionsList>(
    `/projects/${projectId}/documents?include=versions`,
    DocumentWithVersionsListSchema,
    accessToken,
  );
}

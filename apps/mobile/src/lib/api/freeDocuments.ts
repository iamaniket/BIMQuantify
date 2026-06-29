import { apiClient } from '@/lib/api/client';
import {
  DocumentWithVersionsListSchema,
  type DocumentWithVersionsList,
} from '@/lib/api/schemas/documents';

// FREE-tier documents. The API returns the same paid `DocumentWithVersions`
// shape, so the same schema validates. Free has no `?include=versions` toggle —
// it always returns versions.
export async function listFreeDocumentsWithVersions(
  accessToken: string,
  projectId: string,
): Promise<DocumentWithVersionsList> {
  return apiClient.get<DocumentWithVersionsList>(
    `/free/projects/${projectId}/documents`,
    DocumentWithVersionsListSchema,
    accessToken,
  );
}

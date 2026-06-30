import { apiClient } from '@/lib/api/client';
import { projectScope } from '@/lib/api/scope';
import {
  DocumentWithVersionsListSchema,
  type DocumentWithVersionsList,
} from '@/lib/api/schemas/documents';

// Documents plus their files, so the list can pick each document's latest ready
// file id for the viewer. Both tiers return the same `DocumentWithVersions`
// shape; paid takes `?include=versions`, free always returns versions (no toggle).
// `free` routes the path via scope.ts.
export async function listDocumentsWithVersions(
  accessToken: string,
  projectId: string,
  free = false,
): Promise<DocumentWithVersionsList> {
  const qs = free ? '' : '?include=versions';
  return apiClient.get<DocumentWithVersionsList>(
    `${projectScope(projectId, free)}/documents${qs}`,
    DocumentWithVersionsListSchema,
    accessToken,
  );
}

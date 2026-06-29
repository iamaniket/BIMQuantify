import { apiClient } from './client';
import { projectScope } from './scope';
import {
  DocumentListSchema,
  DocumentSchema,
  DocumentWithVersionsListSchema,
  DocumentWithVersionsSchema,
  type Document,
  type DocumentCreateInput,
  type DocumentList,
  type DocumentUpdateInput,
  type DocumentWithVersions,
  type DocumentWithVersionsList,
} from './schemas';

// Free (org-less) and paid callers share these fetchers; `free` swaps the
// `/free/projects` vs `/projects` prefix. Both surfaces return identical schemas.
// `listDocuments` (the light, no-versions list) is paid-only — the free list
// endpoint always returns the with-versions shape.
const docsBase = (projectId: string, free: boolean): string =>
  `${projectScope(projectId, free)}/documents`;

export async function listDocuments(
  accessToken: string,
  projectId: string,
): Promise<DocumentList> {
  return apiClient.get<DocumentList>(
    docsBase(projectId, false),
    DocumentListSchema,
    accessToken,
  );
}

export async function listDocumentsWithVersions(
  accessToken: string,
  projectId: string,
  free = false,
): Promise<DocumentWithVersionsList> {
  // The free list endpoint always includes versions; paid opts in via `?include`.
  const query = free ? '' : '?include=versions';
  return apiClient.get<DocumentWithVersionsList>(
    `${docsBase(projectId, free)}${query}`,
    DocumentWithVersionsListSchema,
    accessToken,
  );
}

export async function getDocument(
  accessToken: string,
  projectId: string,
  documentId: string,
  free = false,
): Promise<DocumentWithVersions> {
  return apiClient.get<DocumentWithVersions>(
    `${docsBase(projectId, free)}/${documentId}`,
    DocumentWithVersionsSchema,
    accessToken,
  );
}

export async function createDocument(
  accessToken: string,
  projectId: string,
  input: DocumentCreateInput,
  free = false,
): Promise<Document> {
  return apiClient.post<Document>(
    docsBase(projectId, free),
    input,
    DocumentSchema,
    accessToken,
  );
}

export async function updateDocument(
  accessToken: string,
  projectId: string,
  documentId: string,
  input: DocumentUpdateInput,
  free = false,
): Promise<Document> {
  return apiClient.patch<Document>(
    `${docsBase(projectId, free)}/${documentId}`,
    input,
    DocumentSchema,
    accessToken,
  );
}

export async function deleteDocument(
  accessToken: string,
  projectId: string,
  documentId: string,
  free = false,
): Promise<void> {
  return apiClient.delete(
    `${docsBase(projectId, free)}/${documentId}`,
    accessToken,
  );
}

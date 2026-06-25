import { apiClient } from './client';
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

export async function listDocuments(
  accessToken: string,
  projectId: string,
): Promise<DocumentList> {
  return apiClient.get<DocumentList>(
    `/projects/${projectId}/documents`,
    DocumentListSchema,
    accessToken,
  );
}

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

export async function getDocument(
  accessToken: string,
  projectId: string,
  documentId: string,
): Promise<DocumentWithVersions> {
  return apiClient.get<DocumentWithVersions>(
    `/projects/${projectId}/documents/${documentId}`,
    DocumentWithVersionsSchema,
    accessToken,
  );
}

export async function createDocument(
  accessToken: string,
  projectId: string,
  input: DocumentCreateInput,
): Promise<Document> {
  return apiClient.post<Document>(
    `/projects/${projectId}/documents`,
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
): Promise<Document> {
  return apiClient.patch<Document>(
    `/projects/${projectId}/documents/${documentId}`,
    input,
    DocumentSchema,
    accessToken,
  );
}

export async function deleteDocument(
  accessToken: string,
  projectId: string,
  documentId: string,
): Promise<void> {
  return apiClient.delete(
    `/projects/${projectId}/documents/${documentId}`,
    accessToken,
  );
}

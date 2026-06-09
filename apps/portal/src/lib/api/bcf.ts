import { apiClient, triggerBrowserDownload } from './client';
import {
  BcfCommentReadSchema,
  BcfImportResponseSchema,
  BcfSnapshotUploadResponseSchema,
  BcfTopicListSchema,
  BcfTopicReadSchema,
  type BcfCommentCreateInput,
  type BcfCommentRead,
  type BcfImportResponse,
  type BcfSnapshotUploadResponse,
  type BcfTopicCreateInput,
  type BcfTopicList,
  type BcfTopicRead,
  type BcfTopicUpdateInput,
} from './schemas/bcf';

const basePath = (projectId: string) => `/projects/${projectId}/bcf-topics`;

// ---------------------------------------------------------------------------
// Topics — CRUD
// ---------------------------------------------------------------------------

export type BcfListParams = {
  search?: string | undefined;
  status?: string | undefined;
  priority?: string | undefined;
  topic_type?: string | undefined;
};

export async function listBcfTopics(
  accessToken: string,
  projectId: string,
  params?: BcfListParams,
): Promise<BcfTopicList> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.status) qs.set('status', params.status);
  if (params?.priority) qs.set('priority', params.priority);
  if (params?.topic_type) qs.set('topic_type', params.topic_type);
  const query = qs.toString();
  const path = query ? `${basePath(projectId)}?${query}` : basePath(projectId);
  return apiClient.get<BcfTopicList>(path, BcfTopicListSchema, accessToken);
}

export async function getBcfTopic(
  accessToken: string,
  projectId: string,
  topicId: string,
): Promise<BcfTopicRead> {
  return apiClient.get<BcfTopicRead>(
    `${basePath(projectId)}/${topicId}`,
    BcfTopicReadSchema,
    accessToken,
  );
}

export async function createBcfTopic(
  accessToken: string,
  projectId: string,
  input: BcfTopicCreateInput,
): Promise<BcfTopicRead> {
  return apiClient.post<BcfTopicRead>(
    basePath(projectId),
    input,
    BcfTopicReadSchema,
    accessToken,
  );
}

export async function updateBcfTopic(
  accessToken: string,
  projectId: string,
  topicId: string,
  input: BcfTopicUpdateInput,
): Promise<BcfTopicRead> {
  return apiClient.patch<BcfTopicRead>(
    `${basePath(projectId)}/${topicId}`,
    input,
    BcfTopicReadSchema,
    accessToken,
  );
}

export async function deleteBcfTopic(
  accessToken: string,
  projectId: string,
  topicId: string,
): Promise<void> {
  return apiClient.delete(`${basePath(projectId)}/${topicId}`, accessToken);
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export async function addBcfComment(
  accessToken: string,
  projectId: string,
  topicId: string,
  input: BcfCommentCreateInput,
): Promise<BcfCommentRead> {
  return apiClient.post<BcfCommentRead>(
    `${basePath(projectId)}/${topicId}/comments`,
    input,
    BcfCommentReadSchema,
    accessToken,
  );
}

export async function updateBcfComment(
  accessToken: string,
  projectId: string,
  topicId: string,
  commentId: string,
  input: { text: string },
): Promise<BcfCommentRead> {
  return apiClient.patch<BcfCommentRead>(
    `${basePath(projectId)}/${topicId}/comments/${commentId}`,
    input,
    BcfCommentReadSchema,
    accessToken,
  );
}

export async function deleteBcfComment(
  accessToken: string,
  projectId: string,
  topicId: string,
  commentId: string,
): Promise<void> {
  return apiClient.delete(
    `${basePath(projectId)}/${topicId}/comments/${commentId}`,
    accessToken,
  );
}

// ---------------------------------------------------------------------------
// Viewpoints
// ---------------------------------------------------------------------------

export async function addBcfViewpoint(
  accessToken: string,
  projectId: string,
  topicId: string,
  input: unknown,
): Promise<BcfTopicRead> {
  return apiClient.post<BcfTopicRead>(
    `${basePath(projectId)}/${topicId}/viewpoints`,
    input,
    BcfTopicReadSchema,
    accessToken,
  );
}

// ---------------------------------------------------------------------------
// Snapshot upload (two-phase presigned)
// ---------------------------------------------------------------------------

export async function getSnapshotUploadUrl(
  accessToken: string,
  projectId: string,
  topicId: string,
  viewpointId: string,
  contentLength: number,
): Promise<BcfSnapshotUploadResponse> {
  return apiClient.post<BcfSnapshotUploadResponse>(
    `${basePath(projectId)}/${topicId}/viewpoints/${viewpointId}/snapshot-upload`,
    { content_type: 'image/png', content_length: contentLength },
    BcfSnapshotUploadResponseSchema,
    accessToken,
  );
}

export async function confirmSnapshotUpload(
  accessToken: string,
  projectId: string,
  topicId: string,
  viewpointId: string,
  storageKey: string,
): Promise<void> {
  return apiClient.postNoContent(
    `${basePath(projectId)}/${topicId}/viewpoints/${viewpointId}/snapshot-complete`,
    accessToken,
    { storage_key: storageKey },
  );
}

/**
 * High-level helper: upload a snapshot data-URL to a viewpoint.
 * 1. Convert data URL to Blob
 * 2. Get presigned URL (passing blob size for the S3 signature)
 * 3. PUT to presigned URL
 * 4. Confirm upload
 */
export async function uploadSnapshot(
  accessToken: string,
  projectId: string,
  topicId: string,
  viewpointId: string,
  dataUrl: string,
): Promise<void> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();

  const { upload_url, storage_key } = await getSnapshotUploadUrl(
    accessToken,
    projectId,
    topicId,
    viewpointId,
    blob.size,
  );

  await apiClient.putRaw(upload_url, blob, 'image/png');

  await confirmSnapshotUpload(accessToken, projectId, topicId, viewpointId, storage_key);
}

// ---------------------------------------------------------------------------
// Import / Export
// ---------------------------------------------------------------------------

export async function importBcf(
  accessToken: string,
  projectId: string,
  file: File,
): Promise<BcfImportResponse> {
  const formData = new FormData();
  formData.append('file', file);
  return apiClient.postMultipart<BcfImportResponse>(
    `${basePath(projectId)}/import`,
    formData,
    BcfImportResponseSchema,
    accessToken,
  );
}

export async function exportBcf(
  accessToken: string,
  projectId: string,
): Promise<void> {
  const { blob, filename } = await apiClient.getBlob(
    `${basePath(projectId)}/export`,
    accessToken,
  );
  triggerBrowserDownload(blob, filename ?? 'bcf_export.bcf');
}

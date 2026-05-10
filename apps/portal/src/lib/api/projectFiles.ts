import { computeFileSha256 } from '../upload/sha256';
import { apiClient } from './client';
import {
  InitiateUploadResponseSchema,
  ProjectFileDownloadResponseSchema,
  ProjectFileListSchema,
  ProjectFileSchema,
  ViewerBundleResponseSchema,
  type InitiateUploadRequest,
  type InitiateUploadResponse,
  type ProjectFile,
  type ProjectFileDownloadResponse,
  type ProjectFileList,
  type ProjectFileStatusValue,
  type ViewerBundleResponse,
} from './schemas';

export type UploadProgressEvent =
  | { phase: 'hashing'; fraction: number }
  | { phase: 'uploading' }
  | { phase: 'completing' };

export async function initiateUpload(
  accessToken: string,
  projectId: string,
  modelId: string,
  input: InitiateUploadRequest,
): Promise<InitiateUploadResponse> {
  return apiClient.post<InitiateUploadResponse>(
    `/projects/${projectId}/models/${modelId}/files/initiate`,
    input,
    InitiateUploadResponseSchema,
    accessToken,
  );
}

export async function completeUpload(
  accessToken: string,
  projectId: string,
  modelId: string,
  fileId: string,
): Promise<ProjectFile> {
  return apiClient.post<ProjectFile>(
    `/projects/${projectId}/models/${modelId}/files/${fileId}/complete`,
    {},
    ProjectFileSchema,
    accessToken,
  );
}

export async function listProjectFiles(
  accessToken: string,
  projectId: string,
  modelId: string,
  status: ProjectFileStatusValue | 'all' = 'ready',
): Promise<ProjectFileList> {
  const params = new URLSearchParams();
  if (status === 'all') {
    params.set('status', 'all');
  }
  const query = params.size === 0 ? '' : `?${params.toString()}`;
  return apiClient.get<ProjectFileList>(
    `/projects/${projectId}/models/${modelId}/files${query}`,
    ProjectFileListSchema,
    accessToken,
  );
}

export async function deleteProjectFile(
  accessToken: string,
  projectId: string,
  modelId: string,
  fileId: string,
): Promise<void> {
  return apiClient.delete(
    `/projects/${projectId}/models/${modelId}/files/${fileId}`,
    accessToken,
  );
}

export async function getDownloadUrl(
  accessToken: string,
  projectId: string,
  modelId: string,
  fileId: string,
): Promise<ProjectFileDownloadResponse> {
  return apiClient.get<ProjectFileDownloadResponse>(
    `/projects/${projectId}/models/${modelId}/files/${fileId}/download`,
    ProjectFileDownloadResponseSchema,
    accessToken,
  );
}

export async function getViewerBundle(
  accessToken: string,
  projectId: string,
  modelId: string,
  fileId: string,
): Promise<ViewerBundleResponse> {
  return apiClient.get<ViewerBundleResponse>(
    `/projects/${projectId}/models/${modelId}/files/${fileId}/viewer-bundle`,
    ViewerBundleResponseSchema,
    accessToken,
  );
}

export async function retryExtraction(
  accessToken: string,
  projectId: string,
  modelId: string,
  fileId: string,
): Promise<ProjectFile> {
  return apiClient.post<ProjectFile>(
    `/projects/${projectId}/models/${modelId}/files/${fileId}/retry-extraction`,
    {},
    ProjectFileSchema,
    accessToken,
  );
}

export async function uploadFileEnd2End(
  accessToken: string,
  projectId: string,
  modelId: string,
  file: File,
  onProgress?: (event: UploadProgressEvent) => void,
): Promise<ProjectFile> {
  onProgress?.({ phase: 'hashing', fraction: 0 });
  const contentSha256 = await computeFileSha256(file, (fraction) => {
    onProgress?.({ phase: 'hashing', fraction });
  });

  onProgress?.({ phase: 'uploading' });
  const initiateResponse = await initiateUpload(accessToken, projectId, modelId, {
    filename: file.name,
    size_bytes: file.size,
    content_type: file.type === '' ? 'application/octet-stream' : file.type,
    content_sha256: contentSha256,
  });
  await apiClient.putRaw(
    initiateResponse.upload_url,
    file,
    file.type === '' ? 'application/octet-stream' : file.type,
  );

  onProgress?.({ phase: 'completing' });
  return completeUpload(accessToken, projectId, modelId, initiateResponse.file_id);
}

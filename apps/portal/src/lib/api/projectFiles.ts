import { computeFileSha256 } from '../upload/sha256';
import { apiClient } from './client';
import { projectScope } from './scope';
import {
  InitiateUploadResponseSchema,
  DocumentSchema,
  ProjectFileDownloadResponseSchema,
  ProjectFileListSchema,
  ProjectFileSchema,
  ProjectViewerManifestResponseSchema,
  ViewerBundleResponseSchema,
  type InitiateUploadRequest,
  type InitiateUploadResponse,
  type Document,
  type ProjectFile,
  type ProjectFileDownloadResponse,
  type ProjectFileList,
  type ProjectFileStatusValue,
  type ProjectViewerManifestResponse,
  type ViewerBundleResponse,
} from './schemas';

export type UploadProgressEvent =
  | { phase: 'hashing'; fraction: number }
  | { phase: 'uploading' }
  | { phase: 'completing' };

// Free (org-less) and paid callers share these fetchers; `free` swaps the
// `/free/projects` vs `/projects` prefix. The free two-phase upload + viewer
// bundles are byte-identical to paid (same schemas). `listProjectFiles`,
// `deleteProjectFile`, and `getDownloadUrl` are paid-only (no free endpoint).
const filesBase = (projectId: string, modelId: string, free: boolean): string =>
  `${projectScope(projectId, free)}/documents/${modelId}/files`;

export async function initiateUpload(
  accessToken: string,
  projectId: string,
  modelId: string,
  input: InitiateUploadRequest,
  free = false,
): Promise<InitiateUploadResponse> {
  return apiClient.post<InitiateUploadResponse>(
    `${filesBase(projectId, modelId, free)}/initiate`,
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
  free = false,
): Promise<ProjectFile> {
  return apiClient.post<ProjectFile>(
    `${filesBase(projectId, modelId, free)}/${fileId}/complete`,
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
    `${filesBase(projectId, modelId, false)}${query}`,
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
    `${filesBase(projectId, modelId, false)}/${fileId}`,
    accessToken,
  );
}

/**
 * Restore an older model version as the current head (F7). Repoints the model's
 * `head_file_id` at the chosen version — no bytes are re-uploaded and no new
 * version is created. Returns the updated model (with the new `head_file_id`).
 */
export async function restoreModelFileVersion(
  accessToken: string,
  projectId: string,
  modelId: string,
  fileId: string,
  free = false,
): Promise<Document> {
  return apiClient.post<Document>(
    `${filesBase(projectId, modelId, free)}/${fileId}/restore`,
    {},
    DocumentSchema,
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
    `${filesBase(projectId, modelId, false)}/${fileId}/download`,
    ProjectFileDownloadResponseSchema,
    accessToken,
  );
}

export async function getViewerBundle(
  accessToken: string,
  projectId: string,
  modelId: string,
  fileId: string,
  free = false,
): Promise<ViewerBundleResponse> {
  return apiClient.get<ViewerBundleResponse>(
    `${filesBase(projectId, modelId, free)}/${fileId}/viewer-bundle`,
    ViewerBundleResponseSchema,
    accessToken,
  );
}

/**
 * Project-level federated viewer manifest: one entry per model with a ready
 * IFC file (presigned artifact URLs + discipline classification). Powers the
 * multi-discipline viewer that loads several models into one scene.
 */
export async function getProjectViewerBundle(
  accessToken: string,
  projectId: string,
  free = false,
): Promise<ProjectViewerManifestResponse> {
  return apiClient.get<ProjectViewerManifestResponse>(
    `${projectScope(projectId, free)}/viewer-bundle`,
    ProjectViewerManifestResponseSchema,
    accessToken,
  );
}

export async function retryExtraction(
  accessToken: string,
  projectId: string,
  modelId: string,
  fileId: string,
  free = false,
): Promise<ProjectFile> {
  return apiClient.post<ProjectFile>(
    `${filesBase(projectId, modelId, free)}/${fileId}/retry-extraction`,
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
  free = false,
): Promise<ProjectFile> {
  onProgress?.({ phase: 'hashing', fraction: 0 });
  const contentSha256 = await computeFileSha256(file, (fraction) => {
    onProgress?.({ phase: 'hashing', fraction });
  });

  onProgress?.({ phase: 'uploading' });
  const initiateResponse = await initiateUpload(
    accessToken,
    projectId,
    modelId,
    {
      filename: file.name,
      size_bytes: file.size,
      content_type: file.type === '' ? 'application/octet-stream' : file.type,
      content_sha256: contentSha256,
    },
    free,
  );
  await apiClient.putRaw(
    initiateResponse.upload_url,
    file,
    file.type === '' ? 'application/octet-stream' : file.type,
  );

  onProgress?.({ phase: 'completing' });
  return completeUpload(accessToken, projectId, modelId, initiateResponse.file_id, free);
}

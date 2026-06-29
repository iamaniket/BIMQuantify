import { apiClient } from './client';
import { AttachmentDownloadResponseSchema, type AttachmentDownloadResponse } from './schemas';

// FREE-tier attachment download (photo evidence on free snags). Mirrors the paid
// `getAttachmentViewUrl` but on the `/free/*` surface so a free (org-less) user
// — who has no `org` JWT claim — can view photos logged on mobile.
export async function getFreeAttachmentViewUrl(
  accessToken: string,
  projectId: string,
  attachmentId: string,
): Promise<AttachmentDownloadResponse> {
  return apiClient.get<AttachmentDownloadResponse>(
    `/free/projects/${projectId}/attachments/${attachmentId}/download?disposition=inline`,
    AttachmentDownloadResponseSchema,
    accessToken,
  );
}

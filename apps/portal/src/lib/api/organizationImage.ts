import { z } from 'zod';

import { apiClient } from './client';
import { env } from '@/lib/env';

const OrgImageResponseSchema = z.object({
  image_url: z.string(),
});

export type OrgImageResponse = z.infer<typeof OrgImageResponseSchema>;

async function _uploadImage(path: string, accessToken: string, file: File): Promise<OrgImageResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });
  if (!response.ok) {
    throw new Error(`Org image upload failed: ${response.statusText}`);
  }
  const raw: unknown = await response.json();
  return OrgImageResponseSchema.parse(raw);
}

export async function uploadOrgImage(
  accessToken: string,
  organizationId: string,
  file: File,
): Promise<OrgImageResponse> {
  return _uploadImage(`/organizations/${organizationId}/image`, accessToken, file);
}

export async function deleteOrgImage(accessToken: string, organizationId: string): Promise<void> {
  return apiClient.delete(`/organizations/${organizationId}/image`, accessToken);
}

export async function uploadAdminOrgImage(
  accessToken: string,
  organizationId: string,
  file: File,
): Promise<OrgImageResponse> {
  return _uploadImage(`/admin/organizations/${organizationId}/image`, accessToken, file);
}

export async function deleteAdminOrgImage(accessToken: string, organizationId: string): Promise<void> {
  return apiClient.delete(`/admin/organizations/${organizationId}/image`, accessToken);
}

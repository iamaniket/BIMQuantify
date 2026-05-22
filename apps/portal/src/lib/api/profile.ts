import { z } from 'zod';

import { apiClient } from './client';
import { env } from '@/lib/env';

const ProfileReadSchema = z.object({
  full_name: z.union([z.string(), z.null()]),
  email: z.string(),
  avatar_url: z.union([z.string(), z.null()]),
});

export type ProfileRead = z.infer<typeof ProfileReadSchema>;

const AvatarResponseSchema = z.object({
  avatar_url: z.string(),
});

export type AvatarResponse = z.infer<typeof AvatarResponseSchema>;

export async function updateProfile(
  accessToken: string,
  data: { full_name?: string },
): Promise<ProfileRead> {
  return apiClient.patch<ProfileRead>('/me/profile', data, ProfileReadSchema, accessToken);
}

export async function uploadAvatar(accessToken: string, file: File): Promise<AvatarResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}/me/avatar`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });
  if (!response.ok) {
    throw new Error(`Avatar upload failed: ${response.statusText}`);
  }
  const raw: unknown = await response.json();
  return AvatarResponseSchema.parse(raw);
}

export async function deleteAvatar(accessToken: string): Promise<void> {
  return apiClient.delete('/me/avatar', accessToken);
}

export async function getAvatarUrl(accessToken: string): Promise<string> {
  const data = await apiClient.get<AvatarResponse>(
    '/me/avatar-url',
    AvatarResponseSchema,
    accessToken,
  );
  return data.avatar_url;
}

import { z } from 'zod';

import { apiClient } from './client';
import {
  AuthMeResponseSchema,
  TokenPairSchema,
  type AuthMeResponse,
  type TokenPair,
} from './schemas/auth';

/** Fetch the current user's profile + all org memberships + project roles. */
export async function getAuthMe(accessToken: string): Promise<AuthMeResponse> {
  return apiClient.get('/auth/me', AuthMeResponseSchema, accessToken);
}

const OrgNameUpdateResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export async function updateOrganizationName(
  accessToken: string,
  organizationId: string,
  name: string,
): Promise<{ id: string; name: string }> {
  return apiClient.patch(
    `/organizations/${organizationId}`,
    { name },
    OrgNameUpdateResponseSchema,
    accessToken,
  );
}

/** Switch the active org for the current user. Re-mints both access + refresh
 * tokens — the caller should replace the stored token pair atomically. */
export async function switchOrganization(
  organizationId: string,
  accessToken: string,
): Promise<TokenPair> {
  return apiClient.post(
    '/auth/switch-organization',
    { organization_id: organizationId },
    TokenPairSchema,
    accessToken,
  );
}

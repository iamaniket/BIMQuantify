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
 * tokens — the caller should replace the stored token pair atomically. Sends the
 * current refresh token so the server can (a) revoke it and (b) cap the successor
 * to its remaining life (absolute session cap; AUTH-SESS-1). */
export async function switchOrganization(
  organizationId: string,
  accessToken: string,
  refreshToken: string,
): Promise<TokenPair> {
  return apiClient.post(
    '/auth/switch-organization',
    { organization_id: organizationId, refresh_token: refreshToken },
    TokenPairSchema,
    accessToken,
  );
}

/** Enter the org-less "Free workspace": re-mints a token pair with NO org claim
 * so the next requests run in the pooled free context. Same atomic-replace rule
 * as switchOrganization; sends the refresh token for the same revoke + cap. */
export async function switchToFree(
  accessToken: string,
  refreshToken: string,
): Promise<TokenPair> {
  return apiClient.post(
    '/auth/switch-to-free',
    { refresh_token: refreshToken },
    TokenPairSchema,
    accessToken,
  );
}

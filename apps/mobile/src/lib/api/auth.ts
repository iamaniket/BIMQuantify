import { apiClient, ApiError } from '@/lib/api/client';
import { env } from '@/lib/env';
import {
  AccessTokenResponseSchema,
  AuthMeResponseSchema,
  TokenPairSchema,
  type AuthMeResponse,
  type TokenPair,
} from '@/lib/api/schemas/auth';

/** POST /auth/jwt/login — form-encoded (OAuth2PasswordRequestForm). */
export async function login(username: string, password: string): Promise<TokenPair> {
  return apiClient.postForm('/auth/jwt/login', { username, password }, TokenPairSchema);
}

/** POST /auth/jwt/refresh — sends the refresh token in the body, no auth header
 * (mirrors the portal: the expired access token must NOT be attached). Returns
 * the new access token AND the rotated refresh token (the server retires the
 * presented one each call); `refreshToken` is null only if a non-rotating server
 * omits it. */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string | null }> {
  const response = await fetch(`${env.EXPO_PUBLIC_API_URL}/auth/jwt/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!response.ok) {
    throw new ApiError(response.status, 'refresh_failed');
  }
  const raw: unknown = await response.json();
  const parsed = AccessTokenResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(500, 'Invalid refresh response');
  }
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token ?? null,
  };
}

/** GET /auth/me — current user + memberships + active org. */
export async function getAuthMe(accessToken: string): Promise<AuthMeResponse> {
  return apiClient.get('/auth/me', AuthMeResponseSchema, accessToken);
}

/** POST /auth/switch-organization — re-mints BOTH tokens; replace the pair atomically.
 * Sends the current refresh token so the server revokes it and caps the successor to
 * its remaining life (absolute session cap; AUTH-SESS-1). */
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

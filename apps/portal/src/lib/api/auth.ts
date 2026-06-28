import { env } from '@/lib/env';

import { ApiError } from './client';
import { AccessTokenResponseSchema } from './schemas/auth';

/**
 * POST /auth/jwt/refresh. Returns the new access token AND the rotated refresh
 * token (the server retires the presented one each call). `refreshToken` is null
 * only if a non-rotating server omits it; callers keep their existing token then.
 */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string | null }> {
  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}/auth/jwt/refresh`, {
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

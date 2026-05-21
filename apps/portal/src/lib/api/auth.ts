import { env } from '@/lib/env';

import { ApiError } from './client';
import { AccessTokenResponseSchema } from './schemas/auth';

export async function refreshAccessToken(refreshToken: string): Promise<string> {
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

  return parsed.data.access_token;
}

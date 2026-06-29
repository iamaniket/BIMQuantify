import { apiClient } from './client';
import { FreeUserUsageSchema, type FreeUserUsage } from './schemas';

/**
 * Self-serve free-tier usage — the calling user's own data footprint (storage,
 * projects, containers, snags) vs. the configured caps. Powers the account
 * page's "Plan & usage" card for org-less users.
 *
 * Backed by `GET /free/account/usage` (FREE_TIER gated). Reuses the same
 * `FreeUserUsage` contract the super-admin Free-users table consumes, so there
 * is a single source of truth for the usage shape.
 */
export async function getFreeUsage(accessToken: string): Promise<FreeUserUsage> {
  return apiClient.get<FreeUserUsage>(
    '/free/account/usage',
    FreeUserUsageSchema,
    accessToken,
  );
}

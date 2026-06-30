import { apiClient } from './client';
import {
  FreeAccountLimitsSchema,
  FreeUserUsageSchema,
  type FreeAccountLimits,
  type FreeUserUsage,
} from './schemas';

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

/**
 * The calling user's own effective free caps + trial countdown
 * (`account_expires_at` / `days_remaining` / `expired`). Powers the trial banner.
 * Backed by `GET /free/account/limits` (FREE_TIER gated).
 */
export async function getFreeLimits(accessToken: string): Promise<FreeAccountLimits> {
  return apiClient.get<FreeAccountLimits>(
    '/free/account/limits',
    FreeAccountLimitsSchema,
    accessToken,
  );
}

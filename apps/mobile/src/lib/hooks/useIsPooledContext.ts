import { useAuth } from '@/providers/AuthProvider';

/**
 * Whether the signed-in user is a FREE-tier (org-less) user — mirrors the portal's
 * `useIsPooledContext` (`me.active_organization_id == null`). When true, the data
 * hooks call the parallel `/free/*` endpoints instead of the org-scoped paid ones
 * (a free user has no `org` JWT claim, so the paid endpoints 409).
 *
 * Safe to read on any post-login screen: the auth gate (`app/index.tsx`) only
 * routes onward once `/auth/me` has resolved (or a cached `me` is seeded on an
 * offline cold-launch), so `me` is non-null by the time these screens mount. A
 * paid user who hasn't picked an org yet is sent to `/select-org` first, so they
 * never reach a data screen with `active_organization_id === null`.
 */
export function useIsPooledContext(): boolean {
  const { me } = useAuth();
  return me !== null && me.active_organization_id === null;
}

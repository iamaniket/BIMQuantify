'use client';

import { useAuth } from '@/providers/AuthProvider';

/**
 * A "free" user is an email-verified account with NO org membership — the
 * pooled, org-less free-tier identity (D2 of the free-wedge design). Such a
 * user can't call any org-scoped (`get_tenant_session`) endpoint, so the
 * dashboard shell must render a trimmed, free-aware variant for them.
 *
 * `ready` is false until `/auth/me` has loaded; consumers should defer
 * org-scoped rendering until then to avoid a 409 flash. A user with a pending
 * (not-yet-accepted) org invite is NOT treated as free — `_flip_pending_memberships`
 * turns them into an org member on first login.
 */
export function useIsFreeUser(): { isFreeUser: boolean; ready: boolean } {
  const { me } = useAuth();
  if (me === null) return { isFreeUser: false, ready: false };
  const isFreeUser =
    me.memberships.length === 0 && (me.pending_invitations_count ?? 0) === 0;
  return { isFreeUser, ready: true };
}

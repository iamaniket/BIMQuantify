'use client';

import { useAuth } from '@/providers/AuthProvider';

/**
 * The acting principal's PLAN — the ENTITLEMENT / TIER axis, deliberately
 * distinct from {@link useIsPooledContext} (the ISOLATION axis = which data plane a
 * request resolves to). The server resolves it (`/auth/me.plan`): `'free'` when
 * org-less, else the active org's plan.
 *
 * Read this for TIER-based UI gating (upgrade prompts, feature availability),
 * NOT for choosing an endpoint/data plane — that stays driven by
 * `useIsPooledContext`/the JWT. The server re-checks entitlement on every gated
 * action, so this value is presentation-only and must never be trusted as
 * authorization.
 *
 * `ready` is false until `/auth/me` has loaded. While loading (or against an
 * older server that doesn't yet send `plan`) it falls back to deriving the plan
 * from org-presence so callers degrade gracefully.
 */
export function usePlan(): { plan: string; isFreePlan: boolean; ready: boolean } {
  const { me } = useAuth();
  if (me === null) return { plan: 'free', isFreePlan: true, ready: false };
  const plan = me.plan ?? (me.active_organization_id == null ? 'free' : 'paid');
  return { plan, isFreePlan: plan === 'free', ready: true };
}

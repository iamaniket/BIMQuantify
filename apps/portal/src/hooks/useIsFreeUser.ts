'use client';

import { useAuth } from '@/providers/AuthProvider';

/**
 * Free-CONTEXT detection. The caller is in the org-less "Free workspace" when
 * their active org claim is null — a property of the ACTIVE CONTEXT, not the
 * person. A pure free user (no orgs) is always in free context; a PAID user who
 * switches to the Free workspace (`active_organization_id` → null) is too, and
 * then sees the free UI + hits the `/free/*` endpoints. In org context they
 * don't. (This replaced the old "no memberships" person-level check so the
 * Free-workspace toggle works for users who also belong to an org.)
 *
 * `ready` is false until `/auth/me` has loaded; consumers defer org-scoped
 * rendering until then to avoid a 409 flash.
 *
 * The returned field stays named `isFreeUser` so existing consumers compile
 * unchanged; `useIsFreeContext` is the canonical name for new code.
 */
export function useIsFreeContext(): { isFreeUser: boolean; ready: boolean } {
  const { me } = useAuth();
  if (me === null) return { isFreeUser: false, ready: false };
  return { isFreeUser: me.active_organization_id == null, ready: true };
}

/** @deprecated Use {@link useIsFreeContext}. Kept as an alias so the ~14 existing
 * consumers compile without churn; semantics are identical. */
export const useIsFreeUser = useIsFreeContext;

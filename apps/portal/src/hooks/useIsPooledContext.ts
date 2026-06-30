'use client';

import { useAuth } from '@/providers/AuthProvider';

/**
 * Pooled-CONTEXT detection (the org-less "Free workspace"). The caller is in the
 * pooled context when their active org claim is null — a property of the ACTIVE
 * CONTEXT, not the person. A pure free user (no orgs) is always in pooled context;
 * a PAID user who switches to the Free workspace (`active_organization_id` → null)
 * is too, and then hits the `/pooled/*` endpoints. In org context they don't.
 * (This replaced the old "no memberships" person-level check so the Free-workspace
 * toggle works for users who also belong to an org.)
 *
 * `ready` is false until `/auth/me` has loaded; consumers defer org-scoped
 * rendering until then to avoid a 409 flash.
 */
export function useIsPooledContext(): { isPooled: boolean; ready: boolean } {
  const { me } = useAuth();
  if (me === null) return { isPooled: false, ready: false };
  return { isPooled: me.active_organization_id == null, ready: true };
}

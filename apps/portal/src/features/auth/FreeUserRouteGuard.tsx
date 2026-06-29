'use client';

import { usePathname, useRouter } from '@/i18n/navigation';
import { useEffect, type JSX } from 'react';

import { useIsFreeUser } from '@/hooks/useIsFreeUser';

/**
 * Keeps a free (org-less) user inside the routes they can actually use. Free
 * users now get the same projects experience as paid (their data is served from
 * the pooled `/free/*` surface via free-aware hooks), so the project list, a
 * project's detail page, and its snag board are all allowed. The remaining
 * org-only surfaces — the project's access/activity/certificates/reports/
 * deadlines sub-pages and the top-level `/certificates`, `/templates`,
 * `/calendar`, `/tenant` routes — hit `require_active_organization` and 409
 * without an org, so they redirect back to `/projects`. Free users now share the
 * unified 3D/2D viewer with paid at `/projects/[id]/viewer` (its bundle fetch
 * routes to `/free/*`); that route lives in the separate `(viewer)` group.
 *
 * Pathname here is locale-stripped (next-intl).
 */
const FREE_ALLOWED_EXACT = new Set(['/projects', '/settings', '/help', '/account']);

/** `/projects/<id>` (detail), `/projects/<id>/findings` (snag board), and
 * `/projects/<id>/viewer` (the unified 3D/2D viewer free users now share with
 * paid) are free-served; every other `/projects/<id>/<sub>` page is org-only.
 * (The viewer lives in the `(viewer)` route group, outside this dashboard guard,
 * so this is defensive — keeps the guard from redirecting a free user mid-nav.) */
const FREE_PROJECT_DETAIL = /^\/projects\/[^/]+$/;
const FREE_PROJECT_FINDINGS = /^\/projects\/[^/]+\/findings(\/|$)/;
const FREE_PROJECT_VIEWER = /^\/projects\/[^/]+\/viewer(\/|$)/;

function isFreeAllowed(pathname: string): boolean {
  if (FREE_ALLOWED_EXACT.has(pathname)) return true;
  if (
    FREE_PROJECT_DETAIL.test(pathname)
    || FREE_PROJECT_FINDINGS.test(pathname)
    || FREE_PROJECT_VIEWER.test(pathname)
  ) return true;
  // Nested settings/help/account subpages are user-scoped.
  return (
    pathname.startsWith('/settings/')
    || pathname.startsWith('/help/')
    || pathname.startsWith('/account/')
  );
}

export function FreeUserRouteGuard(): JSX.Element | null {
  const { isFreeUser, ready } = useIsFreeUser();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!ready || !isFreeUser) return;
    if (!isFreeAllowed(pathname)) {
      router.replace('/projects');
    }
  }, [ready, isFreeUser, pathname, router]);

  return null;
}

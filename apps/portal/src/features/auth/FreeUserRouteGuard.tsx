'use client';

import { usePathname, useRouter } from '@/i18n/navigation';
import { useEffect, type JSX } from 'react';

import { useIsFreeUser } from '@/hooks/useIsFreeUser';

/**
 * Keeps a free (org-less) user inside the routes they can actually use. Every
 * org-scoped dashboard page (`/projects/[id]`, `/certificates`, `/templates`,
 * `/calendar`, `/tenant`, …) hits `get_tenant_session` + `require_active_organization`
 * and 409s without an org, so we redirect free users back to `/projects` (their
 * free-models home). The immersive `/free-viewer/[id]` viewer lives outside the
 * dashboard route group, so it's unaffected by this guard.
 *
 * Allowed for free users: `/projects` (their models), `/settings`, `/help`,
 * `/account` — all user-scoped. Pathname here is locale-stripped (next-intl).
 */
const FREE_ALLOWED_EXACT = new Set(['/projects', '/settings', '/help', '/account']);

function isFreeAllowed(pathname: string): boolean {
  if (FREE_ALLOWED_EXACT.has(pathname)) return true;
  // Nested settings/help/account subpages are user-scoped; `/projects/[id]` is NOT.
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

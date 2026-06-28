'use client';

import { useEffect, type JSX, type ReactNode } from 'react';

import { useRouter } from '@/i18n/navigation';
import { useAuth } from '@/providers/AuthProvider';

type Props = {
  children: ReactNode;
};

/**
 * Isolated free-viewer shell. Requires a signed-in token but — unlike the
 * (dashboard)/(viewer) layouts — does NOT require an org membership or render
 * the org-coupled Sidebar/AppHeader, so a free, org-less account renders here
 * without being bounced to a workspace switcher.
 */
export default function FreeViewerLayout({ children }: Props): JSX.Element {
  const router = useRouter();
  const { tokens, hasHydrated } = useAuth();

  useEffect(() => {
    if (hasHydrated && tokens === null) {
      router.replace('/login');
    }
  }, [router, tokens, hasHydrated]);

  if (!hasHydrated || tokens === null) {
    return <main className="flex flex-1 items-center justify-center" />;
  }

  return <div className="flex min-h-screen flex-col bg-surface-low">{children}</div>;
}

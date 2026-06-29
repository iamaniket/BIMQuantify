'use client';

import { useRouter } from '@/i18n/navigation';
import { useEffect, type JSX, type ReactNode } from 'react';

import { AppHeaderProvider } from '@/components/shared/header/AppHeaderContext';
import { AppHeaderRoute } from '@/features/navigation/AppHeaderRoute';
import { Sidebar } from '@/components/shared/sidebar/Sidebar';
import { SidebarProvider } from '@/components/shared/sidebar/SidebarContext';
import { useIsFreeUser } from '@/hooks/useIsFreeUser';
import { useNotificationSocket } from '@/hooks/useNotificationSocket';
import { useAuth } from '@/providers/AuthProvider';

type Props = {
  children: ReactNode;
};

export default function ViewerLayout({ children }: Props): JSX.Element {
  const router = useRouter();
  const { tokens, hasHydrated } = useAuth();
  const { isFreeUser, ready } = useIsFreeUser();
  // Free (org-less) users now reach the unified viewer too — point them at their
  // per-user free notification channel (gated on /auth/me) so we never open the
  // org socket for them.
  useNotificationSocket(
    ready && tokens !== null ? tokens.access_token : null,
    { free: isFreeUser },
  );

  useEffect(() => {
    if (hasHydrated && tokens === null) {
      router.replace('/login');
    }
  }, [router, tokens, hasHydrated]);

  if (!hasHydrated || tokens === null) {
    return <main className="flex flex-1 items-center justify-center" />;
  }

  return (
    <AppHeaderProvider>
      <SidebarProvider forceCollapsed>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <AppHeaderRoute />
            <div className="flex min-h-0 flex-1 flex-col animate-viewer-fade-in">
              {children}
            </div>
          </div>
        </div>
      </SidebarProvider>
    </AppHeaderProvider>
  );
}

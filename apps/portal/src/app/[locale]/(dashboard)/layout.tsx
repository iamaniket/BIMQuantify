'use client';

import { useRouter } from '@/i18n/navigation';
import { useEffect, type JSX, type ReactNode } from 'react';

import { AppHeaderProvider } from '@/components/shared/header/AppHeaderContext';
import { AppHeaderRoute } from '@/features/navigation/AppHeaderRoute';
import { FreeUserRouteGuard } from '@/features/auth/FreeUserRouteGuard';
import { Sidebar } from '@/components/shared/sidebar/Sidebar';
import { SidebarProvider } from '@/components/shared/sidebar/SidebarContext';
import { useIsFreeUser } from '@/hooks/useIsFreeUser';
import { useNotificationSocket } from '@/hooks/useNotificationSocket';
import { useAuth } from '@/providers/AuthProvider';

type Props = {
  children: ReactNode;
};

export default function DashboardLayout({ children }: Props): JSX.Element {
  const router = useRouter();
  const { tokens, hasHydrated } = useAuth();
  const { isFreeUser, ready } = useIsFreeUser();
  // Notifications are org-scoped — never open the socket for a free (org-less)
  // user, and wait until /auth/me resolves so we don't connect-then-drop.
  useNotificationSocket(ready && !isFreeUser && tokens !== null ? tokens.access_token : null);

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
      <SidebarProvider>
        <FreeUserRouteGuard />
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <AppHeaderRoute />
            <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
          </div>
        </div>
      </SidebarProvider>
    </AppHeaderProvider>
  );
}

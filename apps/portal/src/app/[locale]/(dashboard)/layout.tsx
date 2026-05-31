'use client';

import { useRouter } from '@/i18n/navigation';
import { useEffect, type JSX, type ReactNode } from 'react';

import { AppHeaderProvider } from '@/components/shared/header/AppHeaderContext';
import { AppHeaderRoute } from '@/features/navigation/AppHeaderRoute';
import { Sidebar } from '@/components/shared/sidebar/Sidebar';
import { SidebarProvider } from '@/components/shared/sidebar/SidebarContext';
import { useNotificationSocket } from '@/hooks/useNotificationSocket';
import { useAuth } from '@/providers/AuthProvider';

type Props = {
  children: ReactNode;
};

export default function DashboardLayout({ children }: Props): JSX.Element {
  const router = useRouter();
  const { tokens, hasHydrated } = useAuth();
  useNotificationSocket(tokens === null ? null : tokens.access_token);

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
        <div className="flex h-screen">
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

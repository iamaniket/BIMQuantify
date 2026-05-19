'use client';

import { usePathname, useRouter } from '@/i18n/navigation';
import { useEffect, type JSX, type ReactNode } from 'react';

import { AppHeaderProvider } from '@/components/header/AppHeaderContext';
import { AppHeaderRoute } from '@/components/header/AppHeaderRoute';
import { DashboardFooter } from '@/components/DashboardFooter';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { SidebarProvider } from '@/components/sidebar/SidebarContext';
import { useNotificationSocket } from '@/hooks/useNotificationSocket';
import { useAuth } from '@/providers/AuthProvider';

type Props = {
  children: ReactNode;
};

export default function DashboardLayout({ children }: Props): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const { tokens, hasHydrated } = useAuth();
  useNotificationSocket(tokens === null ? null : tokens.access_token);
  const hideFooterOnProjects = pathname === '/projects' || pathname.startsWith('/projects/');

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
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
              {hideFooterOnProjects ? null : <DashboardFooter />}
            </div>
          </div>
        </div>
      </SidebarProvider>
    </AppHeaderProvider>
  );
}

'use client';

import { useRouter } from '@/i18n/navigation';
import { useEffect, type JSX, type ReactNode } from 'react';

import { AppHeaderProvider } from '@/components/header/AppHeaderContext';
import { AppHeaderRoute } from '@/components/header/AppHeaderRoute';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { SidebarProvider } from '@/components/sidebar/SidebarContext';
import { useAuth } from '@/providers/AuthProvider';

type Props = {
  children: ReactNode;
};

/**
 * Super-admin shell. Mirrors (dashboard)/layout but additionally requires
 * `is_superuser`. Non-admins land back on `/` rather than seeing chrome
 * for routes they can't query anyway.
 */
export default function AdminLayout({ children }: Props): JSX.Element {
  const router = useRouter();
  const { tokens, hasHydrated, me } = useAuth();

  useEffect(() => {
    if (!hasHydrated) return;
    if (tokens === null) {
      router.replace('/login');
      return;
    }
    if (me !== null && !me.user.is_superuser) {
      router.replace('/');
    }
  }, [router, tokens, hasHydrated, me]);

  // Hold the chrome until we know the user is allowed to see it.
  if (!hasHydrated || tokens === null || me === null || !me.user.is_superuser) {
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

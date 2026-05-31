'use client';

import { useRouter } from '@/i18n/navigation';
import { useEffect, type JSX, type ReactNode } from 'react';

import { AppHeaderProvider } from '@/components/shared/header/AppHeaderContext';
import { AppHeaderRoute } from '@/features/navigation/AppHeaderRoute';
import { Sidebar } from '@/components/shared/sidebar/Sidebar';
import { SidebarProvider } from '@/components/shared/sidebar/SidebarContext';
import { useAuth } from '@/providers/AuthProvider';

type Props = {
  children: ReactNode;
};

export default function TenantAdminLayout({ children }: Props): JSX.Element {
  const router = useRouter();
  const { tokens, hasHydrated, me, activeMembership } = useAuth();
  const isSuperuser = me?.user.is_superuser === true;
  const isOrgAdmin = activeMembership?.is_org_admin === true;
  const allowed = isSuperuser || isOrgAdmin;

  useEffect(() => {
    if (!hasHydrated) return;
    if (tokens === null) {
      router.replace('/login');
      return;
    }
    if (me !== null && !allowed) {
      router.replace('/');
    }
  }, [router, tokens, hasHydrated, me, allowed]);

  if (!hasHydrated || tokens === null || me === null || !allowed) {
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

'use client';


import { useRouter } from '@/i18n/navigation';
import { useEffect, type JSX } from 'react';
import { useAuth } from '@/providers/AuthProvider';

export default function PortalRootPage(): JSX.Element {
  const router = useRouter();
  const { tokens, hasHydrated, me } = useAuth();

  useEffect(() => {
    if (!hasHydrated) return;
    if (!tokens) {
      router.replace('/login');
      return;
    }
    if (me && me.memberships.length > 1) {
      router.replace('/select-tenant');
      return;
    }
    router.replace('/projects');
  }, [router, tokens, hasHydrated, me]);

  return <main className="flex min-h-screen items-center justify-center" />;
}

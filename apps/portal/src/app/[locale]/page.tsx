'use client';

import { useRouter } from '@/i18n/navigation';
import { useEffect, type JSX } from 'react';

import { useAuth } from '@/providers/AuthProvider';

export default function PortalRootPage(): JSX.Element {
  const router = useRouter();
  const { tokens, hasHydrated } = useAuth();

  useEffect(() => {
    if (!hasHydrated) return;
    router.replace(tokens === null ? '/login' : '/projects');
  }, [router, tokens, hasHydrated]);

  return <main className="flex min-h-screen items-center justify-center" />;
}

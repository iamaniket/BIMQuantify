'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type JSX } from 'react';

import { useAuth } from '@/providers/AuthProvider';

export default function PortalRootPage(): JSX.Element {
  const router = useRouter();
  const { tokens, hasHydrated } = useAuth();

  useEffect(() => {
    if (!hasHydrated) return;
    router.replace(tokens === null ? '/login' : '/projects');
  }, [router, tokens, hasHydrated]);

  return <main className="flex flex-1 items-center justify-center" />;
}

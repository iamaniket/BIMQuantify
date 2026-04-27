'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type JSX } from 'react';

import { useAuth } from '@/providers/AuthProvider';

export default function PortalRootPage(): JSX.Element {
  const router = useRouter();
  const { tokens } = useAuth();

  useEffect(() => {
    router.replace(tokens === null ? '/login' : '/dashboard');
  }, [router, tokens]);

  return <main className="flex flex-1 items-center justify-center" />;
}

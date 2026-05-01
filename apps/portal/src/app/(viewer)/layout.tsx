'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type JSX, type ReactNode } from 'react';

import { useAuth } from '@/providers/AuthProvider';

type Props = {
  children: ReactNode;
};

export default function ViewerLayout({ children }: Props): JSX.Element {
  const router = useRouter();
  const { tokens, hasHydrated } = useAuth();

  useEffect(() => {
    if (hasHydrated && tokens === null) {
      router.replace('/login');
    }
  }, [router, tokens, hasHydrated]);

  if (!hasHydrated || tokens === null) {
    return <main className="flex flex-1 items-center justify-center" />;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {children}
    </div>
  );
}

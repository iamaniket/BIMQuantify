'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type JSX } from 'react';

import { useAuth } from '@/providers/AuthProvider';

export default function DashboardPage(): JSX.Element {
  const router = useRouter();
  const { tokens } = useAuth();

  useEffect(() => {
    if (tokens === null) {
      router.replace('/login');
    }
  }, [router, tokens]);

  if (tokens === null) {
    return <main className="flex flex-1 items-center justify-center" />;
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-16">
      <h1 className="text-h4 font-semibold text-foreground">Welcome to BIMstitch</h1>
      <p className="text-body1 text-foreground-secondary">
        You are signed in. Project tooling will land here in a future iteration.
      </p>
    </main>
  );
}

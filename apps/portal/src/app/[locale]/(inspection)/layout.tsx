'use client';

import { useRouter } from '@/i18n/navigation';
import { useEffect, type JSX, type ReactNode } from 'react';

import { useNotificationSocket } from '@/hooks/useNotificationSocket';
import { getSyncEngine } from '@/lib/offline/sync.js';
import { useAuth } from '@/providers/AuthProvider';

type Props = {
  children: ReactNode;
};

export default function InspectionLayout({ children }: Props): JSX.Element {
  const router = useRouter();
  const { tokens, hasHydrated } = useAuth();
  useNotificationSocket(tokens === null ? null : tokens.access_token);

  useEffect(() => {
    if (hasHydrated && tokens === null) {
      router.replace('/login');
    }
  }, [router, tokens, hasHydrated]);

  useEffect(() => {
    const engine = getSyncEngine();
    engine.start();
    return () => { engine.stop(); };
  }, []);

  if (!hasHydrated || tokens === null) {
    return <main className="flex flex-1 items-center justify-center" />;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {children}
    </div>
  );
}

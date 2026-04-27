'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { JSX } from 'react';

import { Button, ThemeToggle } from '@bimstitch/ui';

import { useAuth } from '@/providers/AuthProvider';

export function Header(): JSX.Element {
  const router = useRouter();
  const { tokens, setTokens } = useAuth();
  const isAuthenticated = tokens !== null;

  const onSignOut = (): void => {
    setTokens(null);
    router.replace('/login');
  };

  return (
    <header className="sticky top-0 z-30 w-full border-b border-border bg-background-secondary/80 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <Link
          href={isAuthenticated ? '/dashboard' : '/login'}
          className="text-title2 font-semibold text-foreground hover:text-primary"
        >
          BIMstitch
        </Link>

        <nav className="flex items-center gap-2">
          <ThemeToggle />
          {isAuthenticated ? (
            <Button variant="border" size="sm" onClick={onSignOut}>
              Sign out
            </Button>
          ) : null}
        </nav>
      </div>
    </header>
  );
}

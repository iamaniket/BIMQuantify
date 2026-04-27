import Link from 'next/link';
import type { JSX } from 'react';

import { Button, ThemeToggle } from '@bimstitch/ui';

const portalUrl = process.env['NEXT_PUBLIC_PORTAL_URL'] ?? 'http://localhost:3001';

export function Header(): JSX.Element {
  return (
    <header className="sticky top-0 z-30 w-full border-b border-border bg-background-secondary/80 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <Link
          href="/"
          className="text-title2 font-semibold text-foreground hover:text-primary"
        >
          BIMstitch
        </Link>

        <nav className="flex items-center gap-2">
          <ThemeToggle />
          <a href={portalUrl}>
            <Button variant="primary" size="sm">
              Log in
            </Button>
          </a>
        </nav>
      </div>
    </header>
  );
}

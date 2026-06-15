'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect, type JSX } from 'react';

type Props = { error: Error; reset: () => void };

/**
 * Catastrophic fallback: replaces the root layout, so it must render its own
 * <html>/<body> and cannot use the locale i18n provider — hence the minimal
 * hardcoded English copy (the no-literal-string lint is disabled for this file
 * in eslint.config.mjs). Mounting this is what restores Sentry capture for
 * root-level client render errors in the App Router.
 */
export default function GlobalError({ error, reset }: Props): JSX.Element {
  useEffect(() => {
    Sentry.captureException(error, { tags: { scope: 'global' } });
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="flex max-w-md flex-col items-center gap-3">
            <h1 className="text-h3 font-semibold text-foreground">Something went wrong</h1>
            <p className="text-body2 text-foreground-tertiary">
              An unexpected error occurred. Please try again — if it keeps happening, contact support.
            </p>
            <button
              type="button"
              onClick={reset}
              className="mt-2 rounded-md bg-primary px-4 py-2 text-body3 font-medium text-primary-foreground"
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}

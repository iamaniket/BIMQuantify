'use client';

import * as Sentry from '@sentry/nextjs';
import { useTranslations } from 'next-intl';
import { useEffect, type JSX } from 'react';

import { Button } from '@bimdossier/ui';

type Props = {
  error: Error;
  reset: () => void;
  scope: string;
};

/**
 * Shared in-app fallback for App Router `error.tsx` boundaries. Reports the
 * error to Sentry — client render errors otherwise never reach the SDK, since
 * `instrumentation.ts` only wires server/edge capture — and offers a retry.
 * Lives in components/shared because it's pure props + i18n (no store/query).
 */
export function RouteErrorBoundary({ error, reset, scope }: Props): JSX.Element {
  const t = useTranslations('errorBoundary');

  useEffect(() => {
    Sentry.captureException(error, { tags: { scope } });
  }, [error, scope]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex max-w-md flex-col items-center gap-3">
        <h1 className="text-h3 font-semibold text-foreground">{t('title')}</h1>
        <p className="text-body2 text-foreground-tertiary">{t('description')}</p>
        <Button type="button" variant="primary" size="md" onClick={reset} className="mt-2">
          {t('retry')}
        </Button>
      </div>
    </main>
  );
}

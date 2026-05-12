import { getTranslations } from 'next-intl/server';
import type { JSX } from 'react';

import { LoginForm } from '@/features/auth/LoginForm';
import { Link } from '@/i18n/navigation';

export default async function LoginPage(): Promise<JSX.Element> {
  const t = await getTranslations('legal');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-lg border border-border bg-surface-main p-8 shadow-md">
        <div className="flex flex-col gap-1">
          <h1 className="text-h5 font-semibold text-foreground">Sign in</h1>
          <p className="text-body2 text-foreground-tertiary">
            Welcome back. Enter your credentials to continue.
          </p>
        </div>
        <LoginForm />
      </div>
      <footer className="mt-8 flex flex-wrap items-center justify-center gap-3 text-xs text-foreground-tertiary">
        <Link href="/legal/privacy" className="hover:text-foreground">
          {t('navPrivacy')}
        </Link>
        <span aria-hidden>·</span>
        <Link href="/legal/terms" className="hover:text-foreground">
          {t('navTerms')}
        </Link>
        <span aria-hidden>·</span>
        <Link href="/legal/dpa" className="hover:text-foreground">
          {t('navDpa')}
        </Link>
      </footer>
    </main>
  );
}

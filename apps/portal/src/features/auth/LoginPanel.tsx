'use client';

import { AuthShell, type LegalFooterLink } from '@bimstitch/ui';
import type { JSX } from 'react';

import { AuthHeroBrand, AuthTopRight } from '@/features/auth/AuthHeroBrand';
import { LoginForm } from '@/features/auth/LoginForm';
import { env } from '@/lib/env';

interface LoginPanelProps {
  legalLinks: readonly LegalFooterLink[];
}

export function LoginPanel({ legalLinks }: LoginPanelProps): JSX.Element {
  const requestAccessHref = env.NEXT_PUBLIC_MARKETING_URL
    ? `${env.NEXT_PUBLIC_MARKETING_URL.replace(/\/$/, '')}/request-access`
    : '/request-access';

  return (
    <AuthShell
      brand={<AuthHeroBrand legalLinks={legalLinks} />}
      topRight={<AuthTopRight />}
      form={(
        <>
          <div className="mb-5">
            <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.14em] text-primary">
              Sign in
            </div>
            <h2 className="m-0 font-display text-[30px] font-medium leading-tight tracking-tight text-foreground">
              Welcome back.
            </h2>
            <p className="mt-2 text-[13px] leading-snug text-foreground-tertiary">
              Sign in to continue.{' '}
              <span className="whitespace-nowrap">
                New here?{' '}
                <a href={requestAccessHref} className="font-semibold text-primary no-underline">
                  Request access →
                </a>
              </span>
            </p>
          </div>
          <LoginForm />
        </>
      )}
    />
  );
}

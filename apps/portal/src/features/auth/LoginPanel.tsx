'use client';

import { AuthShell, type LegalFooterLink } from '@bimstitch/ui';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { AuthHeroBrand, AuthTopRight } from '@/features/auth/AuthHeroBrand';
import { LoginForm } from '@/features/auth/LoginForm';
import { env } from '@/lib/env';

interface LoginPanelProps {
  legalLinks: readonly LegalFooterLink[];
}

export function LoginPanel({ legalLinks }: LoginPanelProps): JSX.Element {
  const t = useTranslations('auth.login');
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
              {t('eyebrow')}
            </div>
            <h2 className="m-0 font-display text-[30px] font-medium leading-tight tracking-tight text-foreground">
              {t('heading')}
            </h2>
            <p className="mt-2 text-[13px] leading-snug text-foreground-tertiary">
              {t('intro')}{' '}
              <span className="whitespace-nowrap">
                {t('newHere')}{' '}
                <a href={requestAccessHref} className="font-semibold text-primary no-underline">
                  {t('requestAccessCta')}
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

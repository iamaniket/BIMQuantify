'use client';

import { AuthShell } from '@bimstitch/ui';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { AuthFormIntro } from '@/features/auth/AuthFormIntro';
import { AuthHeroBrand, AuthTopRight } from '@/features/auth/AuthHeroBrand';
import { LoginForm } from '@/features/auth/LoginForm';
import { env } from '@/lib/env';

export function LoginPanel(): JSX.Element {
  const t = useTranslations('auth.login');
  const requestAccessHref = env.NEXT_PUBLIC_MARKETING_URL
    ? `${env.NEXT_PUBLIC_MARKETING_URL.replace(/\/$/, '')}/request-access`
    : '/request-access';

  return (
    <AuthShell
      brand={<AuthHeroBrand />}
      topRight={<AuthTopRight />}
      form={<LoginForm />}
    />
  );
}

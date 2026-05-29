import { AuthShell } from '@bimstitch/brand';
import { getTranslations } from 'next-intl/server';
import type { JSX, ReactNode } from 'react';

import { AuthHeroBrand } from '@/features/auth/AuthHeroBrand';
import { Link } from '@/i18n/navigation';

interface AuthLayoutShellProps {
  children: ReactNode;
  /**
   * Override the top-right slot. Defaults to the back-to-sign-in link.
   * The sign-in page itself (`LoginPanel`) passes `<AuthTopRight />`
   * since it can't link "back" to itself.
   */
  topRight?: ReactNode;
  formContentMaxWidth?: string;
  formContentAlign?: 'center' | 'start';
  brandSticky?: boolean;
}

/**
 * Shared chrome for every non-dashboard auth page: brand pane on the
 * left, back-to-sign-in link top-right, form/content on the right.
 *
 * Used by /legal/*, /request-access, /forgot-password, /reset-password.
 * /login uses `LoginPanel` directly (different top-right slot).
 */
export async function AuthLayoutShell({
  children,
  topRight,
  formContentMaxWidth,
  formContentAlign,
  brandSticky,
}: AuthLayoutShellProps): Promise<JSX.Element> {
  const t = await getTranslations('legal');
  const backLink = (
    <Link
      href="/login"
      className="inline-flex items-center gap-1.5 font-sans text-[11.5px] tracking-[0.02em] text-foreground-tertiary no-underline hover:text-foreground"
    >
      <span aria-hidden>←</span>
      {t('backToSignIn')}
    </Link>
  );

  // Build pass-through props conditionally — `exactOptionalPropertyTypes`
  // rejects spreading `undefined` into optional slots on AuthShellProps.
  const shellOpts: {
    formContentMaxWidth?: string;
    formContentAlign?: 'center' | 'start';
    brandSticky?: boolean;
  } = {};
  if (formContentMaxWidth !== undefined) shellOpts.formContentMaxWidth = formContentMaxWidth;
  if (formContentAlign !== undefined) shellOpts.formContentAlign = formContentAlign;
  if (brandSticky !== undefined) shellOpts.brandSticky = brandSticky;

  return (
    <AuthShell
      brand={<AuthHeroBrand />}
      topRight={topRight ?? backLink}
      form={children}
      {...shellOpts}
    />
  );
}

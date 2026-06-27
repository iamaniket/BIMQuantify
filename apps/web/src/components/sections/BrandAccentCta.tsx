'use client';

import { Button } from '@bimdossier/ui';
import { useLocale } from 'next-intl';
import type { JSX, ReactNode } from 'react';

import { portalHref } from '@/lib/portalLinks';

type BrandAccentCtaProps = {
  children: ReactNode;
  href?: string;
};

/**
 * The brand-accent primary CTA used on the brand-gradient sections (hero + CTA
 * band). It overrides the default primary button to the accent green on the
 * gradient backdrop; centralized so the two on-gradient CTAs can't drift.
 *
 * Defaults to the portal's request-access page (registration lives in the
 * portal, not this marketing site), so it links out as a plain anchor.
 */
export function BrandAccentCta({
  children,
  href,
}: BrandAccentCtaProps): JSX.Element {
  const locale = useLocale();
  return (
    <a href={href ?? portalHref(locale, '/request-access')}>
      <Button
        variant="primary"
        size="lg"
        className="bg-[var(--brand-accent)] text-[var(--brand-gradient-start)] hover:bg-[var(--brand-accent-soft)]"
      >
        {children}
      </Button>
    </a>
  );
}

'use client';

import { Button } from '@bimdossier/ui';
import { ArrowRight } from '@bimdossier/ui/icons';
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
 * A decorative arrow nudges right on hover (the FeatureCard "Read more"
 * language) — no sheen, no magnetic effects.
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
    <a href={href ?? portalHref(locale, '/request-access')} className="group">
      <Button
        variant="primary"
        size="lg"
        className="bg-[var(--brand-accent)] text-[var(--brand-gradient-start)] hover:bg-[var(--brand-accent-soft)]"
      >
        {children}
        <ArrowRight
          className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none"
          aria-hidden
        />
      </Button>
    </a>
  );
}

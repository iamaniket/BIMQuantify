import { Button } from '@bimstitch/ui';
import type { JSX, ReactNode } from 'react';

import { Link } from '@/i18n/navigation';

type BrandAccentCtaProps = {
  children: ReactNode;
  href?: string;
};

/**
 * The brand-accent primary CTA used on the brand-gradient sections (hero + CTA
 * band). It overrides the default primary button to the accent green on the
 * gradient backdrop; centralized so the two on-gradient CTAs can't drift.
 */
export function BrandAccentCta({
  children,
  href = '/request-access',
}: BrandAccentCtaProps): JSX.Element {
  return (
    <Link href={href}>
      <Button
        variant="primary"
        size="lg"
        className="bg-[var(--brand-accent)] text-[var(--brand-gradient-start)] hover:bg-[var(--brand-accent-soft)]"
      >
        {children}
      </Button>
    </Link>
  );
}

import { Eyebrow, cn } from '@bimdossier/ui';
import type { JSX } from 'react';

import { Reveal } from '@/components/shared/Reveal';

type SectionHeadingProps = {
  eyebrow: string;
  headline: string;
  subtitle?: string;
  /**
   * Fade + rise in on scroll (default). One switch here choreographs every
   * section heading-first; pass false for headers that must be visible at
   * first paint.
   */
  reveal?: boolean;
  /** Extra classes for the wrapper (e.g. override the default `mb-12`). */
  className?: string;
};

/**
 * Centered marketing section header: eyebrow + h2 + optional subtitle, vertically
 * stacked and centered. Extracted from the verbatim cluster that repeated across
 * the home-page sections. Data flows in via props only (store-agnostic); the
 * optional Reveal wrap keeps this a server-safe file rendering a client child.
 */
export function SectionHeading({
  eyebrow,
  headline,
  subtitle,
  reveal = true,
  className,
}: SectionHeadingProps): JSX.Element {
  const heading = (
    <div className={cn('mb-12 flex flex-col items-center gap-3 text-center', className)}>
      <Eyebrow size="sm">{eyebrow}</Eyebrow>
      <h2 className="max-w-2xl text-h3 font-semibold text-foreground">{headline}</h2>
      {subtitle ? (
        <p className="max-w-xl text-body1 text-foreground-secondary">{subtitle}</p>
      ) : null}
    </div>
  );

  return reveal ? <Reveal>{heading}</Reveal> : heading;
}

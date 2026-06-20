import { Eyebrow, cn } from '@bimstitch/ui';
import type { JSX } from 'react';

type SectionHeadingProps = {
  eyebrow: string;
  headline: string;
  subtitle?: string;
  /** Extra classes for the wrapper (e.g. override the default `mb-12`). */
  className?: string;
};

/**
 * Centered marketing section header: eyebrow + h2 + optional subtitle, vertically
 * stacked and centered. Extracted from the verbatim cluster that repeated across
 * the home-page sections. Data flows in via props only (store-agnostic).
 */
export function SectionHeading({
  eyebrow,
  headline,
  subtitle,
  className,
}: SectionHeadingProps): JSX.Element {
  return (
    <div className={cn('mb-12 flex flex-col items-center gap-3 text-center', className)}>
      <Eyebrow size="sm">{eyebrow}</Eyebrow>
      <h2 className="max-w-2xl text-h3 font-semibold text-foreground">{headline}</h2>
      {subtitle ? (
        <p className="max-w-xl text-body1 text-foreground-secondary">{subtitle}</p>
      ) : null}
    </div>
  );
}

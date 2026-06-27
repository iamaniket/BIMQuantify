import { BrandMark } from '@bimdossier/brand';
import type { JSX } from 'react';

type Props = {
  size?: number;
  /** Retained for API compatibility; the brand logo art is rendered directly. */
  color?: string;
  className?: string;
};

/**
 * BimDossier logomark — the white "A-house" brand mark, rendered in the sidebar
 * footer chip (it sits on the blue gradient, so the white variant is used).
 */
export function DossierLogo({
  size = 22,
  className,
}: Props): JSX.Element {
  return (
    <BrandMark
      variant="white"
      size={size}
      {...(className !== undefined ? { className } : {})}
    />
  );
}

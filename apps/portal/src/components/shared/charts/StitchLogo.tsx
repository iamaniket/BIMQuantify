import type { JSX } from 'react';

import { BRAND_LOGO_DATA_URI } from '@bimstitch/brand';

type Props = {
  size?: number;
  /** Retained for API compatibility; the brand logo art is rendered directly. */
  color?: string;
  className?: string;
};

/**
 * BimDossier logomark — the full-colour "A"-folder brand logo, rendered in the
 * sidebar footer chip (a translucent-white tile gives it backing on the blue
 * gradient).
 */
export function DossierLogo({
  size = 22,
  className,
}: Props): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        backgroundImage: `url(${BRAND_LOGO_DATA_URI})`,
        backgroundSize: 'contain',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    />
  );
}

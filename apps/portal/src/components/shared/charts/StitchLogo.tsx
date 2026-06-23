import type { JSX } from 'react';

import { BRAND_GLYPH_WHITE_DATA_URI } from '@bimstitch/brand';

type Props = {
  size?: number;
  /** Retained for API compatibility; the white glyph art is rendered directly. */
  color?: string;
  className?: string;
};

/**
 * BimDossier logomark — the white "BD" glyph from the canonical brand art,
 * for blue/dark surfaces such as the sidebar footer chip (a blue square would
 * be blue-on-blue there).
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
        backgroundImage: `url(${BRAND_GLYPH_WHITE_DATA_URI})`,
        backgroundSize: 'contain',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    />
  );
}

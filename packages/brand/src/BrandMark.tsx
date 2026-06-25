import type { CSSProperties, JSX } from 'react';

import { cn } from '@bimdossier/ui';

import { BRAND_LOGO_DATA_URI } from './brandMarkAsset.js';

export interface BrandMarkProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
  /**
   * Render the mark on a light rounded "plate" so the blue folder logo stays
   * legible on surfaces whose background is the same primary blue as the logo
   * (the brand hero panels). Off by default — on white/light chrome (the
   * marketing header & footer) the bare mark already has enough contrast.
   */
  plate?: boolean;
}

/**
 * The BimDossier brand logo — the full-colour "A"-folder mark, rendered at `size`.
 * One image for every surface (marketing header/footer, hero panes, the portal
 * sidebar chip). The browser-tab favicon is a separate flat "A" mark.
 *
 * On dark/primary backgrounds the blue mark blends in; pass `plate` to seat it
 * on a small white rounded tile so it stands out.
 */
export function BrandMark({
  size = 32,
  className,
  style,
  plate = false,
}: BrandMarkProps): JSX.Element {
  const mark = (
    <span
      aria-hidden
      className={cn('inline-block', plate ? undefined : className)}
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${BRAND_LOGO_DATA_URI})`,
        backgroundSize: 'contain',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        flexShrink: 0,
        ...(plate ? undefined : style),
      }}
    />
  );

  if (!plate) {
    return mark;
  }

  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex items-center justify-center bg-white shadow-sm',
        className,
      )}
      style={{
        padding: Math.round(size * 0.16),
        borderRadius: Math.round(size * 0.24),
        flexShrink: 0,
        ...style,
      }}
    >
      {mark}
    </span>
  );
}

import type { CSSProperties, JSX } from 'react';

import { cn } from '@bimdossier/ui';

import { BrandMarkArt } from './BrandMarkArt.js';

/**
 * The logo variants. Picks the colour treatment for the surface the mark sits
 * on. The art is a detailed inline SVG (see `BrandMarkArt`) — resolution
 * independent, so it stays crisp at every size and pixel density. No
 * `/brand/*.png` fetch is involved anymore.
 */
export type BrandMarkVariant = 'primary' | 'white';

export interface BrandMarkProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
  /**
   * Which logo to show: `primary` (the blue mark, the default — for light
   * surfaces) or `white` (for surfaces whose background is the primary blue:
   * the auth hero, sidebars, the marketing brand panel).
   */
  variant?: BrandMarkVariant;
  /**
   * Render the mark on a light rounded "plate". Legacy escape hatch kept for
   * back-compat — prefer `variant="white"` on primary-blue backgrounds.
   */
  plate?: boolean;
}

/**
 * The BimDossier brand logo, rendered at `size`. One mark for every surface;
 * the `variant` picks the colour for the background it sits on.
 */
export function BrandMark({
  size = 32,
  className,
  style,
  variant = 'primary',
  plate = false,
}: BrandMarkProps): JSX.Element {
  if (!plate) {
    return (
      <BrandMarkArt
        size={size}
        variant={variant}
        className={className}
        style={style}
      />
    );
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
      <BrandMarkArt size={size} variant={variant} />
    </span>
  );
}

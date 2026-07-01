import type { CSSProperties, JSX } from 'react';

import { cn } from '@bimdossier/ui';

/**
 * The logo variants. Picks the colour treatment for the surface the mark sits
 * on.
 */
export type BrandMarkVariant = 'primary' | 'white';

/**
 * Public-path (per-app `public/brand/`) raster logo for each variant. Both
 * `apps/web` and `apps/portal` ship these PNGs, so a bare `/brand/*.png` src
 * resolves in every consumer.
 *
 * NOTE (temporary): the mark is rendered from these PNGs instead of the inline
 * SVG twin (`BrandMarkArt`). The vector art is kept in the package for an easy
 * switch back later — flip the render below to `<BrandMarkArt />` to restore it.
 */
const BRAND_PNG: Record<BrandMarkVariant, string> = {
  primary: '/brand/brand-primary.png',
  white: '/brand/brand-white.png',
};

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
  const img = (
    <img
      src={BRAND_PNG[variant]}
      alt=""
      aria-hidden
      draggable={false}
      className={cn('select-none', plate ? undefined : className)}
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        flexShrink: 0,
        ...(plate ? {} : style),
      }}
    />
  );

  if (!plate) {
    return img;
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
      {img}
    </span>
  );
}

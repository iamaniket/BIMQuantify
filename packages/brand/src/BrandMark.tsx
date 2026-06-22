import type { CSSProperties, JSX } from 'react';

import { cn } from '@bimstitch/ui';

import {
  BRAND_GLYPH_BLUE_DATA_URI,
  BRAND_GLYPH_MASK_DATA_URI,
  BRAND_GLYPH_WHITE_DATA_URI,
  BRAND_MARK_DATA_URI,
} from './brandMarkAsset.js';

export type BrandMarkTone = 'on-dark' | 'on-light';

/**
 * Which artwork to render:
 * - `square` (default): the full blue-square chip — reads on any surface.
 * - `glyph-blue`: the transparent blue "BD" letters — for light surfaces.
 * - `glyph-white`: the transparent white "BD" letters — for blue/dark surfaces.
 * - `glyph-mono`: the shadowless "BD" silhouette filled with `currentColor`, so
 *   it inherits the parent's text color (e.g. `text-primary`). Transparent, no
 *   drop shadow — for placing the mark inline with a wordmark.
 */
export type BrandMarkVariant = 'square' | 'glyph-blue' | 'glyph-white' | 'glyph-mono';

const ASSET_BY_VARIANT: Record<BrandMarkVariant, string> = {
  square: BRAND_MARK_DATA_URI,
  'glyph-blue': BRAND_GLYPH_BLUE_DATA_URI,
  'glyph-white': BRAND_GLYPH_WHITE_DATA_URI,
  'glyph-mono': BRAND_GLYPH_MASK_DATA_URI,
};

export interface BrandMarkProps {
  size?: number;
  variant?: BrandMarkVariant;
  /**
   * Retained for API compatibility. The canonical blue-square mark reads on
   * both light and dark surfaces, so it no longer switches the artwork.
   */
  tone?: BrandMarkTone;
  className?: string;
  style?: CSSProperties;
}

/**
 * The BimDossier "BD" brand mark — by default the blue square logo rendered as
 * a rounded chip. The glyph variants render the transparent "BD" letters
 * (no chip) for placement directly on a light or dark surface.
 */
export function BrandMark({
  size = 32,
  variant = 'square',
  className,
  style,
}: BrandMarkProps): JSX.Element {
  const isSquare = variant === 'square';
  const asset = ASSET_BY_VARIANT[variant];

  // `glyph-mono` is a CSS-masked silhouette filled with the inherited text
  // color, so it tracks `text-primary` (and theme changes) and carries no
  // baked-in tint or shadow. Other variants paint the raster art directly.
  if (variant === 'glyph-mono') {
    return (
      <span
        aria-hidden
        className={cn('inline-block', className)}
        style={{
          width: size,
          height: size,
          backgroundColor: 'currentColor',
          maskImage: `url(${asset})`,
          WebkitMaskImage: `url(${asset})`,
          maskSize: 'contain',
          WebkitMaskSize: 'contain',
          maskPosition: 'center',
          WebkitMaskPosition: 'center',
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
          flexShrink: 0,
          ...style,
        }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn('inline-block', className)}
      style={{
        width: size,
        height: size,
        borderRadius: isSquare ? 7 : 0,
        backgroundImage: `url(${asset})`,
        backgroundSize: isSquare ? 'cover' : 'contain',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

import type { CSSProperties, JSX } from 'react';

import { cn } from '@bimstitch/ui';

import {
  BRAND_GLYPH_BLUE_DATA_URI,
  BRAND_GLYPH_WHITE_DATA_URI,
  BRAND_MARK_DATA_URI,
} from './brandMarkAsset.js';

export type BrandMarkTone = 'on-dark' | 'on-light';

/**
 * Which artwork to render:
 * - `square` (default): the full blue-square chip — reads on any surface.
 * - `glyph-blue`: the transparent blue "BD" letters — for light surfaces.
 * - `glyph-white`: the transparent white "BD" letters — for blue/dark surfaces.
 */
export type BrandMarkVariant = 'square' | 'glyph-blue' | 'glyph-white';

const ASSET_BY_VARIANT: Record<BrandMarkVariant, string> = {
  square: BRAND_MARK_DATA_URI,
  'glyph-blue': BRAND_GLYPH_BLUE_DATA_URI,
  'glyph-white': BRAND_GLYPH_WHITE_DATA_URI,
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
  return (
    <span
      aria-hidden
      className={cn('inline-block', className)}
      style={{
        width: size,
        height: size,
        borderRadius: isSquare ? 7 : 0,
        backgroundImage: `url(${ASSET_BY_VARIANT[variant]})`,
        backgroundSize: isSquare ? 'cover' : 'contain',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

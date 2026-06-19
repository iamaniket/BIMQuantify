import type { CSSProperties, JSX } from 'react';

import { cn } from '@bimstitch/ui';

import { BRAND_MARK_DATA_URI } from './brandMarkAsset.js';

export type BrandMarkTone = 'on-dark' | 'on-light';

export interface BrandMarkProps {
  size?: number;
  /**
   * Retained for API compatibility. The canonical blue-square mark reads on
   * both light and dark surfaces, so it no longer switches the artwork.
   */
  tone?: BrandMarkTone;
  className?: string;
  style?: CSSProperties;
}

/**
 * The BimDossier "BD" brand mark — the blue square logo, rendered from the
 * canonical art (see brandMarkAsset.ts) as a rounded chip.
 */
export function BrandMark({
  size = 32,
  className,
  style,
}: BrandMarkProps): JSX.Element {
  return (
    <span
      aria-hidden
      className={cn('inline-block', className)}
      style={{
        width: size,
        height: size,
        borderRadius: 7,
        backgroundImage: `url(${BRAND_MARK_DATA_URI})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

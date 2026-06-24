import type { CSSProperties, JSX } from 'react';

import { cn } from '@bimstitch/ui';

import { BRAND_LOGO_DATA_URI } from './brandMarkAsset.js';

export interface BrandMarkProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * The BimDossier brand logo — the full-colour "A"-folder mark, rendered at `size`.
 * One image for every surface (marketing header/footer, hero panes, the portal
 * sidebar chip). The browser-tab favicon is a separate flat "A" mark.
 */
export function BrandMark({ size = 32, className, style }: BrandMarkProps): JSX.Element {
  return (
    <span
      aria-hidden
      className={cn('inline-block', className)}
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${BRAND_LOGO_DATA_URI})`,
        backgroundSize: 'contain',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

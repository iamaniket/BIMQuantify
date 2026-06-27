import type { CSSProperties, JSX } from 'react';

import { cn } from '@bimdossier/ui';

/**
 * The logo variants. The art lives in `assets/logos/` (the single source of truth)
 * and is copied into each app's `public/brand/` by `scripts/sync-brand-assets.mjs`.
 *
 * NOTE: any app rendering this shared component must run the brand-sync hook so
 * `/brand/brand-<variant>.png` resolves. Today only web (`:3000`) and portal
 * (`:3001`) consume it; both run it on `predev`/`prebuild`. Mobile has its own
 * `<BrandMark>` that `require()`s the bundled copies instead.
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
 * The BimDossier brand logo — the flat "A-house" mark, rendered at `size`.
 * One image for every surface; the `variant` picks the colour for the
 * background it sits on. Served as a real file from `/brand/` (never inlined).
 */
export function BrandMark({
  size = 32,
  className,
  style,
  variant = 'primary',
  plate = false,
}: BrandMarkProps): JSX.Element {
  const mark = (
    <span
      aria-hidden
      className={cn('inline-block', plate ? undefined : className)}
      style={{
        width: size,
        height: size,
        backgroundImage: `url(/brand/brand-${variant}.png)`,
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

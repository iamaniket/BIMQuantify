import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from './lib/cn.js';

export type IconTileTone = 'neutral' | 'primary';
export type IconTileSize = 'md' | 'lg';

const toneStyles: Record<IconTileTone, string> = {
  neutral: 'bg-surface-high text-foreground-tertiary',
  primary: 'bg-primary-lighter text-primary',
};

const sizeStyles: Record<IconTileSize, string> = {
  md: 'h-8 w-8',
  lg: 'h-9 w-9',
};

export type IconTileProps = HTMLAttributes<HTMLSpanElement> & {
  /** Colour treatment: brand-tinted (`primary`, for section headers) or neutral (list-row media). */
  tone?: IconTileTone;
  size?: IconTileSize;
};

/**
 * A small rounded-square container for an icon. The icon is passed as
 * `children` and inherits the tile's colour via `currentColor`; the consumer
 * sets the icon's own `h-/w-` size (e.g. `<Flag className="h-4 w-4" />`).
 *
 * Props-only base primitive — reused by entity-launcher headers (primary tone)
 * and their list rows (neutral tone).
 */
export const IconTile = forwardRef<HTMLSpanElement, IconTileProps>(
  ({ className, tone = 'neutral', size = 'md', children, ...rest }, ref) => (
    <span
      ref={ref}
      className={cn(
        'grid shrink-0 place-items-center rounded-lg',
        sizeStyles[size],
        toneStyles[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  ),
);

IconTile.displayName = 'IconTile';

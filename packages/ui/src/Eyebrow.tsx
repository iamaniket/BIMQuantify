import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from './lib/cn.js';

export type EyebrowSize = 'xs' | 'sm';

const sizeStyles: Record<EyebrowSize, string> = {
  xs: 'text-caption',
  sm: 'text-body3',
};

export type EyebrowProps = HTMLAttributes<HTMLSpanElement> & {
  size?: EyebrowSize;
};

/** Uppercase, letter-spaced monospace section label (pset names, panel headers). */
export const Eyebrow = forwardRef<HTMLSpanElement, EyebrowProps>(
  ({ className, size = 'xs', children, ...rest }, ref) => (
    <span
      ref={ref}
      className={cn(
        'font-sans font-bold uppercase leading-tight tracking-[0.1em] text-foreground-secondary',
        sizeStyles[size],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  ),
);

Eyebrow.displayName = 'Eyebrow';

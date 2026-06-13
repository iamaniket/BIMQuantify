import { forwardRef, type HTMLAttributes, type Ref } from 'react';

import { cn } from './lib/cn.js';

export type EyebrowSize = 'xs' | 'sm';
export type EyebrowTone = 'secondary' | 'tertiary';

const sizeStyles: Record<EyebrowSize, string> = {
  xs: 'text-caption',
  sm: 'text-body3',
};

const toneStyles: Record<EyebrowTone, string> = {
  secondary: 'text-foreground-secondary',
  tertiary: 'text-foreground-tertiary',
};

export type EyebrowProps = HTMLAttributes<HTMLElement> & {
  size?: EyebrowSize;
  /** Text color. `secondary` (default) for panel headers; `tertiary` for quieter section labels. */
  tone?: EyebrowTone;
  /** Rendered element. Defaults to `span`; use `div` for block-level section headers. */
  as?: 'span' | 'div';
};

/** Uppercase, letter-spaced section label (pset names, panel + section headers). */
export const Eyebrow = forwardRef<HTMLElement, EyebrowProps>(
  ({
    className, size = 'xs', tone = 'secondary', as = 'span', children, ...rest
  }, ref) => {
    const classes = cn(
      'font-sans font-bold uppercase leading-tight tracking-[0.1em]',
      toneStyles[tone],
      sizeStyles[size],
      className,
    );
    if (as === 'div') {
      return (
        <div ref={ref as Ref<HTMLDivElement>} className={classes} {...rest}>
          {children}
        </div>
      );
    }
    return (
      <span ref={ref as Ref<HTMLSpanElement>} className={classes} {...rest}>
        {children}
      </span>
    );
  },
);

Eyebrow.displayName = 'Eyebrow';

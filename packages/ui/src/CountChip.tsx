import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from './lib/cn.js';

export type CountChipProps = HTMLAttributes<HTMLSpanElement>;

/** Borderless monospace tabular numeric pill for counts. */
export const CountChip = forwardRef<HTMLSpanElement, CountChipProps>(
  ({ className, children, ...rest }, ref) => (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center font-sans tabular-nums text-caption text-foreground-tertiary',
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  ),
);

CountChip.displayName = 'CountChip';

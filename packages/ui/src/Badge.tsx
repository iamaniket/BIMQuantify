import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from './lib/cn.js';

const variantStyles = {
  default: 'bg-background-tertiary text-foreground-secondary',
  success: 'bg-success-lighter text-success border-success-light',
  warning: 'bg-warning-lighter text-warning border-warning-light',
  error: 'bg-error-lighter text-error border-error-light',
  info: 'bg-info-lighter text-info border-info-light',
} as const;

export type BadgeVariant = keyof typeof variantStyles;

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'default', ...rest }, ref) => (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5',
        'text-caption font-semibold leading-none',
        variantStyles[variant],
        className,
      )}
      {...rest}
    />
  ),
);

Badge.displayName = 'Badge';

import { forwardRef, type HTMLAttributes } from 'react';

import type { LucideIcon } from 'lucide-react';

import { cn } from './lib/cn.js';

const variantStyles = {
  default: 'bg-background-tertiary text-foreground-secondary border-border',
  success: 'bg-success-lighter text-success border-success-light',
  warning: 'bg-warning-lighter text-warning border-warning-light',
  error: 'bg-error-lighter text-error border-error-light',
  info: 'bg-info-lighter text-info border-info-light',
  primary: 'bg-primary-lighter text-primary border-primary-light',
} as const;

export type BadgeVariant = keyof typeof variantStyles;
export type BadgeSize = 'sm' | 'md';

const sizeStyles: Record<BadgeSize, string> = {
  sm: 'px-1.5 py-px text-caption gap-1',
  md: 'px-2 py-0.5 text-caption gap-1.5',
};

const iconSizeStyles: Record<BadgeSize, string> = {
  sm: 'h-2.5 w-2.5',
  md: 'h-3 w-3',
};

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
  size?: BadgeSize;
  /** Leading icon (lucide). */
  icon?: LucideIcon;
  /** Render with a border. Defaults to true; set false for borderless count pills. */
  bordered?: boolean;
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'default', size = 'md', icon: IconSvg, bordered = true, children, ...rest }, ref) => (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center rounded-full font-semibold leading-none',
        bordered ? 'border' : 'border-transparent',
        sizeStyles[size],
        variantStyles[variant],
        className,
      )}
      {...rest}
    >
      {IconSvg ? <IconSvg className={iconSizeStyles[size]} aria-hidden /> : null}
      {children}
    </span>
  ),
);

Badge.displayName = 'Badge';

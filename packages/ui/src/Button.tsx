import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from './lib/cn.js';

export type ButtonVariant = 'primary' | 'border' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const baseStyles =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-all duration-150 '
  + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 '
  + 'focus-visible:ring-offset-background '
  + 'disabled:cursor-not-allowed disabled:bg-background-tertiary disabled:text-foreground-disabled disabled:shadow-none';

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-primary-foreground '
    + 'shadow-[0_1px_2px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.1)] '
    + 'hover:bg-primary-hover hover:shadow-[0_2px_4px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.1)] '
    + 'active:bg-primary-active active:shadow-[inset_0_1px_3px_rgba(0,0,0,0.15)] active:translate-y-px',
  border:
    'border border-border bg-background text-foreground shadow-sm '
    + 'hover:bg-background-hover hover:border-border-hover hover:shadow-md '
    + 'active:bg-background-active active:shadow-none active:translate-y-px',
  secondary:
    'bg-background-secondary text-foreground border border-border shadow-sm '
    + 'hover:bg-background-hover hover:shadow-md '
    + 'active:bg-background-active active:shadow-none active:translate-y-px',
  ghost:
    'bg-transparent text-foreground '
    + 'hover:bg-background-hover '
    + 'active:bg-background-active',
  destructive:
    'bg-error text-error-foreground '
    + 'shadow-[0_1px_2px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.1)] '
    + 'hover:bg-error-hover hover:shadow-[0_2px_4px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.1)] '
    + 'active:shadow-[inset_0_1px_3px_rgba(0,0,0,0.15)] active:translate-y-px',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-10 px-3 text-[14px] leading-[16px]',
  md: 'h-10 px-4 text-[14px] leading-[16px]',
  lg: 'h-10 px-5 text-[16px] leading-[20px]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', type, ...rest }, ref) => (
    <button
      ref={ref}
      type={type ?? 'button'}
      suppressHydrationWarning
      className={cn(baseStyles, variantStyles[variant], sizeStyles[size], className)}
      {...rest}
    />
  ),
);

Button.displayName = 'Button';

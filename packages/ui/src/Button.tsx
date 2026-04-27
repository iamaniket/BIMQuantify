import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from './lib/cn.js';

export type ButtonVariant = 'primary' | 'border' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const baseStyles =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors '
  + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 '
  + 'focus-visible:ring-offset-background '
  + 'disabled:cursor-not-allowed disabled:bg-background-tertiary disabled:text-foreground-disabled';

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active',
  border:
    'border border-border bg-transparent text-foreground hover:bg-background-hover hover:border-border-hover',
  secondary:
    'bg-background-secondary text-foreground border border-border hover:bg-background-hover',
  ghost:
    'bg-transparent text-foreground hover:bg-background-hover',
  destructive:
    'bg-error text-error-foreground hover:bg-error-hover',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[14px] leading-[16px]',
  md: 'h-10 px-4 text-[14px] leading-[16px]',
  lg: 'h-12 px-5 text-[16px] leading-[20px]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', type, ...rest }, ref) => (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cn(baseStyles, variantStyles[variant], sizeStyles[size], className)}
      {...rest}
    />
  ),
);

Button.displayName = 'Button';

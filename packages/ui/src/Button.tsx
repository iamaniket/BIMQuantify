import {
  cloneElement,
  forwardRef,
  isValidElement,
  type ButtonHTMLAttributes,
  type ReactElement,
} from 'react';

import { cn } from './lib/cn.js';
import { buttonFocusDisabled, buttonVariantStyles, type ButtonVariant } from './lib/buttonStyles.js';
import { controlSizeStyles } from './lib/sizes.js';
import type { ControlSize } from './lib/sizes.js';

export type { ButtonVariant } from './lib/buttonStyles.js';
export type ButtonSize = ControlSize;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
};

const baseStyles =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-all duration-150 '
  + buttonFocusDisabled;

const sizeStyles: Record<ButtonSize, string> = {
  sm: `${controlSizeStyles.sm} px-2`,
  md: `${controlSizeStyles.md} px-3`,
  lg: `${controlSizeStyles.lg} px-4`,
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', type, asChild, children, ...rest }, ref) => {
    const classes = cn(baseStyles, buttonVariantStyles[variant], sizeStyles[size], className);

    if (asChild && isValidElement(children)) {
      return cloneElement(children as ReactElement<Record<string, unknown>>, {
        className: cn(classes, (children.props as { className?: string }).className),
        ref,
        ...rest,
      });
    }

    return (
      <button
        ref={ref}
        type={type ?? 'button'}
        suppressHydrationWarning
        className={classes}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';

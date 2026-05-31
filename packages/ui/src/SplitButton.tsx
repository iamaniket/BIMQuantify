'use client';

import { ChevronDown } from 'lucide-react';
import type { JSX, ReactNode } from 'react';

import { cn } from './lib/cn.js';
import { controlSizeStyles } from './lib/sizes.js';
import type { ControlSize } from './lib/sizes.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './DropdownMenu.js';
import type { ButtonVariant } from './Button.js';

export type SplitButtonItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
};

export type SplitButtonProps = {
  /** Main action label. */
  label: string;
  /** Leading icon for the main action. */
  icon?: ReactNode;
  /** Fires when the main (left) segment is clicked. */
  onClick: () => void;
  /** Secondary actions revealed by the dropdown arrow. */
  items: SplitButtonItem[];
  disabled?: boolean;
  /** Accessible label for the dropdown arrow trigger. */
  menuLabel: string;
  /** Visual variant — matches the Button component variants. */
  variant?: ButtonVariant;
  /** Size scale — matches the Button component sizes. */
  size?: ControlSize;
  className?: string;
};

const baseStyles =
  'inline-flex items-center justify-center gap-1.5 font-semibold transition-all duration-150 '
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

const sizeStyles: Record<ControlSize, string> = {
  sm: controlSizeStyles.sm,
  md: controlSizeStyles.md,
  lg: controlSizeStyles.lg,
};

const dividerStyles: Record<ButtonVariant, string> = {
  primary: 'border-white/20',
  border: 'border-border',
  secondary: 'border-border',
  ghost: 'border-border',
  destructive: 'border-white/20',
};

/**
 * A primary action paired with a dropdown of related actions.
 * Composes the design-system DropdownMenu for menu positioning and a11y.
 */
export function SplitButton({
  label,
  icon,
  onClick,
  items,
  disabled = false,
  menuLabel,
  variant = 'primary',
  size = 'sm',
  className,
}: SplitButtonProps): JSX.Element {
  return (
    <div className={cn('inline-flex items-stretch', className)}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(baseStyles, variantStyles[variant], sizeStyles[size], 'rounded-l-md pl-3 pr-2.5')}
      >
        {icon}
        {label}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={menuLabel}
          disabled={disabled}
          className={cn(
            baseStyles,
            variantStyles[variant],
            sizeStyles[size],
            'rounded-r-md border-l px-1.5',
            dividerStyles[variant],
            '[&[data-state=open]>svg]:rotate-180',
          )}
        >
          <ChevronDown className="h-3.5 w-3.5 transition-transform duration-150" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[11rem]">
          {items.map((item) => (
            <DropdownMenuItem
              key={item.id}
              {...(item.disabled !== undefined ? { disabled: item.disabled } : {})}
              onSelect={() => { item.onSelect(); }}
              className="gap-2.5"
            >
              {item.icon && (
                <span className="flex h-4 w-4 shrink-0 items-center justify-center text-foreground-tertiary">
                  {item.icon}
                </span>
              )}
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

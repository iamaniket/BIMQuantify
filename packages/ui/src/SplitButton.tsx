'use client';

import { CaretDown } from '@phosphor-icons/react';

import { DEFAULT_ICON_WEIGHT } from './lib/icons.js';
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
import { buttonFocusDisabled, buttonVariantStyles, type ButtonVariant } from './lib/buttonStyles.js';

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

// Shares Button's focus/disabled + per-variant styles (see lib/buttonStyles).
// `gap-1.5` is tighter than Button's `gap-2` because the segment is narrower;
// `font-medium` matches Button so a SplitButton sits flush next to one.
const baseStyles =
  'inline-flex items-center justify-center gap-1.5 font-medium transition-all duration-150 '
  + buttonFocusDisabled;

const sizeStyles = controlSizeStyles;

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
  size = 'md',
  className,
}: SplitButtonProps): JSX.Element {
  return (
    <div className={cn('inline-flex items-stretch', className)}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(baseStyles, buttonVariantStyles[variant], sizeStyles[size], 'rounded-l-md pl-3 pr-2.5')}
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
            buttonVariantStyles[variant],
            sizeStyles[size],
            'rounded-r-md border-l px-1.5',
            dividerStyles[variant],
            '[&[data-state=open]>svg]:rotate-180',
          )}
        >
          <CaretDown weight={DEFAULT_ICON_WEIGHT} className="h-4 w-4 transition-transform duration-150" />
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

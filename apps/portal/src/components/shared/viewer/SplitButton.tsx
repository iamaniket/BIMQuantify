'use client';

import { ChevronDown } from 'lucide-react';
import type { JSX, ReactNode } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  cn,
} from '@bimstitch/ui';

export type SplitButtonItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
};

type SplitButtonProps = {
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
  className?: string;
};

const segBase = 'inline-flex h-8 items-center justify-center gap-1.5 bg-primary text-primary-foreground '
  + 'text-body3 font-semibold transition-colors hover:bg-primary-hover '
  + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring '
  + 'disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Shared side-panel split button: a primary action paired with a dropdown of
 * related actions (e.g. "Attach" + Attach file / Add note / Add link). Composes
 * the design-system DropdownMenu so menu positioning and a11y come for free.
 */
export function SplitButton({
  label,
  icon,
  onClick,
  items,
  disabled = false,
  menuLabel,
  className,
}: SplitButtonProps): JSX.Element {
  return (
    <div className={cn('inline-flex items-stretch', className)}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(segBase, 'rounded-l-md pl-3 pr-2.5')}
      >
        {icon}
        {label}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={menuLabel}
          disabled={disabled}
          className={cn(
            segBase,
            'rounded-r-md border-l border-white/20 px-1.5',
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

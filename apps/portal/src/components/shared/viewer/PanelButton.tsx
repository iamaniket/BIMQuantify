'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { cn } from '@bimstitch/ui';

export type PanelButtonVariant = 'primary' | 'secondary';

export type PanelButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: PanelButtonVariant;
  /** Pressed/toggled state — gives the button its "on" look. */
  active?: boolean;
  /** Stretch to fill its row (segmented control). */
  segmented?: boolean;
  /** Leading icon, rendered before the label. */
  icon?: ReactNode;
  children?: ReactNode;
};

const base = 'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 '
  + 'text-body3 font-semibold transition-all duration-150 '
  + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring '
  + 'disabled:cursor-not-allowed disabled:opacity-50';

const primaryIdle = 'border border-primary bg-primary text-primary-foreground hover:bg-primary-hover';
const primaryActive = 'border border-primary bg-primary-active text-primary-foreground '
  + 'shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.35),inset_0_2px_5px_rgba(0,0,0,0.35)]';

const secondaryIdle = 'border border-border bg-background text-foreground shadow-sm '
  + 'hover:bg-background-hover hover:border-border-hover';
const secondaryActive = 'border border-primary bg-primary text-primary-foreground';

const variantClass: Record<PanelButtonVariant, { idle: string; active: string }> = {
  primary: { idle: primaryIdle, active: primaryActive },
  secondary: { idle: secondaryIdle, active: secondaryActive },
};

/**
 * Shared side-panel button used across viewer panels (measure modes, section
 * axis presets, placement toggles). Two visual styles (`primary`/`secondary`),
 * a pressed `active` state, and an optional `segmented` flag for equal-width
 * rows — mirroring the unified Inspector Panel design.
 */
export const PanelButton = forwardRef<HTMLButtonElement, PanelButtonProps>(
  ({
    variant = 'primary', active = false, segmented = false, icon, className, children, type, ...rest
  }, ref) => (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-pressed={active}
      className={cn(
        base,
        segmented && 'flex-1',
        active ? variantClass[variant].active : variantClass[variant].idle,
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  ),
);

PanelButton.displayName = 'PanelButton';

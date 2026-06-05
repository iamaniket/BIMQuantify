'use client';

import { forwardRef, type ReactNode } from 'react';

import { Button, cn } from '@bimstitch/ui';
import type { ButtonProps } from '@bimstitch/ui';

export type PanelButtonVariant = 'primary' | 'secondary';

export type PanelButtonProps = Omit<ButtonProps, 'variant' | 'size'> & {
  variant?: PanelButtonVariant;
  /** Pressed/toggled state — gives the button its "on" look. */
  active?: boolean;
  /** Stretch to fill its row (segmented control). */
  segmented?: boolean;
  /** Leading icon, rendered before the label. */
  icon?: ReactNode;
};

/** Active-state overrides layered on top of the base Button. */
const activeOverrides: Record<PanelButtonVariant, string> = {
  primary:
    'bg-primary-active shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.35),inset_0_2px_5px_rgba(0,0,0,0.35)] hover:bg-primary-active',
  secondary:
    'border-primary bg-primary text-primary-foreground hover:bg-primary hover:border-primary',
};

/** Map PanelButton variants to base Button variants. */
const variantMap: Record<PanelButtonVariant, ButtonProps['variant']> = {
  primary: 'primary',
  secondary: 'border',
};

/**
 * Shared side-panel button used across viewer panels (measure modes, section
 * axis presets, placement toggles). Wraps the design-system {@link Button}
 * with a pressed `active` state and an optional `segmented` flag for
 * equal-width rows.
 */
export const PanelButton = forwardRef<HTMLButtonElement, PanelButtonProps>(
  ({
    variant = 'secondary', active = false, segmented = false, icon, className, children, ...rest
  }, ref) => (
    <Button
      ref={ref}
      variant={variantMap[variant]!}
      size="sm"
      aria-pressed={active}
      className={cn(
        segmented && 'flex-1',
        active && activeOverrides[variant],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </Button>
  ),
);

PanelButton.displayName = 'PanelButton';

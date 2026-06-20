/**
 * Shared button styling primitives.
 *
 * `Button` and `SplitButton` render the same five visual variants. This module
 * is the single source of truth for their focus/disabled treatment and
 * per-variant colour + shadow classes, so the two components can never drift
 * apart (they did: the variant block was previously copy-pasted into both).
 *
 * The raised-control shadows come from named design tokens (`shadow-control*`
 * in `@bimstitch/tailwind-config`) rather than inline `rgba()` literals.
 */

export type ButtonVariant = 'primary' | 'border' | 'secondary' | 'ghost' | 'destructive';

/** Focus-ring + disabled treatment shared by every button-like control. */
export const buttonFocusDisabled =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 '
  + 'focus-visible:ring-offset-background '
  + 'disabled:cursor-not-allowed disabled:bg-background-tertiary disabled:text-foreground-disabled disabled:shadow-none';

/** Per-variant colour + shadow + interaction states. */
export const buttonVariantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-primary-foreground shadow-control '
    + 'hover:bg-primary-hover hover:shadow-control-hover '
    + 'active:bg-primary-active active:shadow-control-active active:translate-y-px',
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
    'bg-error text-error-foreground shadow-control '
    + 'hover:bg-error-hover hover:shadow-control-hover '
    + 'active:shadow-control-active active:translate-y-px',
};

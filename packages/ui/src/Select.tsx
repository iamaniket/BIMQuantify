import { forwardRef, type CSSProperties, type SelectHTMLAttributes } from 'react';

import { cn } from './lib/cn.js';
import { controlSizeStyles } from './lib/sizes.js';
import type { ControlSize } from './lib/sizes.js';

export type SelectSize = ControlSize;

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
  selectSize?: SelectSize;
  invalid?: boolean;
};

const sizeStyles: Record<SelectSize, string> = {
  sm: `${controlSizeStyles.sm} pl-2`,
  md: `${controlSizeStyles.md} pl-3`,
  lg: `${controlSizeStyles.lg} pl-4`,
};

// `appearance-none` strips the native arrow; `pr-9` reserves room for the caret
// painted by `caretStyle` below.
const baseStyles =
  'w-full rounded-md border bg-background text-foreground transition-colors '
  + 'appearance-none pr-9 '
  + 'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0 '
  + 'disabled:cursor-not-allowed disabled:bg-background-tertiary disabled:text-foreground-disabled';

// The dropdown caret is painted as a CSS background on the <select> itself so
// the indicator tracks the control's own box at any width (full-width, auto, or
// capped) with no extra wrapper element. It lives in an inline style rather than
// a Tailwind arbitrary background utility on purpose: the SVG data URI contains
// spaces, which the browser splits as class-attribute delimiters, fragmenting
// the token so the generated rule never matches and the caret silently
// disappears. `currentColor` is not usable inside a data URI, so the stroke is
// the tertiary-foreground gray (#737373).
//
// NOTE: do not write the literal arbitrary-utility syntax (bg-bracket-url) in
// this file's text — Tailwind scans comments too and would emit an unresolvable
// url() rule into the build.
const caretStyle: CSSProperties = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20' fill='none' stroke='%23737373' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 8 10 12 14 8'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 0.5rem center',
  backgroundSize: '1.25rem 1.25rem',
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({
    className, selectSize = 'md', invalid = false, children, style, ...rest
  }, ref) => {
    const borderClass = invalid
      ? 'border-error focus:ring-error'
      : 'border-border hover:border-border-hover';
    return (
      <select
        ref={ref}
        suppressHydrationWarning
        aria-invalid={invalid || undefined}
        className={cn(baseStyles, sizeStyles[selectSize], borderClass, className)}
        style={{ ...caretStyle, ...style }}
        {...rest}
      >
        {children}
      </select>
    );
  },
);

Select.displayName = 'Select';

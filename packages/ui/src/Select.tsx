import { forwardRef, type SelectHTMLAttributes } from 'react';

import { cn } from './lib/cn.js';
import { controlSizeStyles } from './lib/sizes.js';
import type { ControlSize } from './lib/sizes.js';

export type SelectSize = ControlSize;

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
  selectSize?: SelectSize;
  invalid?: boolean;
};

const sizeStyles: Record<SelectSize, string> = {
  sm: `${controlSizeStyles.sm} px-2`,
  md: `${controlSizeStyles.md} px-3`,
  lg: `${controlSizeStyles.lg} px-4`,
};

const baseStyles =
  'w-full rounded-md border bg-background text-foreground transition-colors '
  + 'appearance-none bg-no-repeat bg-[right_0.5rem_center] pr-9 '
  + 'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0 '
  + 'disabled:cursor-not-allowed disabled:bg-background-tertiary disabled:text-foreground-disabled';

// Inline SVG caret rendered via CSS background so the control has no extra wrapper.
// `currentColor` doesn't work inside data URIs; encode the tertiary foreground at
// runtime via a Tailwind utility instead. Falls back to a neutral chevron.
const caretBg =
  "bg-[url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='%23737373' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 8 10 12 14 8'/%3E%3C/svg%3E\")]";

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, selectSize = 'md', invalid = false, children, ...rest }, ref) => {
    const borderClass = invalid
      ? 'border-error focus:ring-error'
      : 'border-border hover:border-border-hover';
    return (
      <select
        ref={ref}
        suppressHydrationWarning
        aria-invalid={invalid || undefined}
        className={cn(baseStyles, sizeStyles[selectSize], caretBg, borderClass, className)}
        {...rest}
      >
        {children}
      </select>
    );
  },
);

Select.displayName = 'Select';

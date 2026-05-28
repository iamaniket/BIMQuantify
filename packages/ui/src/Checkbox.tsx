import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from './lib/cn.js';

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

const baseStyles =
  'size-[18px] cursor-pointer rounded border border-border bg-background accent-primary '
  + 'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0 '
  + 'disabled:cursor-not-allowed disabled:opacity-60';

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, ...rest }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      className={cn(baseStyles, className)}
      {...rest}
    />
  ),
);

Checkbox.displayName = 'Checkbox';

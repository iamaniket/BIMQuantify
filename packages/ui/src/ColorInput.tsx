import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from './lib/cn.js';

export type ColorInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

const baseStyles =
  'h-7 w-12 cursor-pointer rounded border border-border bg-transparent '
  + 'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0 '
  + 'disabled:cursor-not-allowed disabled:opacity-60';

export const ColorInput = forwardRef<HTMLInputElement, ColorInputProps>(
  ({ className, ...rest }, ref) => (
    <input
      ref={ref}
      type="color"
      className={cn(baseStyles, className)}
      {...rest}
    />
  ),
);

ColorInput.displayName = 'ColorInput';

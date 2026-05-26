import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from './lib/cn.js';

export type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

const trackStyles =
  'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full '
  + 'border-2 border-transparent transition-colors '
  + 'bg-foreground-tertiary '
  + 'focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 '
  + 'disabled:cursor-not-allowed disabled:opacity-60 '
  + 'has-[:checked]:bg-primary';

const thumbStyles =
  'pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform '
  + 'translate-x-0 '
  + 'peer-checked:translate-x-4';

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, ...rest }, ref) => (
    <label className={cn(trackStyles, className)}>
      <input
        ref={ref}
        type="checkbox"
        className="peer sr-only"
        {...rest}
      />
      <span className={thumbStyles} />
    </label>
  ),
);

Switch.displayName = 'Switch';

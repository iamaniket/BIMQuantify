import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from './lib/cn.js';

export type SliderProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

const baseStyles =
  'w-full cursor-pointer accent-primary '
  + 'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0 '
  + 'disabled:cursor-not-allowed disabled:opacity-60';

export const Slider = forwardRef<HTMLInputElement, SliderProps>(
  ({ className, ...rest }, ref) => (
    <input
      ref={ref}
      type="range"
      className={cn(baseStyles, className)}
      {...rest}
    />
  ),
);

Slider.displayName = 'Slider';

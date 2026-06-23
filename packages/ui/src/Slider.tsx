import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from './lib/cn.js';

export type SliderProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

// A wrapper-overlay range slider. The native <input type="range"> sits on top,
// fully transparent, and owns all interaction + accessibility (keyboard, drag,
// role="slider", aria-value*). Three pointer-events-none spans paint the visuals
// using design tokens — no global CSS or vendor pseudo-elements.
//
// DOM order is deliberate: the input is first so `peer-*` on the later thumb
// resolves, and it sits on top (z-10) so clicks/drags hit it through the
// pointer-events-none visual layers painted after it.
export const Slider = forwardRef<HTMLInputElement, SliderProps>(
  ({
    className, value, min = 0, max = 100, ...rest
  }, ref) => {
    const v = Number(value ?? 0);
    const lo = Number(min);
    const hi = Number(max);
    const frac = hi > lo ? Math.min(1, Math.max(0, (v - lo) / (hi - lo))) : 0;
    // The thumb is size-3.5 (14px); inset it by half (7px) on each end so it
    // never overflows the track. Keep these two literals in sync.
    const pos = `calc(7px + (100% - 14px) * ${frac})`;

    return (
      <span className={cn('relative inline-flex h-3.5 w-full items-center', className)}>
        <input
          ref={ref}
          type="range"
          value={value}
          min={min}
          max={max}
          className="peer absolute inset-0 z-10 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0 focus:outline-none disabled:cursor-not-allowed"
          {...rest}
        />
        {/* track */}
        <span className="pointer-events-none absolute inset-x-0 h-1.5 rounded-full bg-border peer-disabled:opacity-60" />
        {/* fill — left-anchored, width reaches the thumb centre */}
        <span
          className="pointer-events-none absolute left-0 h-1.5 rounded-full bg-primary peer-disabled:opacity-60"
          style={{ width: pos }}
        />
        {/* thumb */}
        <span
          className="pointer-events-none absolute size-3.5 -translate-x-1/2 rounded-full border-2 border-primary bg-background shadow-sm transition-colors peer-hover:border-primary-hover peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-60"
          style={{ left: pos }}
        />
      </span>
    );
  },
);

Slider.displayName = 'Slider';

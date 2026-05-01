import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from './lib/cn.js';

const fillVariants = {
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
} as const;

export type ProgressVariant = keyof typeof fillVariants;

export type ProgressProps = Omit<HTMLAttributes<HTMLDivElement>, 'role'> & {
  value: number;
  variant?: ProgressVariant;
};

export const Progress = forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, variant = 'primary', ...rest }, ref) => {
    const clamped = Math.max(0, Math.min(100, value));
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        className={cn(
          'h-1.5 w-full overflow-hidden rounded-full bg-background-tertiary',
          className,
        )}
        {...rest}
      >
        <div
          className={cn('h-full rounded-full transition-all duration-normal', fillVariants[variant])}
          style={{ width: `${clamped}%` }}
        />
      </div>
    );
  },
);

Progress.displayName = 'Progress';

import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from './lib/cn.js';

export type InputSize = 'sm' | 'md' | 'lg';

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  inputSize?: InputSize;
  invalid?: boolean;
};

const baseStyles =
  'w-full rounded-md border bg-background text-foreground transition-colors '
  + 'placeholder:text-foreground-placeholder '
  + 'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0 '
  + 'disabled:cursor-not-allowed disabled:bg-background-tertiary disabled:text-foreground-disabled';

const sizeStyles: Record<InputSize, string> = {
  sm: 'h-8 px-2 text-[14px]',
  md: 'h-10 px-3 text-[14px]',
  lg: 'h-12 px-4 text-[16px]',
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, inputSize = 'md', invalid = false, ...rest }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        baseStyles,
        sizeStyles[inputSize],
        invalid ? 'border-error focus:ring-error' : 'border-border hover:border-border-hover',
        className,
      )}
      {...rest}
    />
  ),
);

Input.displayName = 'Input';

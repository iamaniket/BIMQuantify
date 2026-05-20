import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

import { cn } from './lib/cn.js';

export type InputSize = 'sm' | 'md' | 'lg';

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  inputSize?: InputSize;
  invalid?: boolean;
  /** Icon or short node rendered inside the input, before the text cursor. */
  leading?: ReactNode;
  /** Icon or button rendered inside the input, after the text. */
  trailing?: ReactNode;
};

const sizeStyles: Record<InputSize, string> = {
  sm: 'h-10 text-[14px]',
  md: 'h-10 text-[14px]',
  lg: 'h-10 text-[16px]',
};

const sizePadding: Record<InputSize, { plain: string; left: string; right: string }> = {
  sm: { plain: 'px-2', left: 'pl-8 pr-2', right: 'pr-8 pl-2' },
  md: { plain: 'px-3', left: 'pl-9 pr-3', right: 'pr-9 pl-3' },
  lg: { plain: 'px-4', left: 'pl-10 pr-4', right: 'pr-10 pl-4' },
};

const wrapperBase =
  'relative flex items-stretch w-full rounded-md border bg-background text-foreground '
  + 'transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-0';

const inputBase =
  'w-full bg-transparent text-foreground outline-none border-0 '
  + 'placeholder:text-foreground-placeholder '
  + 'disabled:cursor-not-allowed disabled:text-foreground-disabled';

const plainBase =
  'w-full rounded-md border bg-background text-foreground transition-colors '
  + 'placeholder:text-foreground-placeholder '
  + 'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0 '
  + 'disabled:cursor-not-allowed disabled:bg-background-tertiary disabled:text-foreground-disabled';

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, inputSize = 'md', invalid = false, leading, trailing, ...rest }, ref) => {
    const borderClass = invalid
      ? 'border-error focus-within:ring-error focus:ring-error'
      : 'border-border hover:border-border-hover';

    // Fast path: no affixes — keep the previous single-element output so
    // callers relying on plain Input layout are unaffected.
    if (leading === undefined && trailing === undefined) {
      return (
        <input
          ref={ref}
          suppressHydrationWarning
          aria-invalid={invalid || undefined}
          className={cn(plainBase, sizeStyles[inputSize], sizePadding[inputSize].plain, borderClass, className)}
          {...rest}
        />
      );
    }

    const paddingClass = leading !== undefined && trailing !== undefined
      ? `${sizePadding[inputSize].left.split(' ')[0]} ${sizePadding[inputSize].right.split(' ')[0]}`
      : leading !== undefined
        ? sizePadding[inputSize].left
        : sizePadding[inputSize].right;

    return (
      <div className={cn(wrapperBase, borderClass, sizeStyles[inputSize], className)}>
        {leading !== undefined ? (
          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-foreground-tertiary">
            {leading}
          </span>
        ) : null}
        <input
          ref={ref}
          suppressHydrationWarning
          aria-invalid={invalid || undefined}
          className={cn(inputBase, paddingClass)}
          {...rest}
        />
        {trailing !== undefined ? (
          <span className="absolute inset-y-0 right-0 flex items-center pr-2 text-foreground-tertiary">
            {trailing}
          </span>
        ) : null}
      </div>
    );
  },
);

Input.displayName = 'Input';

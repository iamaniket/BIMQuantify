import { forwardRef, type TextareaHTMLAttributes } from 'react';

import { cn } from './lib/cn.js';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean;
};

const baseStyles =
  'w-full rounded-md border bg-background text-foreground transition-colors '
  + 'placeholder:text-foreground-placeholder '
  + 'min-h-[80px] px-3 py-2 text-[14px] '
  + 'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0 '
  + 'disabled:cursor-not-allowed disabled:bg-background-tertiary disabled:text-foreground-disabled';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid = false, rows = 3, ...rest }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        baseStyles,
        invalid ? 'border-error focus:ring-error' : 'border-border hover:border-border-hover',
        className,
      )}
      {...rest}
    />
  ),
);

Textarea.displayName = 'Textarea';

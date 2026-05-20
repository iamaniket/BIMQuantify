import type { JSX, ReactNode } from 'react';

import { cn } from './lib/cn.js';

export interface FormFieldProps {
  /** Label rendered above the control. */
  label: string;
  /** Optional right-aligned slot — e.g. a "Forgot?" link. */
  action?: ReactNode | undefined;
  /** The form control (Input, Textarea, Select, etc.). */
  children: ReactNode;
  /** Inline help text shown when no error is present. */
  hint?: string | undefined;
  /** Inline error text. Suppresses `hint` when present. */
  error?: string | undefined;
  /** Show a red asterisk after the label. */
  required?: boolean | undefined;
  /** `id` of the control — used to wire the `<label>`'s `for=`. */
  htmlFor?: string | undefined;
  className?: string | undefined;
  /**
   * Override the label's class. Defaults to the auth-form uppercase styling.
   * Pass a plain-form class for dialog/admin contexts.
   */
  labelClassName?: string | undefined;
}

const DEFAULT_LABEL_CLASS =
  'text-[11px] font-bold uppercase tracking-[0.06em] text-foreground-tertiary';

/**
 * Label + control + hint/error row. Matches the design's auth-form styling
 * (uppercase, small caps, optional right-aligned action). Use with the
 * extended `Input` for icon-aware fields.
 */
export function FormField({
  label,
  action,
  children,
  hint,
  error,
  required,
  htmlFor,
  className,
  labelClassName,
}: FormFieldProps): JSX.Element {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label
          htmlFor={htmlFor}
          className={cn(DEFAULT_LABEL_CLASS, labelClassName)}
        >
          {label}
          {required ? <span className="ml-1 text-error">*</span> : null}
        </label>
        {action !== undefined ? <div>{action}</div> : null}
      </div>
      {children}
      {error !== undefined ? (
        <div role="alert" className="flex items-center gap-1.5 text-[10.5px] text-error">
          <span aria-hidden className="size-1 rounded-full bg-error" />
          {error}
        </div>
      ) : hint !== undefined ? (
        <div className="text-[10.5px] text-foreground-tertiary">{hint}</div>
      ) : null}
    </div>
  );
}

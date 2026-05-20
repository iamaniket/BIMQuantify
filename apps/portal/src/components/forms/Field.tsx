'use client';

import { FormField } from '@bimstitch/ui';
import { useId, type JSX, type ReactNode } from 'react';
import type { FieldError, FieldErrors, FieldValues, Path, UseFormReturn } from 'react-hook-form';

/**
 * Portal-flavoured wrapper over `@bimstitch/ui`'s `FormField`. Reads the
 * field-level error message off the RHF form, generates a stable `id` for
 * `htmlFor` wiring, and applies the dialog-style label (non-uppercase, plain
 * Label component). Pass the control as `children` — wire `register` or
 * `Controller` to it manually, the bridge stays out of the way.
 */
export type FieldRenderArgs = {
  id: string;
  invalid: boolean;
};

export type FieldProps<TValues extends FieldValues> = {
  form: UseFormReturn<TValues>;
  name: Path<TValues>;
  label: string;
  hint?: string;
  required?: boolean;
  action?: ReactNode;
  className?: string;
  /**
   * The control. Pass a function to receive the generated `id` (for `htmlFor`
   * wiring) and `invalid` flag, or pass a static node if you don't need them.
   */
  children: ReactNode | ((args: FieldRenderArgs) => ReactNode);
};

function lookupError<TValues extends FieldValues>(
  errors: FieldErrors<TValues>,
  name: Path<TValues>,
): string | undefined {
  const segments = (name as string).split('.');
  let cursor: unknown = errors;
  for (const seg of segments) {
    if (cursor === undefined || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  if (cursor === undefined || cursor === null) return undefined;
  const message = (cursor as FieldError).message;
  return typeof message === 'string' ? message : undefined;
}

export function Field<TValues extends FieldValues>({
  form,
  name,
  label,
  hint,
  required,
  action,
  className,
  children,
}: FieldProps<TValues>): JSX.Element {
  const id = useId();
  const error = lookupError(form.formState.errors, name);
  const rendered = typeof children === 'function'
    ? children({ id, invalid: error !== undefined })
    : children;
  return (
    <FormField
      label={label}
      htmlFor={id}
      hint={hint}
      error={error}
      required={required}
      action={action}
      className={className}
      labelClassName="text-label2 font-medium normal-case tracking-normal text-foreground"
    >
      {rendered}
    </FormField>
  );
}

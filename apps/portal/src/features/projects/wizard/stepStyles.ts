/** Shared style constants and helpers for project wizard step components. */

import type {
  FieldError, FieldErrors, FieldValues, Path,
} from 'react-hook-form';

export const fieldLabelClass = 'text-body3 font-medium text-foreground-secondary';

export const selectClass = 'h-9 w-full rounded-md border border-border bg-background '
  + 'px-2.5 text-body2 text-foreground outline-none focus:border-primary focus:ring-2 '
  + 'focus:ring-primary/20';

export const fieldErrorClass = 'text-body3 text-error';

export const sectionTitleClass = 'text-caption font-bold uppercase '
  + 'tracking-[0.08em] text-foreground-tertiary';

/** Narrow an RHF field-error message without optional chaining. */
export function getFieldErrorMessage<T extends FieldValues>(
  errors: FieldErrors<T>,
  key: Path<T>,
): string | undefined {
  const entry = errors[key] as FieldError | undefined;
  if (entry === undefined) return undefined;
  return entry.message;
}

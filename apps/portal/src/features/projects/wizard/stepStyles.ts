/** Shared style constants and helpers for project wizard step components. */

import type {
  FieldError, FieldErrors, FieldValues, Path,
} from 'react-hook-form';

export const fieldLabelClass = 'text-body3 font-medium text-foreground-secondary';

export const fieldErrorClass = 'text-body3 text-error';

/** Narrow an RHF field-error message without optional chaining. */
export function getFieldErrorMessage<T extends FieldValues>(
  errors: FieldErrors<T>,
  key: Path<T>,
): string | undefined {
  const entry = errors[key] as FieldError | undefined;
  if (entry === undefined) return undefined;
  return entry.message;
}

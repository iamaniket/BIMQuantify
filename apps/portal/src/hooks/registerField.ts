import type {
  FieldValues,
  Path,
  RegisterOptions,
  UseFormRegisterReturn,
  UseFormReturn,
} from 'react-hook-form';

/**
 * Drop-in replacement for `form.register(name, opts)` that auto-clears the
 * field's validation error as soon as the user starts typing.
 *
 * React Hook Form's built-in re-validate-on-change (`reValidateMode`) only
 * activates after `handleSubmit()` has been called. The project wizard uses
 * `form.trigger()` for step transitions, which does NOT set `isSubmitted` —
 * so errors set by `trigger()` persist even after the user types valid input.
 *
 * This hook fixes that by injecting a `clearErrors(name)` call into the
 * `onChange` handler. It also absorbs the "clear server errors on change"
 * pattern that was previously hand-written on individual fields.
 */
export function registerField<T extends FieldValues>(
  form: UseFormReturn<T>,
  name: Path<T>,
  options?: RegisterOptions<T, Path<T>>,
): UseFormRegisterReturn<Path<T>> {
  const callerOnChange = options?.onChange;

  return form.register(name, {
    ...options,
    onChange: (event: unknown) => {
      form.clearErrors(name);
      if (callerOnChange !== undefined) {
        (callerOnChange as (e: unknown) => void)(event);
      }
    },
  });
}

import { useEffect } from 'react';
import type { DefaultValues, FieldValues, UseFormReturn } from 'react-hook-form';

export function useFormDialog<T extends FieldValues>(
  open: boolean,
  form: UseFormReturn<T>,
  mutation: { reset: () => void },
  defaults: DefaultValues<T>,
  onReset: (() => void) | undefined = undefined,
): void {
  const { reset: resetForm } = form;
  const { reset: resetMutation } = mutation;
  useEffect(() => {
    if (open) {
      resetForm(defaults);
      resetMutation();
      onReset?.();
    }
    // defaults intentionally omitted — reset only fires on open transition
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resetForm, resetMutation]);
}

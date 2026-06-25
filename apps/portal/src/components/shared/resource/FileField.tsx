'use client';

import { cn } from '@bimdossier/ui';
import type { ChangeEvent, JSX } from 'react';

/**
 * The shared styled native file input used inside the resource add/upload
 * dialogs, so each dialog stops hand-rolling its own `file:`-styled `<input>`.
 * Hands the picked `File` (or `null`) back to the caller, which holds it in
 * component state (binary files don't live cleanly in RHF/Zod).
 */
type Props = {
  id?: string;
  accept: string;
  onFile: (file: File | null) => void;
  invalid?: boolean;
};

export function FileField({ id, accept, onFile, invalid }: Props): JSX.Element {
  return (
    <input
      id={id}
      type="file"
      accept={accept}
      onChange={(e: ChangeEvent<HTMLInputElement>) => { onFile(e.target.files?.[0] ?? null); }}
      className={cn(
        'block w-full text-body3 text-foreground-secondary file:mr-3 file:rounded-md file:border file:border-border file:bg-background-secondary file:px-3 file:py-1.5 file:text-body3 file:text-foreground hover:file:bg-background-hover',
        invalid === true && 'file:border-error',
      )}
    />
  );
}

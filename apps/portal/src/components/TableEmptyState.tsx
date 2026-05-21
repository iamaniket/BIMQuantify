import type { JSX } from 'react';

type Props = { message: string };

export function TableEmptyState({ message }: Props): JSX.Element {
  return (
    <div className="flex h-32 items-center justify-center text-body3 text-foreground-tertiary">
      {message}
    </div>
  );
}

import type { JSX } from 'react';

import { cn } from '@bimstitch/ui';

const TONE_CLASSES = {
  default: 'border-error bg-error/10 text-body3',
  soft: 'border-error-light bg-error-lighter text-[12.5px]',
} as const;

type Props = {
  message: string | null;
  tone?: keyof typeof TONE_CLASSES;
  className?: string;
};

export function ErrorBanner({ message, tone = 'default', className }: Props): JSX.Element | null {
  if (message === null) return null;
  return (
    <div
      role="alert"
      className={cn(
        'rounded-md border px-3 py-2 text-error',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {message}
    </div>
  );
}

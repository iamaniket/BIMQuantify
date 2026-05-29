import type { JSX } from 'react';

import { Loader2, type LucideProps } from 'lucide-react';

import { cn } from './lib/cn.js';

const spinnerSizeClassNames = {
  sm: 'h-3.5 w-3.5',
  md: 'h-5 w-5',
  lg: 'h-8 w-8',
} as const;

export type SpinnerSize = keyof typeof spinnerSizeClassNames;

export type SpinnerProps = Omit<LucideProps, 'size'> & {
  size?: SpinnerSize;
  label?: string;
};

export function Spinner({
  size = 'md',
  label,
  className,
  ...rest
}: SpinnerProps): JSX.Element {
  return (
    <Loader2
      role="status"
      aria-label={label ?? 'Loading'}
      className={cn('animate-spin text-foreground-tertiary', spinnerSizeClassNames[size], className)}
      {...rest}
    />
  );
}

import type { JSX } from 'react';

import { SpinnerGap, type IconProps as PhosphorIconProps } from '@phosphor-icons/react';

import { cn } from './lib/cn.js';

const spinnerSizeClassNames = {
  sm: 'h-4 w-4',
  md: 'h-[22px] w-[22px]',
  lg: 'h-9 w-9',
} as const;

export type SpinnerSize = keyof typeof spinnerSizeClassNames;

export type SpinnerProps = Omit<PhosphorIconProps, 'size' | 'weight'> & {
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
    <SpinnerGap
      role="status"
      weight="bold"
      aria-label={label ?? 'Loading'}
      className={cn('animate-spin text-foreground-tertiary', spinnerSizeClassNames[size], className)}
      {...rest}
    />
  );
}

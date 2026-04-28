import type { HTMLAttributes, JSX } from 'react';

import { cn } from './lib/cn.js';

export type SkeletonProps = HTMLAttributes<HTMLDivElement>;

export function Skeleton({ className, ...rest }: SkeletonProps): JSX.Element {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-pulse rounded-md bg-background-tertiary',
        className,
      )}
      {...rest}
    />
  );
}

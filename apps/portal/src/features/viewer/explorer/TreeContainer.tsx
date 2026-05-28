'use client';

import type { JSX, ReactNode } from 'react';

import { cn } from '@bimstitch/ui';

type TreeContainerProps = {
  children: ReactNode;
  className?: string; // eslint-disable-line no-restricted-syntax -- optional with cn() fallback
};

export function TreeContainer({
  children,
  className,
}: TreeContainerProps): JSX.Element {
  return (
    <div role="tree" className={cn('py-1', className)}>
      {children}
    </div>
  );
}

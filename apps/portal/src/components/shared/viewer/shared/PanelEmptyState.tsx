'use client';

import type { ComponentType, JSX } from 'react';

import { cn } from '@bimdossier/ui';

type PanelEmptyStateProps = {
  icon?: ComponentType<{ className?: string }>;
  message: string;
  className?: string;
};

export function PanelEmptyState({
  icon: Icon,
  message,
  className,
}: PanelEmptyStateProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex h-full flex-col items-center justify-center gap-2 px-4 py-6 text-center',
        className,
      )}
    >
      {Icon ? <Icon className="h-6 w-6 text-foreground-tertiary" /> : null}
      <p className="text-caption text-foreground-tertiary">{message}</p>
    </div>
  );
}

import type { ComponentType, JSX, ReactNode } from 'react';

import { cn } from './lib/cn.js';

export type EmptyStateProps = {
  icon: ComponentType<{ className: string | undefined }> | undefined;
  title: string;
  description: string | undefined;
  action: ReactNode | undefined;
  className: string | undefined;
};

export function EmptyState({
  icon: Icon, title, description, action, className,
}: EmptyStateProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-background-secondary px-6 py-12 text-center',
        className,
      )}
    >
      {Icon === undefined ? null : (
        <Icon className="h-10 w-10 text-foreground-tertiary" />
      )}
      <div className="flex flex-col gap-1">
        <p className="text-title3 font-semibold text-foreground">{title}</p>
        {description === undefined ? null : (
          <p className="text-body2 text-foreground-secondary">{description}</p>
        )}
      </div>
      {action === undefined ? null : <div className="mt-2">{action}</div>}
    </div>
  );
}

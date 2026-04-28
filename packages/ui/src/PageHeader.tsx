import type { JSX, ReactNode } from 'react';

import { cn } from './lib/cn.js';

export type PageHeaderProps = {
  title: string;
  subtitle: string | undefined;
  actions: ReactNode | undefined;
  className: string | undefined;
};

export function PageHeader({
  title, subtitle, actions, className,
}: PageHeaderProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 pb-4 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-h6 font-semibold text-foreground">{title}</h1>
        {subtitle === undefined ? null : (
          <p className="text-body2 text-foreground-secondary">{subtitle}</p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="flex items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

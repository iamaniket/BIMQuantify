'use client';

import type { JSX, ReactNode } from 'react';

import { cn } from '@bimstitch/ui';

export type ViewerTabDef<T extends string> = {
  id: T;
  label: string;
  count?: number;
  disabled?: boolean;
};

type ViewerPanelTabsProps<T extends string> = {
  tabs: ViewerTabDef<T>[];
  active: T;
  onChange: (id: T) => void;
  trailing?: ReactNode;
  className?: string;
};

export function ViewerPanelTabs<T extends string>({
  tabs,
  active,
  onChange,
  trailing,
  className,
}: ViewerPanelTabsProps<T>): JSX.Element {
  return (
    <div
      role="tablist"
      className={cn(
        'flex shrink-0 items-stretch border-b border-border bg-background px-2',
        className,
      )}
    >
      {tabs.map((t) => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={t.disabled}
            onClick={() => onChange(t.id)}
            className={cn(
              'relative -mb-px inline-flex items-center gap-1.5 px-3 py-2.5 text-body3 tracking-tight transition-colors',
              'border-b-2 border-transparent',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              t.disabled
                ? 'cursor-not-allowed text-foreground-secondary/40'
                : isActive
                  ? 'border-primary font-semibold text-primary'
                  : 'font-medium text-foreground-secondary hover:text-foreground',
            )}
          >
            <span>{t.label}</span>
            {t.count !== undefined && (
              <span
                className={cn(
                  'text-caption tabular-nums',
                  isActive ? 'text-primary/70' : 'text-foreground-secondary/60',
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
      {trailing !== undefined && (
        <div className="ml-auto flex items-center pr-1">{trailing}</div>
      )}
    </div>
  );
}

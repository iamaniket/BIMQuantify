'use client';

import { useDroppable } from '@dnd-kit/core';
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from './lib/cn.js';

export type KanbanColumnProps = Omit<HTMLAttributes<HTMLDivElement>, 'id'> & {
  id: string;
  label: string;
  count: number;
  accentColor?: string;
  emptyLabel?: string;
  children?: ReactNode;
  /** Whether the currently dragged item can be dropped here. */
  dropAllowed?: boolean;
};

export const KanbanColumn = forwardRef<HTMLDivElement, KanbanColumnProps>(
  (
    { id, label, count, accentColor, emptyLabel, dropAllowed = true, className, children, ...rest },
    ref,
  ) => {
    const { setNodeRef, isOver } = useDroppable({ id });

    return (
      <div
        ref={ref}
        className={cn(
          'flex w-[280px] shrink-0 flex-col rounded-lg border border-border bg-surface-low',
          className,
        )}
        {...rest}
      >
        <div
          className="rounded-t-lg border-b border-border px-3 py-2.5"
          style={{ borderTop: `3px solid ${accentColor ?? 'var(--border)'}` }}
        >
          <div className="flex items-center justify-between">
            <span className="text-body3 font-semibold text-foreground">{label}</span>
            <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-background px-1.5 text-caption font-bold tabular-nums text-foreground-tertiary">
              {count}
            </span>
          </div>
        </div>

        <div
          ref={setNodeRef}
          className={cn(
            'flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto p-2 transition-colors',
            isOver && dropAllowed && 'bg-primary-lighter/30',
            isOver && !dropAllowed && 'bg-error/5',
          )}
        >
          {children}
          {count === 0 && emptyLabel !== undefined && (
            <div className="flex flex-1 items-center justify-center">
              <span className="text-caption text-foreground-tertiary">{emptyLabel}</span>
            </div>
          )}
        </div>
      </div>
    );
  },
);

KanbanColumn.displayName = 'KanbanColumn';

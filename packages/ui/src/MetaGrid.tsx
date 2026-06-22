import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from './lib/cn.js';

export type MetaGridEntry = {
  label: string;
  value: ReactNode;
};

export type MetaGridProps = HTMLAttributes<HTMLDivElement> & {
  entries: MetaGridEntry[];
  labelWidth?: string | undefined;
};

export const MetaGrid = forwardRef<HTMLDivElement, MetaGridProps>(
  ({ entries, labelWidth = '76px', className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn('grid gap-x-6 gap-y-1 py-2', className)}
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
      {...rest}
    >
      {entries.map(({ label, value }) => (
        <div
          key={label}
          className="grid items-baseline gap-x-2.5"
          style={{ gridTemplateColumns: `${labelWidth} 1fr` }}
        >
          <div className="font-sans text-caption uppercase leading-[1.7] tracking-wide text-foreground-tertiary">
            {label}
          </div>
          <div className="break-all font-sans text-xs leading-[1.7] text-foreground tabular-nums">
            {value}
          </div>
        </div>
      ))}
    </div>
  ),
);

MetaGrid.displayName = 'MetaGrid';

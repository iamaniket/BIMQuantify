import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from './lib/cn.js';

export type PanelProps = HTMLAttributes<HTMLDivElement>;

export const Panel = forwardRef<HTMLDivElement, PanelProps>(
  ({ className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn(
        'overflow-hidden rounded-xl border border-border bg-background shadow-sm',
        className,
      )}
      {...rest}
    />
  ),
);

Panel.displayName = 'Panel';

export const PanelHeader = forwardRef<HTMLDivElement, PanelProps>(
  ({ className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn(
        'border-b border-border bg-background-secondary/60 px-4 py-3',
        className,
      )}
      {...rest}
    />
  ),
);

PanelHeader.displayName = 'PanelHeader';

export const PanelBody = forwardRef<HTMLDivElement, PanelProps>(
  ({ className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col', className)}
      {...rest}
    />
  ),
);

PanelBody.displayName = 'PanelBody';
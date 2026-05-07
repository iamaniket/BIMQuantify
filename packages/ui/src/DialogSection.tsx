'use client';

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from './lib/cn.js';

export type DialogSectionGroupProps = HTMLAttributes<HTMLDivElement> & {
  title: string;
  children: ReactNode;
};

export const DialogSection = forwardRef<HTMLDivElement, DialogSectionGroupProps>(
  ({ title, children, className, ...rest }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-3', className)} {...rest}>
      <div className="border-b border-border pb-2">
        <span className="text-caption font-bold uppercase tracking-[0.12em] text-foreground-tertiary">
          {title}
        </span>
      </div>
      {children}
    </div>
  ),
);

DialogSection.displayName = 'DialogSection';

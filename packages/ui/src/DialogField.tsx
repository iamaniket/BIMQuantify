'use client';

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from './lib/cn.js';

export type DialogFieldProps = HTMLAttributes<HTMLDivElement> & {
  label: string;
  hint?: string;
  children: ReactNode;
};

export const DialogField = forwardRef<HTMLDivElement, DialogFieldProps>(
  ({ label, hint, children, className, ...rest }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1.5', className)} {...rest}>
      <span className="text-caption font-bold uppercase tracking-[0.1em] text-foreground-tertiary">
        {label}
      </span>
      {children}
      {hint !== undefined && (
        <span className="font-sans text-caption text-foreground-tertiary">
          {hint}
        </span>
      )}
    </div>
  ),
);

DialogField.displayName = 'DialogField';

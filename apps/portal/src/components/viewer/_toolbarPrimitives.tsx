'use client';

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ForwardedRef,
  type JSX,
  type ReactNode,
} from 'react';

import { cn } from '@bimstitch/ui';

// Pure-presentational primitives shared by ViewerToolbar (IFC) and
// DocumentToolbar (PDF). No logic, no refs to runtime state — only Tailwind
// classes. The two toolbars stay in visual lockstep without sharing any
// behaviour, command registry, or event bus.

type ShellProps = {
  children: ReactNode;
  className: string | undefined;
  testId: string | undefined;
};

export function ToolbarShell({
  children,
  className,
  testId,
}: Partial<ShellProps> & { children: ReactNode }): JSX.Element {
  return (
    <div
      className={cn('absolute bottom-5 left-1/2 z-40 -translate-x-1/2', className)}
      data-testid={testId}
    >
      <div className="flex items-center rounded-xl border border-border bg-white/95 px-1 py-0.5 shadow-[0_8px_32px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur-xl backdrop-saturate-150 dark:border-white/[0.08] dark:bg-[rgba(15,15,20,0.75)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.06)]">
        {children}
      </div>
    </div>
  );
}

export function ToolbarDivider(): JSX.Element {
  return (
    <div className="mx-0.5 h-4 w-px rounded-full bg-black/[0.08] dark:bg-white/[0.07]" />
  );
}

type GroupProps = {
  children: ReactNode;
  /** Renders a vertical divider before this group. Set false for the first group. */
  withDivider: boolean | undefined;
  className: string | undefined;
};

export function ToolbarGroup({
  children,
  withDivider = true,
  className,
}: Partial<GroupProps> & { children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-center">
      {withDivider ? <ToolbarDivider /> : null}
      <div className={cn('flex items-center gap-0.5 px-0.5 py-0.5', className)}>
        {children}
      </div>
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  isActive?: boolean;
  children: ReactNode;
};

function buttonClassName(disabled: boolean | undefined, isActive: boolean): string {
  if (disabled) return 'cursor-not-allowed text-foreground/20';
  if (isActive) return 'bg-primary-lighter text-primary';
  return 'text-foreground/55 hover:bg-foreground/[0.06] hover:text-foreground/90 active:scale-[0.94]';
}

function ToolButtonInner(
  {
    isActive = false,
    disabled,
    className,
    children,
    ...rest
  }: ButtonProps,
  ref: ForwardedRef<HTMLButtonElement>,
): JSX.Element {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      className={cn(
        'relative inline-flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent',
        buttonClassName(disabled, isActive),
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export const ToolButton = forwardRef<HTMLButtonElement, ButtonProps>(ToolButtonInner);
ToolButton.displayName = 'ToolButton';

/** Inline label/value chip used between buttons (e.g. zoom percentage). */
export function ToolbarReadout({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <span
      className={cn(
        'min-w-[44px] px-1 text-center text-caption font-semibold tabular-nums text-foreground/80',
        className,
      )}
    >
      {children}
    </span>
  );
}

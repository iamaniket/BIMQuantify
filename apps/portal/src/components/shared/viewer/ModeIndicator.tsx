import type { JSX } from 'react';

type Props = {
  toolLabel: string | null;
};

export function ModeIndicator({ toolLabel }: Props): JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-40 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-border bg-white/95 px-4 py-2 shadow-md backdrop-blur-xl dark:border-white/[0.08] dark:bg-[rgba(15,15,20,0.85)]">
        <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />
        <span className="text-xs font-medium text-foreground">
          {toolLabel}
        </span>
        <span className="text-body3 text-foreground-secondary">
          Press ESC to exit
        </span>
      </div>
    </div>
  );
}

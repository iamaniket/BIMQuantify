import type { JSX, ReactNode } from 'react';

type Props = {
  icon: JSX.Element;
  title: string;
  className?: string;
  children: ReactNode;
};

/** Bordered card with an uppercase icon + title header — the shared shell for
 * every Overview-tab chart/section. Pure presentational; data flows in via
 * props. Add `lg:col-span-2` (or `xl:col-span-2`) via `className` for a
 * full-width row inside a two-column grid. */
export function ChartSection({
  icon, title, className, children,
}: Props): JSX.Element {
  return (
    <div className={`rounded-xl border border-border bg-surface-main p-4 ${className ?? ''}`}>
      <div className="mb-3 flex items-center gap-2 text-caption font-bold uppercase tracking-widest text-foreground-tertiary">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

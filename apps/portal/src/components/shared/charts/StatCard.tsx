'use client';

import type { JSX, ReactNode } from 'react';

export type StatAccent = 'primary' | 'success' | 'warning' | 'error' | 'neutral';

type Props = {
  label: string;
  value: string | number;
  sub?: string;
  icon?: ReactNode;
  accent?: StatAccent;
};

const ACCENT_TEXT: Record<StatAccent, string> = {
  primary: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
  neutral: 'text-foreground',
};

/** Compact KPI tile — label + big tabular number + optional sub-line.
 * Store-agnostic; data flows in via props. */
export function StatCard({
  label, value, sub, icon, accent = 'neutral',
}: Props): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface-main p-3.5">
      <div className="flex items-center gap-1.5 text-caption font-bold uppercase tracking-widest text-foreground-tertiary">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <span className={`text-title1 font-semibold leading-none tabular-nums ${ACCENT_TEXT[accent]}`}>
        {value}
      </span>
      {sub !== undefined && <span className="text-caption text-foreground-tertiary">{sub}</span>}
    </div>
  );
}

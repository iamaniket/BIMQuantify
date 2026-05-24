import type { JSX, ReactNode } from 'react';

export type KpiItem = {
  label: string;
  value: string;
  color?: string;
  sub?: ReactNode;
};

type KpiCardProps = KpiItem & {
  /** Show left border divider (typically true for all but the first card). */
  divider?: boolean;
};

export function KpiCard({
  label,
  value,
  color,
  sub,
  divider = false,
}: KpiCardProps): JSX.Element {
  return (
    <div
      className={`flex min-w-0 flex-1 flex-col justify-center px-[22px] py-1 ${
        divider ? 'border-l border-border' : ''
      }`}
    >
      <div className="whitespace-nowrap text-[9px] font-bold uppercase tracking-[0.14em] text-foreground-tertiary">
        {label}
      </div>
      <div
        className="mt-[3px] whitespace-nowrap font-display text-[22px] font-semibold leading-[1.05] tracking-[-0.015em] tabular-nums"
        style={{ color: color ?? 'currentColor' }}
      >
        {value}
      </div>
      {sub !== undefined && (
        <div className="mt-[3px] whitespace-nowrap text-[10.5px] text-foreground-tertiary">
          {sub}
        </div>
      )}
    </div>
  );
}

type KpiStripProps = {
  items: KpiItem[];
};

export function KpiStrip({ items }: KpiStripProps): JSX.Element {
  return (
    <div className="flex items-stretch">
      {items.map((item, i) => (
        <KpiCard key={item.label} {...item} divider={i > 0} />
      ))}
    </div>
  );
}

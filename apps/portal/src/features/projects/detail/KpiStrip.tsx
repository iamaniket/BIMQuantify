import type { JSX } from 'react';

type KpiItem = {
  label: string;
  value: string;
  color?: string;
  sub: string;
};

type Props = {
  items: KpiItem[];
};

export function KpiStrip({ items }: Props): JSX.Element {
  return (
    <div className="grid w-full grid-cols-2 gap-2 xl:grid-cols-4 xl:gap-0">
      {items.map((item, i) => (
        <div
          key={item.label}
          className="min-w-0 rounded-lg border border-black/10 bg-black/[0.02] px-3 py-2 dark:border-white/15 dark:bg-black/35 xl:rounded-none xl:border-y-0 xl:border-l-0 xl:border-r xl:bg-transparent xl:px-4 xl:py-1 first:xl:border-l"
        >
          <div className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-black/70 dark:text-white/85">
            {item.label}
          </div>
          <div
            className="mt-0.5 text-title2 font-semibold tracking-tight"
            style={{ color: item.color ?? 'currentColor' }}
          >
            {item.value}
          </div>
          <div className="mt-0.5 text-caption text-black/60 dark:text-white/80">{item.sub}</div>
        </div>
      ))}
    </div>
  );
}

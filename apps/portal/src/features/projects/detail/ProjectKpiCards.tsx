import type { JSX } from 'react';

type ProjectKpiCard = {
  label: string;
  value: string;
  color?: string;
  sub: string;
};

type Props = {
  items: ProjectKpiCard[];
};

export function ProjectKpiCards({ items }: Props): JSX.Element {
  return (
    <div className="grid w-full grid-cols-2 gap-2 xl:flex xl:items-stretch xl:gap-0">
      {items.map((item, i) => (
        <div
          key={item.label}
          className={`flex min-w-0 flex-col justify-center rounded-lg border border-border bg-surface-low px-3 py-2 dark:bg-black/30 xl:min-w-[124px] xl:rounded-none xl:border-0 xl:bg-transparent xl:px-[22px] xl:py-1 ${
            i === 0 ? '' : 'xl:border-l xl:border-border'
          }`}
        >
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-foreground-tertiary">
            {item.label}
          </div>
          <div
            className="mt-[3px] font-sans text-[22px] font-semibold leading-[1.05] tracking-[-0.015em] tabular-nums"
            style={{ color: item.color ?? 'currentColor' }}
          >
            {item.value}
          </div>
          {item.sub && (
            <div className="mt-[3px] whitespace-nowrap text-[10.5px] text-foreground-tertiary">
              {item.sub}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

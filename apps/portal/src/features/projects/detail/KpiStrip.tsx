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
    <div className="flex items-stretch">
      {items.map((item, i) => (
        <div
          key={item.label}
          className={`min-w-[120px] px-4 py-1 ${
            i === 0 ? 'border-l' : ''
          } border-r border-white/20`}
        >
          <div className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-white/65">
            {item.label}
          </div>
          <div
            className="mt-0.5 text-title2 font-semibold tracking-tight"
            style={{ color: item.color ?? '#ffffff' }}
          >
            {item.value}
          </div>
          <div className="mt-0.5 text-caption text-white/65">{item.sub}</div>
        </div>
      ))}
    </div>
  );
}

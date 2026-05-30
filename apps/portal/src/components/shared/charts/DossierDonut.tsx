'use client';

import { Check, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

export type DossierCategory = {
  category: string;
  labelKey: string;
  fulfilled: boolean;
  count: number;
};

type Props = {
  pct: number;
  categories: DossierCategory[];
  size?: number;
};

function centerColor(pct: number): string {
  if (pct >= 85) return 'var(--success)';
  if (pct >= 70) return 'var(--warning)';
  return 'var(--error)';
}

type SliceDatum = { name: string; value: number; index: number };

export function DossierDonut({ pct, categories, size = 200 }: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.chartsPanel');
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Equal-weight slices, one per requirement category.
  const data: SliceDatum[] = categories.map((c, index) => ({
    name: t(c.labelKey),
    value: 1,
    index,
  }));

  const fillFor = (index: number): string =>
    categories[index]?.fulfilled ? 'var(--success)' : 'var(--background-tertiary)';

  const active = activeIndex !== null ? categories[activeIndex] : null;

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="relative outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-full"
        style={{ width: size, height: size }}
        aria-expanded={expanded}
        aria-label={t('dossierTitle')}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius="62%"
              outerRadius="88%"
              paddingAngle={data.length > 1 ? 2 : 0}
              dataKey="value"
              startAngle={90}
              endAngle={-270}
              stroke="none"
              onMouseEnter={(_: unknown, index: number) => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
              isAnimationActive={false}
            >
              {data.map((d) => (
                <Cell
                  key={d.index}
                  fill={fillFor(d.index)}
                  fillOpacity={activeIndex === null || activeIndex === d.index ? 1 : 0.45}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {active ? (
            <>
              <span className="text-h5 font-semibold leading-none text-foreground">
                {active.count}
              </span>
              <span className="mt-1 max-w-[80%] truncate text-caption uppercase tracking-widest text-foreground-tertiary">
                {t(active.labelKey)}
              </span>
            </>
          ) : (
            <>
              <span
                className="text-h3 font-semibold leading-none"
                style={{ color: centerColor(pct) }}
              >
                {pct}
                <span className="text-title3 text-foreground-tertiary">%</span>
              </span>
              <span className="mt-1 text-caption uppercase tracking-widest text-foreground-tertiary">
                {t('completionLabel')}
              </span>
            </>
          )}
        </div>
      </button>

      {expanded && (
        <ul className="flex w-full max-w-[260px] flex-col gap-1.5">
          {categories.map((c) => (
            <li
              key={c.category}
              className="flex items-center gap-2 rounded-md border border-border bg-surface-low px-2.5 py-1.5 dark:bg-black/20"
            >
              {c.fulfilled ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-success" />
              ) : (
                <X className="h-3.5 w-3.5 shrink-0 text-error" />
              )}
              <span className="min-w-0 flex-1 truncate text-body3 text-foreground-secondary">
                {t(c.labelKey)}
              </span>
              <span className="text-body3 font-semibold tabular-nums text-foreground">
                {c.fulfilled ? t('done') : t('missing')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

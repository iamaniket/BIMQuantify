'use client';

import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

import { Eyebrow } from '@bimstitch/ui';

export type DossierDonutRequirement = {
  code: string;
  label: string;
  required: boolean;
  sourceKind: 'attachment_slot' | 'certificate_type' | 'derived' | 'model';
  fulfilled: boolean;
  count: number;
};

type Props = {
  pct: number;
  requirements: DossierDonutRequirement[];
};

function centerColor(pct: number): string {
  if (pct >= 85) return 'var(--success)';
  if (pct >= 70) return 'var(--warning)';
  return 'var(--error)';
}

type SliceDatum = { name: string; value: number; index: number };

export function DossierDonut({ pct, requirements }: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.chartsPanel');
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const data: SliceDatum[] = requirements.map((r, index) => ({
    name: r.label,
    value: 1,
    index,
  }));

  const fillFor = (index: number): string =>
    requirements[index]?.fulfilled ? 'var(--success)' : 'var(--background-tertiary)';

  const active = activeIndex !== null ? requirements[activeIndex] : null;

  return (
    <div className="flex h-full w-full flex-col items-center gap-3">
      <div
        className="relative aspect-square w-full max-h-full rounded-full"
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
              <Eyebrow size="xs" className="mt-1 max-w-[80%] truncate font-normal text-foreground-tertiary">
                {active.label}
              </Eyebrow>
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
              <Eyebrow size="xs" className="mt-1 font-normal text-foreground-tertiary">
                {t('completionLabel')}
              </Eyebrow>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

import {
  AlertTriangle,
  Check,
  FileText,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

import { CountChip, Eyebrow } from '@bimstitch/ui';

export type DossierDonutRequirement = {
  code: string;
  label: string;
  required: boolean;
  sourceKind: 'attachment_slot' | 'certificate_type' | 'derived';
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

const SOURCE_ICONS: Record<DossierDonutRequirement['sourceKind'], typeof Check> = {
  attachment_slot: FileText,
  certificate_type: ShieldCheck,
  derived: SlidersHorizontal,
};

type SliceDatum = { name: string; value: number; index: number };

export function DossierDonut({ pct, requirements }: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.chartsPanel');
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

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
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="relative aspect-square w-full max-h-full outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-full"
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
      </button>

      {expanded && (
        <ul className="flex w-full max-w-[280px] flex-col gap-1.5">
          {requirements.map((r, index) => {
            const Icon = SOURCE_ICONS[r.sourceKind] ?? FileText;
            return (
              <li
                key={r.code}
                className="flex items-center gap-2 rounded-md border border-border bg-surface-low px-2.5 py-1.5 transition-colors hover:bg-surface-main dark:bg-black/20 dark:hover:bg-black/30"
                onMouseEnter={() => setActiveIndex(index)}
                onMouseLeave={() => setActiveIndex(null)}
              >
                <Icon className={`h-3.5 w-3.5 shrink-0 ${r.fulfilled ? 'text-success' : 'text-foreground-tertiary'}`} />
                <span className="min-w-0 flex-1 truncate text-body3 text-foreground-secondary">
                  {r.label}
                </span>
                <CountChip className="text-body3">
                  {r.count}
                </CountChip>
                {r.fulfilled ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-success" />
                ) : r.required ? (
                  <X className="h-3.5 w-3.5 shrink-0 text-error" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

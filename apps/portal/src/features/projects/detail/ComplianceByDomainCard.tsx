'use client';

import { useState, type JSX } from 'react';

import { Tabs, TabsList, TabsTrigger, TabsContent, Progress } from '@bimstitch/ui';

import { BlueprintTexture } from '@/components/BlueprintTexture';
import { ComplianceDonut } from '@/components/charts/ComplianceDonut';
import { ComplianceBar } from '@/components/charts/ComplianceBar';
import { TrendSparkline } from '@/components/charts/TrendSparkline';
import type {
  ComplianceDomain,
  ComplianceArticle,
  ComplianceTrend,
} from '@/features/projects/compliance/types';
import type { Model } from '@/lib/api/schemas';

type Props = {
  domains: ComplianceDomain[];
  articles: ComplianceArticle[];
  models: Model[];
  trend: ComplianceTrend;
  overallScore: number;
  totalChecks: number;
  failCount: number;
  embedded?: boolean;
};

const DISC_COLORS: Record<string, { bg: string; fg: string }> = {
  architectural: { bg: '#ede8f7', fg: '#5a3fa6' },
  structural: { bg: '#e5edf7', fg: '#2c5697' },
  mep: { bg: '#f8ecd9', fg: '#a97428' },
  coordination: { bg: '#eaf6ef', fg: '#3f8f65' },
  other: { bg: '#f1f3f6', fg: '#4b5563' },
};

export function ComplianceByDomainCard({
  domains,
  articles,
  models,
  trend,
  overallScore,
  totalChecks,
  failCount,
  embedded = false,
}: Props): JSX.Element {
  const [tab, setTab] = useState('domains');

  const seed = [
    { value: 0, color: 'var(--success)' },
    { value: 0, color: 'var(--warning)' },
    { value: 0, color: 'var(--error)' },
  ];
  for (const d of domains) {
    seed[0]!.value += d.pass;
    seed[1]!.value += d.warn;
    seed[2]!.value += d.fail;
  }
  const donutSegments = seed;

  return (
    <div
      className={`relative flex min-h-0 flex-1 flex-col overflow-hidden p-4 ${
        embedded ? 'bg-transparent' : 'rounded-xl border border-border bg-background shadow-sm'
      }`}
    >
      <BlueprintTexture className="opacity-[0.04]" />

      {/* Header */}
      <div className="relative mb-3 flex items-start justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-foreground-tertiary">
            Compliance by domain
          </div>
          <div className="mt-0.5 text-title3 font-medium tracking-tight text-foreground">
            Bbl articles · {totalChecks.toLocaleString()} checks
          </div>
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="domains">Domains</TabsTrigger>
            <TabsTrigger value="articles">Articles</TabsTrigger>
            <TabsTrigger value="models">Models</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Body */}
      <div className="relative flex min-h-0 flex-1 items-center gap-4">
        <div className="shrink-0">
          <ComplianceDonut
            segments={donutSegments}
            centerValue={`${overallScore}%`}
            centerLabel="Wkb compliant"
            centerSub={`${failCount} failing`}
            size={380}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {tab === 'domains' &&
            domains.map((d) => {
              const t = d.pass + d.warn + d.fail;
              const pct = Math.round((d.pass / t) * 100);
              return (
                <div key={d.id}>
                  <div className="mb-1 flex items-baseline justify-between text-body3">
                    <span className="font-semibold text-foreground">{d.name}</span>
                    <span className="flex items-baseline gap-2">
                      <span className="text-caption text-foreground-tertiary">
                        {d.articleCount} arts · {t} checks
                      </span>
                      <span
                        className={`tabular-nums font-bold ${
                          pct > 90
                            ? 'text-success'
                            : pct > 80
                              ? 'text-warning'
                              : 'text-error'
                        }`}
                      >
                        {pct}%
                      </span>
                    </span>
                  </div>
                  <ComplianceBar pass={d.pass} warn={d.warn} fail={d.fail} height={6} />
                </div>
              );
            })}

          {tab === 'articles' && (
            <div className="max-h-60 overflow-auto pr-1">
              {articles.map((a) => {
                const t = a.pass + a.warn + a.fail;
                const pct = Math.round((a.pass / t) * 100);
                return (
                  <div
                    key={a.code}
                    className="border-b border-dashed border-border py-1.5"
                  >
                    <div className="mb-0.5 flex items-baseline justify-between text-caption">
                      <span>
                        <span className="font-mono font-bold text-primary">
                          {a.code}
                        </span>{' '}
                        <span className="text-foreground-secondary">{a.title}</span>
                      </span>
                      <span className="tabular-nums font-bold">{pct}%</span>
                    </div>
                    <ComplianceBar pass={a.pass} warn={a.warn} fail={a.fail} height={4} />
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'models' &&
            models.map((m) => {
              const score = 70 + Math.floor(Math.random() * 30);
              const colors = DISC_COLORS[m.discipline] ?? DISC_COLORS['other'];
              return (
                <div key={m.id}>
                  <div className="mb-1 flex items-baseline justify-between text-body3">
                    <span className="flex items-center gap-1.5 font-medium text-foreground">
                      <span
                        className="rounded-sm px-1 py-px text-[9.5px] font-bold"
                        style={{ background: colors?.bg, color: colors?.fg }}
                      >
                        {m.discipline.slice(0, 4).toUpperCase()}
                      </span>
                      {m.name}
                    </span>
                    <span
                      className={`tabular-nums font-bold ${
                        score > 90
                          ? 'text-success'
                          : score > 75
                            ? 'text-warning'
                            : 'text-error'
                      }`}
                    >
                      {score}%
                    </span>
                  </div>
                  <Progress
                    value={score}
                    variant={score > 90 ? 'success' : score > 75 ? 'warning' : 'error'}
                  />
                </div>
              );
            })}
        </div>
      </div>

      {/* Trend strip */}
      <div className="relative mt-3 flex items-center gap-3 border-t border-border pt-3">
        <div>
          <div className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-foreground-tertiary">
            30-day trend
          </div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-title2 font-semibold text-primary">{overallScore}%</span>
            <span className="text-caption font-bold text-success">↑ 4.2</span>
          </div>
        </div>
        <TrendSparkline data={trend} width={300} height={42} />
      </div>
    </div>
  );
}

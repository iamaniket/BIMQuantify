'use client';

import type { JSX } from 'react';

import { Progress } from '@bimstitch/ui';

import { DossierGauge } from '@/components/charts/DossierGauge';
import type { DossierData } from '@/features/projects/compliance/types';

type Props = {
  dossier: DossierData;
};

export function DossierTab({ dossier }: Props): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-5">
        <DossierGauge
          value={dossier.overallPercentage}
          label="Dossier completeness"
          size={160}
        />
        <div className="rounded-lg border border-primary-light bg-primary-lighter p-3 dark:border-white/20 dark:bg-white/10">
          <div className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-primary dark:text-white/70">
            Holdback unlock
          </div>
          <div className="mt-0.5 text-title2 font-semibold tracking-tight text-primary dark:text-white">
            {dossier.holdbackAmount}
          </div>
          <div className="mt-1.5 text-caption text-foreground-tertiary dark:text-white/70">
            Released when dossier reaches 100%
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-foreground-tertiary">
          Sections
        </div>
        {dossier.sections.map((s) => (
          <div key={s.name}>
            <div className="mb-1 flex items-baseline justify-between text-body3">
              <span className="font-medium text-foreground">{s.name}</span>
              <span className="flex items-baseline gap-2">
                <span className="text-caption text-foreground-tertiary">
                  {s.itemsDone} / {s.itemsTotal}
                </span>
                <span
                  className={`tabular-nums font-bold ${
                    s.percentage >= 95
                      ? 'text-success'
                      : s.percentage >= 70
                        ? 'text-warning'
                        : 'text-error'
                  }`}
                >
                  {s.percentage}%
                </span>
              </span>
            </div>
            <Progress
              value={s.percentage}
              variant={s.percentage >= 95 ? 'success' : s.percentage >= 70 ? 'warning' : 'error'}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { BlueprintTexture } from '@/components/BlueprintTexture';
import type { ComplianceSummary } from '@/features/projects/compliance/types';

import { HoldbackUnlock } from './HoldbackUnlock';

type Props = {
  summary: ComplianceSummary;
  holdbackAmount: string;
  embedded?: boolean;
};

const counters: Array<{
  labelKey: 'pass' | 'warn' | 'fail';
  key: 'passCount' | 'warnCount' | 'failCount';
  borderClass: string;
}> = [
  { labelKey: 'pass', key: 'passCount', borderClass: 'border-l-success' },
  { labelKey: 'warn', key: 'warnCount', borderClass: 'border-l-warning' },
  { labelKey: 'fail', key: 'failCount', borderClass: 'border-l-error' },
];

export function ComplianceHealthCard({ summary, holdbackAmount, embedded = false }: Props): JSX.Element {
  const t = useTranslations('reports.health');
  return (
    <div
      className={`relative overflow-hidden ${
        embedded
          ? 'bg-transparent'
          : 'rounded-xl border border-border bg-background shadow-sm dark:border-none dark:bg-gradient-to-br dark:from-[#0e141c] dark:via-[#152035] dark:to-[#1e3253]'
      }`}
    >
      <BlueprintTexture />
      <div className="relative grid grid-cols-[1.4fr_1fr] gap-4 p-5">
        <div>
          <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-primary dark:text-white/65">
            {t('eyebrow')}
          </div>
          <div className="mt-1 text-h5 font-medium tracking-tight text-foreground dark:text-white">
            {t('title')}
          </div>
          <div className="mt-3.5 grid grid-cols-3 gap-3.5">
            {counters.map(({ labelKey, key, borderClass }) => (
              <div key={key} className={`border-l-2 pl-2 ${borderClass}`}>
                <div className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-foreground-tertiary dark:text-white/60">
                  {t(labelKey)}
                </div>
                <div className="mt-0.5 text-title2 font-semibold text-foreground dark:text-white">
                  {summary[key].toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
        <HoldbackUnlock
          holdbackAmount={holdbackAmount}
          dossierPct={summary.dossierPercentage}
        />
      </div>
    </div>
  );
}

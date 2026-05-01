import type { JSX } from 'react';

import { Progress } from '@bimstitch/ui';

type Props = {
  holdbackAmount: string;
  dossierPct: number;
};

export function HoldbackUnlock({ holdbackAmount, dossierPct }: Props): JSX.Element {
  return (
    <div className="rounded-xl border border-primary-light bg-primary-lighter p-3 dark:border-white/20 dark:bg-white/10">
      <div className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-primary dark:text-white/70">
        Holdback unlock
      </div>
      <div className="mt-0.5 text-title2 font-semibold tracking-tight text-primary dark:text-white">
        {holdbackAmount}
      </div>
      <Progress value={dossierPct} variant="success" className="mt-2.5" />
      <div className="mt-1.5 flex justify-between text-caption tabular-nums text-foreground-tertiary dark:text-white/70">
        <span>Dossier {dossierPct}%</span>
        <span>{100 - dossierPct}% to go</span>
      </div>
    </div>
  );
}

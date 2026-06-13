'use client';

import { useTranslations } from 'next-intl';
import { type JSX } from 'react';

import { Eyebrow } from '@bimstitch/ui';

import { type DossierCompleteness } from './dossierTemplate';

type Props = {
  dossier: DossierCompleteness;
};

function completionColor(pct: number): string {
  if (pct >= 85) return 'var(--success)';
  if (pct >= 70) return 'var(--warning)';
  return 'var(--error)';
}

export function ProjectChartsPanel({ dossier }: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.chartsPanel');

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <Eyebrow as="span" tone="tertiary">{t('dossierTitle')}</Eyebrow>
        <span
          className="text-h2 font-semibold leading-none tabular-nums"
          style={{ color: completionColor(dossier.pct) }}
        >
          {dossier.pct}
          <span className="text-title3 text-foreground-tertiary">%</span>
        </span>
        <span className="text-body2 text-foreground-tertiary">{t('completionLabel')}</span>
        <p className="max-w-[24ch] text-caption text-foreground-tertiary">
          {t('placeholder')}
        </p>
      </div>
    </div>
  );
}

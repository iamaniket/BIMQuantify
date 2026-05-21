'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Progress } from '@bimstitch/ui';

type Props = {
  completed: number;
  total: number;
  failed: number;
};

export function ProgressBar({ completed, total, failed }: Props): JSX.Element {
  const t = useTranslations('inspection.progress');
  const pct = total > 0 ? (completed / total) * 100 : 0;
  const variant = failed > 0 ? 'error' : completed === total && total > 0 ? 'success' : 'primary';

  return (
    <div className="flex flex-col gap-1.5 border-t border-border bg-background px-4 py-3">
      <div className="flex items-center justify-between text-caption">
        <span className="font-medium text-foreground">
          {t('of', { completed, total })}
        </span>
        {failed > 0 && (
          <span className="text-error">{t('failed', { count: failed })}</span>
        )}
      </div>
      <Progress value={pct} variant={variant} />
    </div>
  );
}

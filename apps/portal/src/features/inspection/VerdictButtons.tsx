'use client';

import { Check, X, Minus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import type { InspectionVerdictValue } from '@/lib/api/schemas';

type Props = {
  selected: InspectionVerdictValue | null;
  onSelect: (verdict: InspectionVerdictValue) => void;
  disabled?: boolean;
};

export function VerdictButtons({ selected, onSelect, disabled }: Props): JSX.Element {
  const t = useTranslations('inspection.verdict');

  return (
    <div className="grid grid-cols-3 gap-2">
      <button
        type="button"
        onClick={() => onSelect('pass')}
        disabled={disabled}
        className={`flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-lg border-2 px-3 py-2 text-body2 font-semibold transition-colors ${
          selected === 'pass'
            ? 'border-success bg-success-lighter text-success'
            : 'border-border bg-background text-foreground-secondary hover:border-success hover:bg-success-lighter/50'
        } disabled:opacity-50`}
        aria-pressed={selected === 'pass'}
      >
        <Check className="h-6 w-6" />
        {t('pass')}
      </button>
      <button
        type="button"
        onClick={() => onSelect('fail')}
        disabled={disabled}
        className={`flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-lg border-2 px-3 py-2 text-body2 font-semibold transition-colors ${
          selected === 'fail'
            ? 'border-error bg-error-lighter text-error'
            : 'border-border bg-background text-foreground-secondary hover:border-error hover:bg-error-lighter/50'
        } disabled:opacity-50`}
        aria-pressed={selected === 'fail'}
      >
        <X className="h-6 w-6" />
        {t('fail')}
      </button>
      <button
        type="button"
        onClick={() => onSelect('not_applicable')}
        disabled={disabled}
        className={`flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-lg border-2 px-3 py-2 text-body2 font-semibold transition-colors ${
          selected === 'not_applicable'
            ? 'border-warning bg-warning-lighter text-warning'
            : 'border-border bg-background text-foreground-secondary hover:border-warning hover:bg-warning-lighter/50'
        } disabled:opacity-50`}
        aria-pressed={selected === 'not_applicable'}
      >
        <Minus className="h-6 w-6" />
        {t('notApplicable')}
      </button>
    </div>
  );
}

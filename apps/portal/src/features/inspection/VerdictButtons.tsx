'use client';

import { cn, type AppIcon } from '@bimstitch/ui';
import { Check, X, Minus } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import type { InspectionVerdictValue } from '@/lib/api/schemas';

type Props = {
  selected: InspectionVerdictValue | null;
  onSelect: (verdict: InspectionVerdictValue) => void;
  disabled?: boolean;
};

type VerdictTone = 'success' | 'error' | 'warning';

const TONE_STYLES: Record<VerdictTone, { selected: string; idle: string }> = {
  success: {
    selected: 'border-success bg-success-lighter text-success',
    idle: 'border-border bg-background text-foreground-secondary hover:border-success hover:bg-success-lighter/50',
  },
  error: {
    selected: 'border-error bg-error-lighter text-error',
    idle: 'border-border bg-background text-foreground-secondary hover:border-error hover:bg-error-lighter/50',
  },
  warning: {
    selected: 'border-warning bg-warning-lighter text-warning',
    idle: 'border-border bg-background text-foreground-secondary hover:border-warning hover:bg-warning-lighter/50',
  },
};

type VerdictButtonProps = {
  tone: VerdictTone;
  icon: AppIcon;
  label: string;
  isSelected: boolean;
  disabled: boolean | undefined;
  onClick: () => void;
};

/**
 * A large (56px) tonal selectable card — deliberately NOT a `Button` variant,
 * since its success/error/warning tonal border states don't map to any.
 */
function VerdictButton({
  tone, icon: Icon, label, isSelected, disabled, onClick,
}: VerdictButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={isSelected}
      className={cn(
        'flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-lg border-2 px-3 py-2 text-body2 font-semibold transition-colors disabled:opacity-50',
        isSelected ? TONE_STYLES[tone].selected : TONE_STYLES[tone].idle,
      )}
    >
      <Icon className="h-6 w-6" />
      {label}
    </button>
  );
}

export function VerdictButtons({ selected, onSelect, disabled }: Props): JSX.Element {
  const t = useTranslations('inspection.verdict');

  return (
    <div className="grid grid-cols-3 gap-2">
      <VerdictButton
        tone="success"
        icon={Check}
        label={t('pass')}
        isSelected={selected === 'pass'}
        disabled={disabled}
        onClick={() => onSelect('pass')}
      />
      <VerdictButton
        tone="error"
        icon={X}
        label={t('fail')}
        isSelected={selected === 'fail'}
        disabled={disabled}
        onClick={() => onSelect('fail')}
      />
      <VerdictButton
        tone="warning"
        icon={Minus}
        label={t('notApplicable')}
        isSelected={selected === 'not_applicable'}
        disabled={disabled}
        onClick={() => onSelect('not_applicable')}
      />
    </div>
  );
}

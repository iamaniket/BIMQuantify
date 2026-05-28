'use client';

import { CheckCircle2, XCircle, MinusCircle, Circle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { cn } from '@bimstitch/ui';

import type { ElementInspectionItem } from '@/lib/api/schemas/elementInspections';

type InspectionItemRowProps = {
  item: ElementInspectionItem;
  onClick?: (() => void) | undefined;
};

const VERDICT_CONFIG = {
  pass: {
    icon: CheckCircle2,
    colorClass: 'text-success',
    labelKey: 'verdictPass' as const,
  },
  fail: {
    icon: XCircle,
    colorClass: 'text-error',
    labelKey: 'verdictFail' as const,
  },
  not_applicable: {
    icon: MinusCircle,
    colorClass: 'text-foreground-tertiary',
    labelKey: 'verdictNa' as const,
  },
} as const;

export function InspectionItemRow({
  item,
  onClick,
}: InspectionItemRowProps): JSX.Element {
  const t = useTranslations('viewerInspections');
  const verdict = item.result?.verdict ?? null;
  const config = verdict !== null ? VERDICT_CONFIG[verdict] : null;
  const Icon = config?.icon ?? Circle;
  const colorClass = config?.colorClass ?? 'text-foreground-quaternary';
  const verdictLabel = config !== null ? t(config.labelKey) : t('verdictPending');

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left',
        'transition-colors duration-100 hover:bg-background-secondary/60',
      )}
    >
      <div className="mt-0.5 shrink-0">
        <Icon className={cn('h-4 w-4', colorClass)} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-caption font-medium text-foreground">
          {item.checklist_item.description}
        </p>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className={cn('text-[10px] font-semibold uppercase', colorClass)}>
            {verdictLabel}
          </span>
          <span className="text-[10px] text-foreground-tertiary">·</span>
          <span className="truncate text-[10px] text-foreground-tertiary">
            {item.moment_name}
          </span>
        </div>
      </div>
    </button>
  );
}

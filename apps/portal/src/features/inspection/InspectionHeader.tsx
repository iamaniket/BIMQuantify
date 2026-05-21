'use client';

import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Badge } from '@bimstitch/ui';

import { Link } from '@/i18n/navigation';
import type { BorgingsmomentStatusValue } from '@/lib/api/schemas';

const STATUS_BADGE: Record<BorgingsmomentStatusValue, 'info' | 'success' | 'error' | 'warning' | 'default'> = {
  planned: 'default',
  in_progress: 'info',
  passed: 'success',
  failed: 'error',
  skipped: 'warning',
};

type Props = {
  projectId: string;
  momentName: string;
  status: BorgingsmomentStatusValue;
};

export function InspectionHeader({ projectId, momentName, status }: Props): JSX.Element {
  const t = useTranslations('inspection');

  return (
    <header className="flex items-center gap-3 border-b border-border bg-background px-4 py-3">
      <Link
        href={`/projects/${projectId}`}
        className="flex items-center justify-center rounded-md p-1.5 text-foreground-secondary hover:bg-background-secondary hover:text-foreground"
        aria-label={t('header.back')}
      >
        <ArrowLeft className="h-5 w-5" />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="truncate text-body2 font-semibold text-foreground">{momentName}</h1>
      </div>
      <Badge variant={STATUS_BADGE[status]}>{t(`status.${status}`)}</Badge>
    </header>
  );
}

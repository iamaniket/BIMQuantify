'use client';

import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, type JSX } from 'react';

import { Skeleton } from '@bimdossier/ui';

import { InspectionScreen } from '@/features/inspection/InspectionScreen';
import { useBorgingsplan } from '@/features/borgingsplan/useBorgingsplan';
import { Link } from '@/i18n/navigation';

export default function InspectionPage(): JSX.Element {
  const t = useTranslations('inspection');
  const params = useParams<{ projectId: string; momentId: string }>();
  const { projectId, momentId } = params;
  const planQuery = useBorgingsplan(projectId);

  const moment = useMemo(() => {
    if (planQuery.data === null || planQuery.data === undefined) return undefined;
    return planQuery.data.moments.find((m) => m.id === momentId);
  }, [planQuery.data, momentId]);

  if (planQuery.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Skeleton className="h-48 w-72" />
      </div>
    );
  }

  if (moment === undefined) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4">
        <p className="text-body2 text-foreground-secondary">{t('error.notFound')}</p>
        <Link
          href={`/projects/${projectId}`}
          className="text-body3 font-medium text-primary hover:underline"
        >
          {t('header.back')}
        </Link>
      </div>
    );
  }

  return <InspectionScreen projectId={projectId} moment={moment} />;
}

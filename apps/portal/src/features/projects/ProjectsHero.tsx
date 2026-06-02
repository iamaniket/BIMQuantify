'use client';

import { FolderKanban } from 'lucide-react';
import { useMemo, type JSX } from 'react';
import { useTranslations } from 'next-intl';

import { Badge } from '@bimstitch/ui';

import { HeroShell } from '@/components/shared/layout/HeroShell';
import type { ExpiringCertificatesSummary } from '@/features/certificates/useExpiringCertificates';
import type { Project } from '@/lib/api/schemas';
import { daysUntil } from '@/lib/formatting/projects';

type Props = {
  projects: Project[];
  certWarning: ExpiringCertificatesSummary;
};

export function ProjectsHero({ projects, certWarning }: Props): JSX.Element {
  const t = useTranslations('projects.hero');

  const stats = useMemo(() => {
    const active = projects.filter((p) => p.lifecycle_state === 'active');
    const archived = projects.filter((p) => p.lifecycle_state === 'archived');
    const inConstruction = active.filter((p) => p.status === 'construction');
    const inDesign = active.filter((p) => p.status === 'design');

    let approaching = 0;
    let overdue = 0;
    for (const p of active) {
      if (p.delivery_date === null) continue;
      const days = daysUntil(p.delivery_date);
      if (days < 0) overdue++;
      else if (days <= 30) approaching++;
    }

    return {
      activeCount: active.length,
      archivedCount: archived.length,
      totalCount: projects.length,
      constructionCount: inConstruction.length,
      designCount: inDesign.length,
      approaching,
      overdue,
    };
  }, [projects]);

  let deadlineValue: string;
  let deadlineSub: string;
  let deadlineColor: string | undefined;

  if (stats.overdue > 0) {
    deadlineValue = String(stats.overdue + stats.approaching);
    deadlineSub = t('deadlinesOverdue', { count: stats.overdue });
    deadlineColor = 'var(--error)';
  } else if (stats.approaching > 0) {
    deadlineValue = String(stats.approaching);
    deadlineSub = t('deadlinesApproaching', { count: stats.approaching });
    deadlineColor = 'var(--warning)';
  } else {
    deadlineValue = '0';
    deadlineSub = t('deadlinesOnTrack');
  }

  const hasAnyDeliveryDate = projects.some((p) => p.delivery_date !== null);
  if (!hasAnyDeliveryDate) {
    deadlineValue = '—';
    deadlineSub = t('deadlinesNone');
    deadlineColor = undefined;
  }

  let certColor: string | undefined;
  if (certWarning.expired.length > 0) certColor = 'var(--error)';
  else if (certWarning.expiring.length > 0) certColor = 'var(--warning)';

  return (
    <HeroShell
      image={
        <div className="flex h-[130px] w-[195px] items-center justify-center rounded-[10px] bg-gradient-to-br from-primary to-primary-light text-primary-foreground shadow-[0_4px_14px_rgba(44,86,151,0.12)] dark:shadow-[0_4px_14px_rgba(0,0,0,0.30)]">
          <FolderKanban className="h-12 w-12" />
        </div>
      }
      title={t('title')}
      badge={<Badge variant="info">{t('badge')}</Badge>}
      subtitle={
        <span>
          {t('subtitle', {
            active: stats.activeCount,
            archived: stats.archivedCount,
          })}
        </span>
      }
      kpis={[
        {
          label: t('activeLabel'),
          value: String(stats.activeCount),
          sub: t('activeSub', { count: stats.totalCount }),
          ...(stats.activeCount > 0 ? { color: 'var(--success)' } : {}),
        },
        {
          label: t('constructionLabel'),
          value: String(stats.constructionCount),
          sub: t('constructionSub', { design: stats.designCount }),
        },
        {
          label: t('deadlinesLabel'),
          value: deadlineValue,
          sub: deadlineSub,
          ...(deadlineColor !== undefined ? { color: deadlineColor } : {}),
        },
        {
          label: t('certificatesLabel'),
          value: certWarning.total > 0 ? String(certWarning.total) : '0',
          sub: certWarning.total > 0
            ? t('certificatesSub', {
                expired: certWarning.expired.length,
                expiring: certWarning.expiring.length,
              })
            : t('certificatesOk'),
          ...(certColor !== undefined ? { color: certColor } : {}),
        },
      ]}
    />
  );
}

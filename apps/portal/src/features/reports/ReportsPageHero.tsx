'use client';

import { FileText } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import { useMemo, type JSX } from 'react';

import { Badge } from '@bimdossier/ui';

import { HeroImage } from '@/components/shared/layout/HeroImage';
import { HeroShell, type KpiItem } from '@/components/shared/layout/HeroShell';
import type { Report } from '@/lib/api/schemas/reports';

import { REPORT_TYPE_ORDER } from './reportTypeMeta';

/**
 * Identity + KPI hero for the dedicated project Reports page, mirroring
 * {@link FindingsBoardHero}. The generate control lives in the page toolbar (the
 * hero action slot is xl-only), so this hero is purely project name + headline
 * report stats.
 */
export function ReportsPageHero({
  projectName,
  reports,
}: {
  projectName: string;
  reports: Report[];
}): JSX.Element {
  const t = useTranslations('reports.hub.hero');

  const stats = useMemo(() => {
    let ready = 0;
    let pending = 0;
    const types = new Set<string>();
    for (const r of reports) {
      if (r.status === 'ready') ready += 1;
      else if (r.status === 'queued' || r.status === 'running') pending += 1;
      types.add(r.report_type);
    }
    const typesCovered = REPORT_TYPE_ORDER.filter((rt) => types.has(rt)).length;
    return { total: reports.length, ready, pending, typesCovered };
  }, [reports]);

  const kpis: KpiItem[] = [
    {
      label: t('totalLabel'),
      value: String(stats.total),
      sub: t('totalSub', { count: stats.total }),
    },
    {
      label: t('readyLabel'),
      value: String(stats.ready),
      sub: t('readySub'),
      ...(stats.ready > 0 ? { color: 'var(--success)' } : {}),
    },
    {
      label: t('pendingLabel'),
      value: String(stats.pending),
      sub: t('pendingSub'),
      ...(stats.pending > 0 ? { color: 'var(--warning)' } : {}),
    },
    {
      label: t('typesLabel'),
      value: `${String(stats.typesCovered)}/${String(REPORT_TYPE_ORDER.length)}`,
      sub: t('typesSub'),
    },
  ];

  return (
    <HeroShell
      image={(
        <HeroImage>
          <FileText className="h-12 w-12 text-primary-foreground" />
        </HeroImage>
      )}
      title={projectName}
      badge={<Badge variant="info">{t('badge')}</Badge>}
      subtitle={<span>{t('subtitle')}</span>}
      kpis={kpis}
    />
  );
}

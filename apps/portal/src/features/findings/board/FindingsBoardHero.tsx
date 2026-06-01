'use client';

import { ClipboardCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, type JSX } from 'react';

import { Badge } from '@bimstitch/ui';

import { HeroShell, type KpiItem } from '@/components/shared/layout/HeroShell';
import type { Finding } from '@/lib/api/schemas';

type Props = {
  projectName: string;
  findings: Finding[];
};

export function FindingsBoardHero({ projectName, findings }: Props): JSX.Element {
  const t = useTranslations('findingsBoard.hero');

  const stats = useMemo(() => {
    const total = findings.length;
    let active = 0;
    let overdue = 0;
    let resolved = 0;

    const today = new Date(new Date().toDateString());

    for (const f of findings) {
      if (f.status === 'resolved' || f.status === 'verified') {
        resolved++;
      } else {
        active++;
        if (f.deadline_date !== null && new Date(f.deadline_date) < today) {
          overdue++;
        }
      }
    }

    const resolvedPct = total > 0 ? Math.round((resolved / total) * 100) : 0;

    return { total, active, overdue, resolved, resolvedPct };
  }, [findings]);

  const kpis: KpiItem[] = [
    {
      label: t('totalLabel'),
      value: String(stats.total),
      sub: t('totalSub', { count: stats.total }),
    },
    {
      label: t('activeLabel'),
      value: String(stats.active),
      sub: t('activeSub'),
      ...(stats.active > 0 ? { color: 'var(--warning)' } : {}),
    },
    {
      label: t('overdueLabel'),
      value: String(stats.overdue),
      sub: stats.overdue > 0
        ? t('overdueSub', { count: stats.overdue })
        : t('overdueNone'),
      ...(stats.overdue > 0 ? { color: 'var(--error)' } : {}),
    },
    {
      label: t('resolvedLabel'),
      value: stats.total > 0 ? `${String(stats.resolvedPct)}%` : '—',
      sub: t('resolvedSub'),
      ...(stats.resolvedPct >= 80 ? { color: 'var(--success)' } : {}),
    },
  ];

  return (
    <HeroShell
      image={
        <div className="flex h-[80px] w-[80px] items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-light text-primary-foreground shadow-md">
          <ClipboardCheck className="h-9 w-9" />
        </div>
      }
      title={projectName}
      badge={
        <Badge variant="info">
          {t('badge')}
        </Badge>
      }
      subtitle={<span>{t('subtitle')}</span>}
      kpis={kpis}
    />
  );
}

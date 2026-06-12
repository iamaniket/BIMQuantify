'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, type JSX } from 'react';

import type { Locale } from '@bimstitch/i18n';
import { Badge } from '@bimstitch/ui';

import { FindingDetailModal } from '@/features/projects/detail/FindingDetailModal';
import { severityBadgeVariant, statusBadgeVariant } from '@/features/projects/detail/findingBadges';
import { formatDate } from '@/lib/formatting/dates';
import type { Finding } from '@/lib/api/schemas';

type BucketKey = 'overdue' | 'dueThisWeek' | 'later' | 'noDeadline';

const BUCKET_ORDER: BucketKey[] = ['overdue', 'dueThisWeek', 'later', 'noDeadline'];

function isActive(f: Finding): boolean {
  return f.status !== 'resolved' && f.status !== 'verified';
}

type Props = {
  projectId: string;
  findings: Finding[];
};

export function FindingsCalendarTab({ projectId, findings }: Props): JSX.Element {
  const t = useTranslations('findingsBoard.calendar');
  const tStatus = useTranslations('findingsBoard.columns');
  const tSeverity = useTranslations('findings.severity');
  const locale = useLocale() as Locale;
  const [selected, setSelected] = useState<Finding | null>(null);

  const buckets = useMemo(() => {
    const today = new Date(new Date().toDateString());
    const weekAhead = new Date(today);
    weekAhead.setDate(weekAhead.getDate() + 7);

    const out: Record<BucketKey, Finding[]> = {
      overdue: [],
      dueThisWeek: [],
      later: [],
      noDeadline: [],
    };

    for (const f of findings) {
      if (f.deadline_date === null) {
        out.noDeadline.push(f);
      } else {
        const due = new Date(f.deadline_date);
        if (isActive(f) && due < today) out.overdue.push(f);
        else if (due <= weekAhead) out.dueThisWeek.push(f);
        else out.later.push(f);
      }
    }

    const byDate = (a: Finding, b: Finding): number => ((a.deadline_date ?? '') < (b.deadline_date ?? '') ? -1 : 1);
    out.overdue.sort(byDate);
    out.dueThisWeek.sort(byDate);
    out.later.sort(byDate);

    return out;
  }, [findings]);

  return (
    <div className="flex flex-col gap-5">
      {BUCKET_ORDER.map((key) => {
        const items = buckets[key];
        if (items.length === 0) return null;
        const isOverdue = key === 'overdue';
        return (
          <div key={key} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <h3
                className="text-caption font-bold uppercase tracking-widest"
                style={isOverdue ? { color: 'var(--error)' } : undefined}
              >
                {t(key)}
              </h3>
              <span className="text-body3 tabular-nums text-foreground-tertiary">{items.length}</span>
            </div>
            <ul className="flex flex-col gap-1.5">
              {items.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => { setSelected(f); }}
                    className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-background-hover"
                  >
                    <span className="min-w-0 flex-1 truncate text-body3 font-medium text-foreground">{f.title}</span>
                    <Badge variant={severityBadgeVariant(f.severity)} size="md" bordered>
                      {tSeverity(f.severity)}
                    </Badge>
                    <Badge variant={statusBadgeVariant(f.status)} size="md">
                      {tStatus(f.status)}
                    </Badge>
                    {f.deadline_date !== null && (
                      <span
                        className="shrink-0 text-[11px] font-semibold tabular-nums"
                        style={isOverdue ? { color: 'var(--error)' } : { color: 'var(--foreground-tertiary)' }}
                      >
                        {formatDate(f.deadline_date, locale)}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {findings.length === 0 && (
        <p className="py-8 text-center text-body3 text-foreground-tertiary">{t('empty')}</p>
      )}

      <FindingDetailModal
        projectId={projectId}
        finding={selected}
        open={selected !== null}
        onOpenChange={(o) => { if (!o) setSelected(null); }}
      />
    </div>
  );
}

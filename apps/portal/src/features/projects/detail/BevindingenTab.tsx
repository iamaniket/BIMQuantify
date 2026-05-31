'use client';

import { AlertTriangle, Plus, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import {
  Badge,
  Button,
  EmptyState,
  Skeleton,
} from '@bimstitch/ui';

import { useFindings } from '@/features/findings/useFindings';
import type { Finding } from '@/lib/api/schemas';

import { FindingDetailModal } from './FindingDetailModal';
import { FindingFormDialog } from './FindingFormDialog';
import { severityBadgeVariant, statusBadgeVariant } from './findingBadges';

type Props = {
  projectId: string;
};

export function BevindingenTab({ projectId }: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.bevindingen');
  const tSeverity = useTranslations('findings.severity');
  const tStatus = useTranslations('findings.status');
  const findingsQuery = useFindings(projectId);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Finding | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const allFindings = findingsQuery.data ?? [];
  const findings = searchQuery === ''
    ? allFindings
    : allFindings.filter((f) => {
        const q = searchQuery.toLowerCase();
        return (
          f.title.toLowerCase().includes(q) ||
          f.description.toLowerCase().includes(q) ||
          (f.bbl_article_ref?.toLowerCase().includes(q) ?? false)
        );
      });

  if (findingsQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (allFindings.length === 0) {
    return (
      <>
        <EmptyState
          icon={AlertTriangle}
          title={t('title')}
          description={t('description')}
          action={(
            <Button variant="border" size="sm" onClick={() => { setCreateOpen(true); }}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              {t('ctaLabel')}
            </Button>
          )}
          className={undefined}
        />
        <FindingFormDialog
          projectId={projectId}
          open={createOpen}
          onOpenChange={setCreateOpen}
        />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-tertiary" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); }}
            placeholder={t('searchPlaceholder')}
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-body3 text-foreground placeholder:text-foreground-disabled focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="shrink-0 text-body3 text-foreground-tertiary">
          {t('count', { count: findings.length })}
        </div>
        <Button variant="border" size="sm" onClick={() => { setCreateOpen(true); }}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {t('ctaLabel')}
        </Button>
      </div>

      {findings.length === 0 ? (
        <p className="py-6 text-center text-body3 text-foreground-tertiary">
          {t('noResults')}
        </p>
      ) : (
      <div className="rounded-lg border border-border bg-background">
        {findings.map((finding, idx) => (
          <button
            key={finding.id}
            type="button"
            onClick={() => { setSelected(finding); }}
            className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-background-hover ${
              idx > 0 ? 'border-t border-border' : ''
            }`}
          >
            <Badge variant={severityBadgeVariant(finding.severity)} className="w-fit shrink-0">
              {tSeverity(finding.severity)}
            </Badge>
            <span className="min-w-0 flex-1 truncate text-body3 font-medium text-foreground">
              {finding.title}
            </span>
            {finding.deadline_date !== null && (
              <span className="shrink-0 text-caption tabular-nums text-foreground-tertiary">
                {new Date(finding.deadline_date).toLocaleDateString()}
              </span>
            )}
            <Badge variant={statusBadgeVariant(finding.status)} className="w-fit shrink-0">
              {tStatus(finding.status)}
            </Badge>
          </button>
        ))}
      </div>
      )}

      <FindingFormDialog
        projectId={projectId}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
      <FindingDetailModal
        projectId={projectId}
        finding={selected}
        open={selected !== null}
        onOpenChange={(o) => { if (!o) setSelected(null); }}
      />
    </div>
  );
}

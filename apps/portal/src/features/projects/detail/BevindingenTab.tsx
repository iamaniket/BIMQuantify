'use client';

import { AlertTriangle, Columns3, Eye, Plus, Search, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useState, type JSX } from 'react';

import {
  Badge,
  Button,
  EmptyState,
  MetaGrid,
  Skeleton,
} from '@bimstitch/ui';
import {
  DetailCard,
  DetailCardBody,
  DetailCardFooter,
  DetailCardRow,
} from '@bimstitch/ui';

import { useDeleteFinding } from '@/features/findings/useDeleteFinding';
import { useFindings } from '@/features/findings/useFindings';
import { useProjectMembers } from '@/features/projects/members/useProjectMembers';
import type { Finding } from '@/lib/api/schemas';

import { Link } from '@/i18n/navigation';

import { FindingDetailModal } from './FindingDetailModal';
import { FindingFormDialog } from './FindingFormDialog';
import { severityBadgeVariant, statusBadgeVariant } from './findingBadges';

type Props = {
  projectId: string;
};

function formatDate(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function BevindingenTab({ projectId }: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.bevindingen');
  const tSeverity = useTranslations('findings.severity');
  const tStatus = useTranslations('findings.status');
  const tExpanded = useTranslations('findings.expanded');
  const findingsQuery = useFindings(projectId);
  const membersQuery = useProjectMembers(projectId);
  const deleteMutation = useDeleteFinding(projectId);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Finding | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const members = membersQuery.data ?? [];

  const getAssigneeName = useCallback(
    (userId: string | null): string | null => {
      if (userId === null) return null;
      const member = members.find((m) => m.user_id === userId);
      return member?.full_name ?? member?.email ?? null;
    },
    [members],
  );

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

  const handleDelete = useCallback(
    (finding: Finding) => {
      deleteMutation.mutate(finding.id, {
        onSuccess: () => {
          if (expandedId === finding.id) setExpandedId(null);
        },
      });
    },
    [deleteMutation, expandedId],
  );

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
        <Link href={`/projects/${projectId}/findings`}>
          <Button variant="border" size="sm">
            <Columns3 className="mr-1.5 h-3.5 w-3.5" />
            {t('boardLabel')}
          </Button>
        </Link>
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
        <div className="overflow-hidden rounded-lg border border-border bg-background">
          {findings.map((finding) => {
            const isExpanded = expandedId === finding.id;
            const assigneeName = getAssigneeName(finding.assignee_user_id);

            const entries: Array<{ label: string; value: string }> = [
              { label: tExpanded('status'), value: tStatus(finding.status) },
              { label: tExpanded('severity'), value: tSeverity(finding.severity) },
              { label: tExpanded('assignee'), value: assigneeName ?? tExpanded('noAssignee') },
            ];
            if (finding.deadline_date !== null) {
              entries.push({ label: tExpanded('deadline'), value: formatDate(finding.deadline_date) });
            }
            if (finding.bbl_article_ref !== null && finding.bbl_article_ref !== '') {
              entries.push({ label: tExpanded('bblRef'), value: finding.bbl_article_ref });
            }
            if (finding.photo_ids !== null && finding.photo_ids.length > 0) {
              entries.push({ label: tExpanded('photos'), value: tExpanded('photoCount', { count: finding.photo_ids.length }) });
            }
            if (finding.linked_element_global_id !== null) {
              entries.push({ label: tExpanded('linkedElement'), value: tExpanded('linkedYes') });
            }
            entries.push({ label: tExpanded('created'), value: formatDate(finding.created_at) });
            if (finding.updated_at !== finding.created_at) {
              entries.push({ label: tExpanded('updated'), value: formatDate(finding.updated_at) });
            }

            return (
              <DetailCard
                key={finding.id}
                expanded={isExpanded}
                onToggle={() => { setExpandedId(isExpanded ? null : finding.id); }}
              >
                <DetailCardRow
                  media={
                    <AlertTriangle className="h-5 w-5 text-foreground-tertiary" aria-hidden />
                  }
                  actions={
                    <button
                      type="button"
                      title={tExpanded('view')}
                      onClick={(e) => { e.stopPropagation(); setSelected(finding); }}
                      className="inline-grid h-6 w-6 place-items-center rounded border border-transparent text-foreground-tertiary transition-all hover:bg-background-hover hover:text-foreground"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                  }
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-body3 font-semibold leading-tight text-foreground">
                      {finding.title}
                    </span>
                    <Badge variant={severityBadgeVariant(finding.severity)} size="sm" bordered>
                      {tSeverity(finding.severity)}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1.5 overflow-hidden font-sans text-[11px] leading-tight text-foreground-tertiary tabular-nums">
                    {assigneeName !== null && (
                      <>
                        <span className="truncate">{assigneeName}</span>
                        <span className="shrink-0">·</span>
                      </>
                    )}
                    {finding.deadline_date !== null && (
                      <>
                        <span className="shrink-0">{formatDate(finding.deadline_date)}</span>
                        <span className="shrink-0">·</span>
                      </>
                    )}
                    {finding.bbl_article_ref !== null && finding.bbl_article_ref !== '' && (
                      <>
                        <span className="shrink-0">{finding.bbl_article_ref}</span>
                        <span className="shrink-0">·</span>
                      </>
                    )}
                    <Badge variant={statusBadgeVariant(finding.status)} size="sm" className="w-fit shrink-0">
                      {tStatus(finding.status)}
                    </Badge>
                  </div>
                </DetailCardRow>

                <DetailCardBody>
                  {finding.description !== '' && (
                    <div className="whitespace-pre-wrap border-b border-dashed border-border py-2.5 text-body3 leading-snug text-foreground-secondary">
                      {finding.description}
                    </div>
                  )}
                  <MetaGrid entries={entries} />
                </DetailCardBody>

                <DetailCardFooter className="justify-between">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setSelected(finding); }}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    {tExpanded('view')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { handleDelete(finding); }}
                    disabled={deleteMutation.isPending}
                    className="text-error hover:text-error"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {tExpanded('delete')}
                  </Button>
                </DetailCardFooter>
              </DetailCard>
            );
          })}
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

'use client';

import { AlertTriangle, Eye, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';

import { Badge, Button, Input, MetaGrid } from '@bimstitch/ui';
import {
  DetailCard,
  DetailCardBody,
  DetailCardFooter,
  DetailCardRow,
} from '@bimstitch/ui';

import { PanelEmptyState } from '@/components/shared/viewer/PanelEmptyState';
import { useDeleteFinding } from '@/features/findings/useDeleteFinding';
import { useElementFindings } from '@/features/findings/useElementFindings';
import { useProjectFindings } from '@/features/findings/useFindings';
import { FindingDetailModal } from '@/features/projects/detail/FindingDetailModal';
import { FindingFormDialog } from '@/features/projects/detail/FindingFormDialog';
import {
  severityBadgeVariant,
  statusBadgeVariant,
} from '@/features/projects/detail/findingBadges';
import type { Finding } from '@/lib/api/schemas';

function formatDate(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

type EntityFindingsBodyProps = {
  projectId: string;
  /** Version-independent identity anchor — findings query/create by this. */
  modelId: string;
  /** The open file version — recorded as "raised on this version" provenance. */
  fileId: string;
  /** A single element's GlobalId, or `null` for the project-level (unlinked) view. */
  globalId: string | null;
  /** When this nonce changes, auto-open the new-finding dialog. */
  autoOpenNonce?: number | undefined;
};

export function EntityFindingsBody({
  projectId,
  modelId,
  fileId,
  globalId,
  autoOpenNonce,
}: EntityFindingsBodyProps): JSX.Element {
  const t = useTranslations('viewerFindings');
  const tSeverity = useTranslations('findings.severity');
  const tStatus = useTranslations('findings.status');
  const tExpanded = useTranslations('findings.expanded');

  const isProject = globalId === null;
  const elementQuery = useElementFindings(projectId, modelId, globalId);
  const projectQuery = useProjectFindings(projectId, isProject);
  const query = isProject ? projectQuery : elementQuery;
  const deleteMutation = useDeleteFinding(projectId);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Finding | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const lastConsumedNonce = useRef<number | undefined>(undefined);

  // Auto-open the new-finding dialog when triggered from a context-menu command.
  useEffect(() => {
    if (autoOpenNonce !== undefined && autoOpenNonce !== lastConsumedNonce.current) {
      lastConsumedNonce.current = autoOpenNonce;
      setCreateOpen(true);
    }
  }, [autoOpenNonce]);

  const findings = query.data ?? [];

  const [search, setSearch] = useState('');
  const filteredFindings = useMemo(() => {
    if (search.trim() === '') return findings;
    const q = search.toLowerCase();
    return findings.filter((f) => {
      if (f.title.toLowerCase().includes(q)) return true;
      return f.description !== null && f.description !== undefined && f.description.toLowerCase().includes(q);
    });
  }, [findings, search]);

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 border-b border-border bg-background px-2.5 py-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-secondary" />
          <Input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); }}
            placeholder={t('filterPlaceholder')}
            inputSize="sm"
            className="pl-7"
          />
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => { setCreateOpen(true); }}
          title={t('createButton')}
        >
          <Plus className="h-3.5 w-3.5" />
          {t('createButton')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {query.isLoading ? (
          <PanelEmptyState icon={Loader2} message={t('loading')} />
        ) : filteredFindings.length === 0 ? (
          <PanelEmptyState
            icon={AlertTriangle}
            message={isProject ? t('emptyProjectEmpty') : t('emptyNoItems')}
          />
        ) : (
          <div className="flex flex-col">
            {filteredFindings.map((finding) => {
              const isExpanded = expandedId === finding.id;

              const entries: Array<{ label: string; value: string }> = [
                { label: tExpanded('status'), value: tStatus(finding.status) },
                { label: tExpanded('severity'), value: tSeverity(finding.severity) },
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
                      {finding.deadline_date !== null && (
                        <>
                          <span className="shrink-0">{formatDate(finding.deadline_date)}</span>
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
      </div>

      <FindingFormDialog
        projectId={projectId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        linkedModelId={globalId !== null ? modelId : null}
        linkedFileId={globalId !== null ? fileId : null}
        linkedElementGlobalId={globalId}
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

/** Reads element-finding count via the same hook — drives the tab pill. */
export function useEntityFindingCount(
  projectId: string,
  modelId: string,
  globalId: string | null,
): number {
  const query = useElementFindings(projectId, modelId, globalId);
  return query.data?.length ?? 0;
}

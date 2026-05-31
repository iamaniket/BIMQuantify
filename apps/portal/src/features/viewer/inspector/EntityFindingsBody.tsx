'use client';

import { AlertTriangle, Loader2, Plus, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';

import { Badge, Button, Input } from '@bimstitch/ui';

import { PanelEmptyState } from '@/components/shared/viewer/PanelEmptyState';
import { useElementFindings } from '@/features/findings/useElementFindings';
import { useProjectFindings } from '@/features/findings/useFindings';
import { FindingDetailModal } from '@/features/projects/detail/FindingDetailModal';
import { FindingFormDialog } from '@/features/projects/detail/FindingFormDialog';
import {
  severityBadgeVariant,
  statusBadgeVariant,
} from '@/features/projects/detail/findingBadges';
import type { Finding } from '@/lib/api/schemas';

type EntityFindingsBodyProps = {
  projectId: string;
  fileId: string;
  /** A single element's GlobalId, or `null` for the project-level (unlinked) view. */
  globalId: string | null;
  /** When this nonce changes, auto-open the new-finding dialog. */
  autoOpenNonce?: number | undefined;
};

export function EntityFindingsBody({
  projectId,
  fileId,
  globalId,
  autoOpenNonce,
}: EntityFindingsBodyProps): JSX.Element {
  const t = useTranslations('viewerFindings');
  const tSeverity = useTranslations('findings.severity');
  const tStatus = useTranslations('findings.status');

  const isProject = globalId === null;
  const elementQuery = useElementFindings(projectId, fileId, globalId);
  const projectQuery = useProjectFindings(projectId, isProject);
  const query = isProject ? projectQuery : elementQuery;
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Finding | null>(null);
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
            {filteredFindings.map((finding) => (
              <button
                key={finding.id}
                type="button"
                onClick={() => { setSelected(finding); }}
                className="flex w-full items-center gap-2 border-b border-border px-2.5 py-2 text-left transition-colors hover:bg-background-hover"
              >
                <Badge variant={severityBadgeVariant(finding.severity)} className="w-fit shrink-0">
                  {tSeverity(finding.severity)}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-body3 font-medium text-foreground">
                  {finding.title}
                </span>
                <Badge variant={statusBadgeVariant(finding.status)} className="w-fit shrink-0">
                  {tStatus(finding.status)}
                </Badge>
              </button>
            ))}
          </div>
        )}
      </div>

      <FindingFormDialog
        projectId={projectId}
        open={createOpen}
        onOpenChange={setCreateOpen}
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
  fileId: string,
  globalId: string | null,
): number {
  const query = useElementFindings(projectId, fileId, globalId);
  return query.data?.length ?? 0;
}

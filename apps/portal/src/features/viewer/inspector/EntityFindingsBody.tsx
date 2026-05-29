'use client';

import { AlertTriangle, Loader2, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import { Badge, Button } from '@bimstitch/ui';

import { PanelEmptyState } from '@/components/shared/viewer/PanelEmptyState';
import { useElementFindings } from '@/features/findings/useElementFindings';
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
  globalId: string;
};

export function EntityFindingsBody({
  projectId,
  fileId,
  globalId,
}: EntityFindingsBodyProps): JSX.Element {
  const t = useTranslations('viewerFindings');
  const tSeverity = useTranslations('findings.severity');
  const tStatus = useTranslations('findings.status');

  const query = useElementFindings(projectId, fileId, globalId);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Finding | null>(null);

  const findings = query.data ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-1.5 border-b border-border bg-background px-2.5 py-2">
        <span className="min-w-0 truncate text-caption text-foreground-tertiary">
          {t('count', { count: findings.length })}
        </span>
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
        ) : findings.length === 0 ? (
          <PanelEmptyState icon={AlertTriangle} message={t('emptyNoItems')} />
        ) : (
          <div className="flex flex-col">
            {findings.map((finding) => (
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
        linkedFileId={fileId}
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

'use client';

import { AlertTriangle, Columns3 } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useState, type JSX } from 'react';

import { Button, EmptyState, Select } from '@bimstitch/ui';

import { ResourceList, TabToolbar } from '@/components/shared/resource';
import { LogFindingButton } from '@/features/findingTemplates/LogFindingButton';
import { useDeleteFinding } from '@/features/findings/useDeleteFinding';
import { useFindings } from '@/features/findings/useFindings';
import { flattenPages } from '@/lib/query/useAuthInfiniteQuery';
import { useProjectMembers } from '@/features/projects/members/useProjectMembers';
import type { Finding, FindingStatusValue } from '@/lib/api/schemas';

import { useRouter } from '@/i18n/navigation';

import { FindingDetailModal } from './FindingDetailModal';
import { FindingRow } from './FindingRow';

type Props = {
  projectId: string;
};

const STATUS_FILTERS: Array<{ value: FindingStatusValue | 'all'; labelKey: string }> = [
  { value: 'all', labelKey: 'filterAll' },
  { value: 'draft', labelKey: 'filterDraft' },
  { value: 'open', labelKey: 'filterOpen' },
  { value: 'in_progress', labelKey: 'filterInProgress' },
  { value: 'resolved', labelKey: 'filterResolved' },
  { value: 'verified', labelKey: 'filterVerified' },
];

export function BevindingenTab({ projectId }: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.bevindingen');
  const findingsQuery = useFindings(projectId);
  const membersQuery = useProjectMembers(projectId);
  const deleteMutation = useDeleteFinding(projectId);
  const [selected, setSelected] = useState<Finding | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<FindingStatusValue | undefined>(undefined);
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

  const allFindings = flattenPages(findingsQuery.data);
  const findings = allFindings.filter((f) => {
    if (statusFilter && f.status !== statusFilter) return false;
    if (searchQuery !== '') {
      const q = searchQuery.toLowerCase();
      return (
        f.title.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q) ||
        (f.bbl_article_ref?.toLowerCase().includes(q) ?? false)
      );
    }
    return true;
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

  const router = useRouter();

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <TabToolbar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={t('searchPlaceholder')}
        filter={(
          <Select
            selectSize="sm"
            value={statusFilter ?? 'all'}
            onChange={(e) => { setStatusFilter(e.target.value === 'all' ? undefined : e.target.value as FindingStatusValue); }}
            className="w-auto min-w-[7.5rem]"
          >
            {STATUS_FILTERS.map(({ value, labelKey }) => (
              <option key={value} value={value}>{t(labelKey)}</option>
            ))}
          </Select>
        )}
        actions={(
          <div className="flex items-center gap-2">
            {allFindings.length > 0 && (
              <Button
                variant="border"
                size="sm"
                onClick={() => { router.push(`/projects/${projectId}/findings`); }}
              >
                <Columns3 className="mr-1.5 h-3.5 w-3.5" />
                {t('boardLabel')}
              </Button>
            )}
            <LogFindingButton projectId={projectId} />
          </div>
        )}
      />

      <div className="min-h-0 flex-1 overflow-auto">
      <ResourceList
        isLoading={findingsQuery.isLoading}
        total={allFindings.length}
        filteredCount={findings.length}
        searchActive={searchQuery !== '' || statusFilter !== undefined}
        noResultsLabel={t('noResults')}
        hasNextPage={findingsQuery.hasNextPage}
        isFetchingNextPage={findingsQuery.isFetchingNextPage}
        onLoadMore={() => { void findingsQuery.fetchNextPage(); }}
        empty={(
          <EmptyState
            icon={AlertTriangle}
            title={t('title')}
            description={t('description')}
            action={<LogFindingButton projectId={projectId} />}
            className={undefined}
          />
        )}
      >
        {findings.map((finding) => (
          <FindingRow
            key={finding.id}
            finding={finding}
            assigneeName={getAssigneeName(finding.assignee_user_id)}
            expanded={expandedId === finding.id}
            onToggle={() => { setExpandedId(expandedId === finding.id ? null : finding.id); }}
            onView={() => { setSelected(finding); }}
            onDelete={() => { handleDelete(finding); }}
            deleteDisabled={deleteMutation.isPending}
          />
        ))}
      </ResourceList>
      </div>

      <FindingDetailModal
        projectId={projectId}
        finding={selected}
        open={selected !== null}
        onOpenChange={(o) => { if (!o) setSelected(null); }}
      />
    </div>
  );
}

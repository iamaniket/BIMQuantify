'use client';

import { AlertTriangle } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useState, type JSX } from 'react';

import { EmptyState, Select } from '@bimstitch/ui';

import { ResourceList, TabToolbar } from '@/components/shared/resource';
import { LogFindingButton } from '@/features/findingTemplates/LogFindingButton';
import { useDeleteFinding } from '@/features/findings/useDeleteFinding';
import { useFindings } from '@/features/findings/useFindings';
import { FindingDetailModal } from '@/features/projects/detail/FindingDetailModal';
import { FindingRow } from '@/features/projects/detail/FindingRow';
import { useProjectMembers } from '@/features/projects/members/useProjectMembers';
import type { Finding, FindingStatusValue } from '@/lib/api/schemas';
import { flattenPages } from '@/lib/query/useAuthInfiniteQuery';

type Props = {
  projectId: string;
};

const STATUS_FILTERS: { value: FindingStatusValue | 'all'; labelKey: string }[] = [
  { value: 'all', labelKey: 'filterAll' },
  { value: 'draft', labelKey: 'filterDraft' },
  { value: 'open', labelKey: 'filterOpen' },
  { value: 'in_progress', labelKey: 'filterInProgress' },
  { value: 'resolved', labelKey: 'filterResolved' },
  { value: 'verified', labelKey: 'filterVerified' },
];

export function FindingsListTab({ projectId }: Props): JSX.Element {
  const t = useTranslations('findingsBoard.list');
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
        f.title.toLowerCase().includes(q)
        || f.description.toLowerCase().includes(q)
        || (f.bbl_article_ref?.toLowerCase().includes(q) ?? false)
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

  return (
    <div className="flex flex-col gap-3">
      <TabToolbar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={t('searchPlaceholder')}
        filter={(
          <Select
            selectSize="md"
            value={statusFilter ?? 'all'}
            onChange={(e) => { setStatusFilter(e.target.value === 'all' ? undefined : e.target.value as FindingStatusValue); }}
            className="w-auto min-w-[7.5rem]"
          >
            {STATUS_FILTERS.map(({ value, labelKey }) => (
              <option key={value} value={value}>{t(labelKey)}</option>
            ))}
          </Select>
        )}
        actions={<LogFindingButton projectId={projectId} size="md" />}
      />

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
            title={t('emptyTitle')}
            description={t('emptyDescription')}
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

      <FindingDetailModal
        projectId={projectId}
        finding={selected}
        open={selected !== null}
        onOpenChange={(o) => { if (!o) setSelected(null); }}
      />
    </div>
  );
}

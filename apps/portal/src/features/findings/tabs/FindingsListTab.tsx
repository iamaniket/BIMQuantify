'use client';

import { AlertTriangle, Search } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useState, type JSX } from 'react';

import { EmptyState, Input, Select } from '@bimstitch/ui';

import { LoadMoreButton } from '@/components/shared/resource/LoadMoreButton';
import { PageTableContent } from '@/components/shared/PageTable';
import { AssigneeFilterChips, UNASSIGNED_FILTER } from '@/features/findings/AssigneeFilterChips';
import { useFindings } from '@/features/findings/useFindings';
import { LogFindingButton } from '@/features/findingTemplates/LogFindingButton';
import { FindingDetailModal } from '@/features/projects/detail/FindingDetailModal';
import { useProjectMembers } from '@/features/projects/members/useProjectMembers';
import type { Finding, FindingSeverityValue, FindingStatusValue } from '@/lib/api/schemas';
import { flattenPages } from '@/lib/query/useAuthInfiniteQuery';

import { FindingsTable } from './FindingsTable';

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

// Priority filter, ordered most-severe first.
const SEVERITIES: FindingSeverityValue[] = ['high', 'medium', 'low'];

export function FindingsListTab({ projectId }: Props): JSX.Element {
  const t = useTranslations('findingsBoard.list');
  const tTable = useTranslations('findingsBoard.list.table');
  const tSeverity = useTranslations('findings.severity');
  const findingsQuery = useFindings(projectId);
  const membersQuery = useProjectMembers(projectId);
  const [selected, setSelected] = useState<Finding | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<FindingStatusValue | undefined>(undefined);
  const [severityFilter, setSeverityFilter] = useState<FindingSeverityValue | undefined>(undefined);
  const [assigneeFilter, setAssigneeFilter] = useState<Set<string>>(new Set());

  const members = membersQuery.data ?? [];

  const toggleAssignee = useCallback((id: string) => {
    setAssigneeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allFindings = flattenPages(findingsQuery.data);
  const findings = allFindings.filter((f) => {
    if (statusFilter && f.status !== statusFilter) return false;
    if (severityFilter && f.severity !== severityFilter) return false;
    if (assigneeFilter.size > 0 && !assigneeFilter.has(f.assignee_user_id ?? UNASSIGNED_FILTER)) {
      return false;
    }
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          inputSize="md"
          type="text"
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); }}
          placeholder={t('searchPlaceholder')}
          leading={<Search className="h-3.5 w-3.5" />}
          className="w-full sm:w-80 md:w-96"
        />
        <AssigneeFilterChips
          members={members}
          selected={assigneeFilter}
          onToggle={toggleAssignee}
        />
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
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
          <Select
            selectSize="md"
            value={severityFilter ?? 'all'}
            onChange={(e) => { setSeverityFilter(e.target.value === 'all' ? undefined : e.target.value as FindingSeverityValue); }}
            className="w-auto min-w-[7.5rem]"
          >
            <option value="all">{t('filterAllPriorities')}</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>{tSeverity(s)}</option>
            ))}
          </Select>
          <LogFindingButton projectId={projectId} size="lg" variant="primary" />
        </div>
      </div>

      <PageTableContent
        isLoading={findingsQuery.isLoading}
        isError={findingsQuery.isError}
        errorMessage={t('noResults')}
        countLabel={
          findings.length > 0
            ? tTable('count', { count: findings.length })
            : undefined
        }
      >
        {allFindings.length === 0 ? (
          <EmptyState
            icon={AlertTriangle}
            title={t('emptyTitle')}
            description={t('emptyDescription')}
            action={<LogFindingButton projectId={projectId} />}
            className={undefined}
          />
        ) : findings.length === 0 ? (
          <p className="py-6 text-center text-body3 text-foreground-tertiary">
            {t('noResults')}
          </p>
        ) : (
          <FindingsTable
            findings={findings}
            members={members}
            onView={setSelected}
          />
        )}
        <LoadMoreButton
          hasNextPage={findingsQuery.hasNextPage}
          isFetchingNextPage={findingsQuery.isFetchingNextPage}
          fetchNextPage={() => { void findingsQuery.fetchNextPage(); }}
        />
      </PageTableContent>

      <FindingDetailModal
        projectId={projectId}
        finding={selected}
        open={selected !== null}
        onOpenChange={(o) => { if (!o) setSelected(null); }}
      />
    </div>
  );
}
